import type {
  ModelProposal,
  RunOutcome,
  TaskStateV1,
  TaskToolLedgerEntry,
  ToolEffectPolicy,
  TurnItem
} from '@qiongqi/contracts'
import { ModelProposalSchema } from '@qiongqi/contracts'
import { makeAssistantReasoningItem, makeAssistantTextItem, makeToolCallItem } from '@qiongqi/domain'
import type {
  IdGenerator,
  SessionStore,
  TaskStateStore,
  ThreadStore,
  ToolCallLike,
  ToolHostContext
} from '@qiongqi/ports'
import type { TurnService } from '@qiongqi/services'
import type { ModelProposalRunner } from './model-proposal-runner.js'
import type { PromptBuilder } from './prompt-builder.js'
import type { RuntimeNodeHandler } from './runtime-kernel-context.js'
import type { ToolRuntimeV3 } from './tool-runtime-v3.js'
import { classifyProposal, type ProposalClass } from './proposal-classifier.js'
import { renderRecoveryContinuationEntry, transitionContextRecovery } from './context-recovery.js'
import { migrateLegacyTaskState } from './legacy-task-state-migrator.js'
import { digestValue } from './effect-commit.js'

export type KernelV3NodeDependencies = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  taskStates: TaskStateStore
  turns: Pick<TurnService, 'getTurn' | 'getAbortController' | 'applyItem' | 'updateItem'>
  promptBuilder: Pick<PromptBuilder, 'build'>
  proposalRunner: Pick<ModelProposalRunner, 'run'>
  toolRuntime: Pick<ToolRuntimeV3, 'execute'>
  createToolContext: (
    identity: Parameters<RuntimeNodeHandler>[0]['identity'],
    state: Parameters<RuntimeNodeHandler>[0]['state']
  ) => Promise<ToolHostContext> | ToolHostContext
  ids: Pick<IdGenerator, 'next'>
  nowIso: () => string
}

type StoredRequest = Omit<Parameters<ModelProposalRunner['run']>[0], 'abortSignal'>

export function createKernelV3NodeHandlers(
  deps: KernelV3NodeDependencies
): Record<string, RuntimeNodeHandler> {
  return {
    'prepare-turn': async ({ identity }) => {
      const [thread, turn] = await Promise.all([
        deps.threadStore.get(identity.threadId),
        deps.turns.getTurn(identity.threadId, identity.turnId)
      ])
      if (!thread || !turn) {
        return { outcome: failedOutcome('turn or thread not found') }
      }
      const owner = thread.ownerUserId ?? 'local-default-owner'
      if (
        owner !== identity.ownerUserId
        || thread.workspace !== identity.workspaceKey
        || turn.threadId !== identity.threadId
      ) {
        return { outcome: failedOutcome('turn scope mismatch') }
      }
      const signal = deps.turns.getAbortController(identity.turnId)
      if (signal?.aborted) {
        return { outcome: { status: 'aborted', reason: 'user_aborted', retryable: false } }
      }
      return {
        condition: 'next',
        value: {
          ownerUserId: owner,
          workspace: thread.workspace,
          turnStatus: turn.status
        }
      }
    },

    'restore-task': async ({ identity }) => {
      let task = await deps.taskStates.load(identity)
      if (!task) {
        const [thread, items] = await Promise.all([
          deps.threadStore.get(identity.threadId),
          deps.sessionStore.loadItems(identity.threadId)
        ])
        if (!thread) return { outcome: failedOutcome('thread not found during task restore') }
        const migrated = await migrateLegacyTaskState({
          identity,
          thread,
          items,
          store: deps.taskStates,
          nowIso: deps.nowIso
        })
        if (migrated.kind !== 'created' && migrated.kind !== 'existing') {
          return {
            outcome: {
              status: 'failed',
              reason: 'required_action_missing',
              retryable: false,
              details: { code: migrated.kind, reason: migrated.reason }
            }
          }
        }
        task = migrated.state
      }
      return {
        condition: 'next',
        value: task,
        commands: [{ type: 'set-task-revision', revision: task.revision }]
      }
    },

    'build-context': async ({ identity, state }) => {
      const signal = deps.turns.getAbortController(identity.turnId)
      if (!signal || signal.aborted) {
        return { outcome: { status: 'aborted', reason: 'user_aborted', retryable: false } }
      }
      const built = await deps.promptBuilder.build({
        threadId: identity.threadId,
        turnId: identity.turnId,
        signal,
        stepIndex: state.cursor.stepIndex
      })
      if (built.kind === 'aborted') {
        return { outcome: { status: 'aborted', reason: 'user_aborted', retryable: false } }
      }
      if (built.kind !== 'built') return { outcome: failedOutcome('prompt build stopped') }
      const { abortSignal: _abortSignal, ...request } = built.ctx.request
      const recovery = nodeValue<{ entry?: string }>(state, 'recover-context')
      const storedRequest: StoredRequest = recovery?.entry
        ? {
            ...request,
            contextInstructions: [
              ...(request.contextInstructions ?? []),
              recovery.entry
            ]
          }
        : request
      const toolPolicies = Object.fromEntries(
        (built.ctx.request.tools as Array<Record<string, unknown>>).map((tool) => [
          String(tool.name),
          isToolEffectPolicy(tool.effectPolicy) ? tool.effectPolicy : undefined
        ])
      )
      return {
        condition: 'next',
        value: {
          request: storedRequest,
          toolPolicies,
          runtimeContext: {
            activeSkillIds: built.ctx.activeSkillIds,
            allowedToolNames: built.ctx.allowedToolNames,
            modelCapabilities: built.ctx.modelCapabilities,
            approvalPolicy: built.ctx.approvalPolicy,
            threadMode: built.ctx.effectiveMode,
            guiPlan: built.ctx.activePlanContext
          }
        }
      }
    },

    'invoke-model': async ({ identity, state }) => {
      const built = requireNodeValue<{ request: StoredRequest }>(state, 'build-context')
      const signal = deps.turns.getAbortController(identity.turnId)
      if (!signal || signal.aborted) {
        return { outcome: { status: 'aborted', reason: 'user_aborted', retryable: false } }
      }
      const proposal = await deps.proposalRunner.run({ ...built.request, abortSignal: signal })
      return { condition: 'next', value: proposal }
    },

    'normalize-proposal': ({ state }) => ({
      condition: 'next',
      value: ModelProposalSchema.parse(requireNodeValue(state, 'invoke-model'))
    }),

    evaluate: ({ state }) => {
      const task = requireNodeValue<TaskStateV1>(state, 'restore-task')
      const proposal = ModelProposalSchema.parse(requireNodeValue(state, 'normalize-proposal'))
      const proposalClass = classifyProposal({ proposal, task })
      if (proposalClass === 'tool_intents') {
        return { condition: 'tools', value: { proposalClass, action: 'tools' } }
      }
      if (
        proposalClass === 'context_discontinuity'
        || proposalClass === 'empty'
        || proposalClass === 'length_limited'
      ) {
        const transition = transitionContextRecovery({
          task,
          recovery: state.recovery,
          proposalClass: 'context_discontinuity'
        })
        if (transition.action === 'degrade') {
          return {
            value: { proposalClass, action: 'degrade' },
            outcome: transition.outcome,
            commands: [{ type: 'set-recovery', recovery: transition.recovery }]
          }
        }
        return {
          condition: 'recover',
          value: { proposalClass, action: 'recover' },
          commands: [{ type: 'set-recovery', recovery: transition.recovery }]
        }
      }
      if (proposalClass === 'safety_or_refusal' || proposalClass === 'protocol_error') {
        return { condition: 'fatal', value: { proposalClass, action: 'fatal' } }
      }
      return { condition: 'final', value: { proposalClass, action: 'final' } }
    },

    'commit-assistant': async ({ identity, state }) => {
      const proposal = ModelProposalSchema.parse(requireNodeValue(state, 'normalize-proposal'))
      if (proposal.reasoning.trim()) {
        await deps.turns.applyItem(identity.threadId, makeAssistantReasoningItem({
          id: `item_kernel_reasoning_${proposal.proposalId}`,
          threadId: identity.threadId,
          turnId: identity.turnId,
          text: proposal.reasoning,
          status: 'completed'
        }))
      }
      if (proposal.text.trim()) {
        await deps.turns.applyItem(identity.threadId, makeAssistantTextItem({
          id: `item_kernel_text_${proposal.proposalId}`,
          threadId: identity.threadId,
          turnId: identity.turnId,
          text: proposal.text,
          status: 'completed'
        }))
      }
      return {
        value: { proposalId: proposal.proposalId },
        outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
      }
    },

    'prepare-tools': async ({ identity, state }) => {
      const proposal = ModelProposalSchema.parse(requireNodeValue(state, 'normalize-proposal'))
      const calls: ToolCallLike[] = proposal.toolIntents.map((intent) => ({
        callId: intent.callId,
        toolName: intent.toolName,
        arguments: intent.arguments
      }))
      for (const call of calls) {
        await deps.turns.applyItem(identity.threadId, makeToolCallItem({
          id: `item_tool_${identity.turnId}_${call.callId}`,
          threadId: identity.threadId,
          turnId: identity.turnId,
          callId: call.callId,
          toolName: call.toolName,
          arguments: call.arguments,
          status: 'running'
        }))
      }
      return { condition: 'next', value: { calls } }
    },

    'commit-tools': async ({ identity, state }) => {
      const prepared = requireNodeValue<{ calls: ToolCallLike[] }>(state, 'prepare-tools')
      const built = requireNodeValue<{
        toolPolicies?: Record<string, ToolEffectPolicy | undefined>
      }>(state, 'build-context')
      let runtimeState = state
      const ledger: TaskToolLedgerEntry[] = []
      const toolContext = await deps.createToolContext(identity, state)
      for (const call of prepared.calls) {
        const execution = await deps.toolRuntime.execute({
          identity,
          state: runtimeState,
          call,
          context: {
            ...toolContext,
            runtimeIdentity: identity,
            runtimeState,
            runtimeStateSink: (next) => { runtimeState = next }
          },
          policy: built.toolPolicies?.[call.toolName] ?? defaultEffectPolicy(call)
        })
        runtimeState = execution.state
        if (execution.outcome) return { outcome: execution.outcome }
        if (!execution.result) return { outcome: failedOutcome(`tool result missing: ${call.callId}`) }
        await deps.turns.updateItem(identity.threadId, `item_tool_${identity.turnId}_${call.callId}`, {
          status: execution.result.item.kind === 'tool_result' && execution.result.item.isError
            ? 'failed'
            : 'completed',
          finishedAt: deps.nowIso()
        } as Partial<TurnItem>)
        await deps.turns.applyItem(identity.threadId, execution.result.item)
        const failed = execution.result.item.kind === 'tool_result' && execution.result.item.isError
        ledger.push({
          callId: call.callId,
          toolName: call.toolName,
          status: failed ? 'failed' : 'committed',
          resultDigest: digestValue(
            execution.result.item.kind === 'tool_result'
              ? execution.result.item.output
              : execution.result.item
          )
        })
      }

      const current = await deps.taskStates.load(identity)
      if (!current) return { outcome: failedOutcome('task state missing after tools') }
      const nextTask = updateTaskLedger(current, ledger, deps.nowIso())
      const revision = await deps.taskStates.prepare(nextTask, current.revision)
      await deps.taskStates.commit(revision)
      return {
        condition: 'tools_committed',
        value: { callIds: ledger.map((entry) => entry.callId), taskRevision: nextTask.revision },
        commands: [
          { type: 'set-task-revision', revision: nextTask.revision },
          { type: 'set-node-data', nodeId: 'restore-task', value: nextTask },
          {
            type: 'set-effects',
            pendingEffects: runtimeState.pendingEffects,
            committedEffects: runtimeState.committedEffects
          }
        ]
      }
    },

    'recover-context': ({ state }) => {
      const task = requireNodeValue<TaskStateV1>(state, 'restore-task')
      return {
        condition: 'recovered',
        value: { entry: renderRecoveryContinuationEntry(task) }
      }
    },

    'wait-user': () => ({
      outcome: {
        status: 'suspended',
        reason: 'awaiting_user_input',
        retryable: true
      }
    }),

    fail: ({ state }) => {
      const evaluation = nodeValue<{ proposalClass?: ProposalClass }>(state, 'evaluate')
      const safety = evaluation?.proposalClass === 'safety_or_refusal'
      return {
        outcome: {
          status: 'failed',
          reason: safety ? 'provider_safety_stop' : 'provider_protocol_error',
          retryable: !safety
        }
      }
    }
  }
}

function nodeValue<T>(state: { nodeData: Record<string, unknown> }, nodeId: string): T | undefined {
  return state.nodeData[nodeId] as T | undefined
}

function requireNodeValue<T>(state: { nodeData: Record<string, unknown> }, nodeId: string): T {
  const value = nodeValue<T>(state, nodeId)
  if (value === undefined) throw new Error(`kernel node data missing: ${nodeId}`)
  return value
}

function failedOutcome(message: string): RunOutcome {
  return {
    status: 'failed',
    reason: 'runtime_error',
    retryable: true,
    details: { message }
  }
}

function isToolEffectPolicy(value: unknown): value is ToolEffectPolicy {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return ['read', 'idempotent-write', 'non-idempotent-write'].includes(String(record.effect))
    && ['safe', 'verify-first', 'never'].includes(String(record.replay))
}

function defaultEffectPolicy(call: ToolCallLike): ToolEffectPolicy {
  if (call.toolKind === 'file_change') {
    return { effect: 'non-idempotent-write', replay: 'never' }
  }
  return { effect: 'read', replay: 'safe' }
}

function updateTaskLedger(
  current: TaskStateV1,
  entries: readonly TaskToolLedgerEntry[],
  updatedAt: string
): TaskStateV1 {
  const byCall = new Map(current.toolLedger.map((entry) => [entry.callId, entry]))
  for (const entry of entries) byCall.set(entry.callId, entry)
  return {
    ...current,
    revision: current.revision + 1,
    toolLedger: [...byCall.values()],
    updatedAt
  }
}
