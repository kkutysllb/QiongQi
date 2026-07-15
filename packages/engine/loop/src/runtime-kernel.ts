import { randomUUID } from 'node:crypto'
import type { RunEventEnvelope, RunIdentity, RunOutcome, RunStateV3 } from '@qiongqi/contracts'
import type { RunEventStore, RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'
import { MiddlewareChain } from './middleware-chain.js'
import {
  outgoingEdges,
  validateExecutionGraph,
  type ExecutionGraph,
  type RuntimeNode
} from './execution-graph.js'
import type { MiddlewareCommand, RuntimeHook } from './runtime-middleware.js'
import type { RuntimeNodeHandler, RuntimeNodeResult } from './runtime-kernel-context.js'

export type RuntimeKernelOptions = {
  graph: ExecutionGraph
  snapshots: RunSnapshotStore
  events: RunEventStore
  leases: RunLeaseStore
  holderId: string
  nowIso?: () => string
  leaseTtlMs?: number
  middleware?: MiddlewareChain
  nodes: Record<string, RuntimeNodeHandler>
}

type CompletedNodePayload = {
  nodeId: string
  stepIndex: number
  condition: string
  commands: MiddlewareCommand[]
  value?: unknown
  outcome?: RunOutcome
}

export class RuntimeKernel {
  private readonly options: Omit<RuntimeKernelOptions, 'nowIso' | 'leaseTtlMs' | 'middleware'> &
    Required<Pick<RuntimeKernelOptions, 'nowIso' | 'leaseTtlMs' | 'middleware'>>

  constructor(options: RuntimeKernelOptions) {
    validateExecutionGraph(options.graph)
    this.options = {
      nowIso: () => new Date().toISOString(),
      leaseTtlMs: 30_000,
      middleware: new MiddlewareChain(),
      ...options
    }
  }

  async run(identity: RunIdentity): Promise<RunOutcome> {
    const { leases, snapshots, holderId } = this.options
    const lease = await leases.acquire(identity.runId, holderId, this.options.leaseTtlMs)
    if (!lease.acquired) {
      return {
        status: 'failed',
        reason: 'runtime_error',
        retryable: true,
        details: { code: 'lease_unavailable' }
      }
    }

    try {
      let state = await snapshots.load(identity)
      if (!state) state = this.initialState(identity)
      this.assertStateIdentity(identity, state)
      if (isTerminal(state)) return outcomeFromTerminalState(state)

      state = await this.replayAfterCheckpoint(identity, state)
      if (isTerminal(state)) {
        await snapshots.save(state)
        return outcomeFromTerminalState(state)
      }

      state = { ...state, status: 'running', updatedAt: this.options.nowIso() }
      await snapshots.save(state)

      const beforeRun = await this.options.middleware.run(
        'beforeRun',
        this.middlewareContext(identity, state, 'beforeRun')
      )
      const beforeRunOutcome = this.commandOutcome(beforeRun?.commands)
      if (beforeRunOutcome) {
        state = this.withOutcome(this.applyCommands(state, beforeRun?.commands), beforeRunOutcome)
        await snapshots.save(state)
        return beforeRunOutcome
      }

      while (true) {
        const node = this.nodeFor(state.cursor.nodeId)
        if (checkpointsBefore(node)) await snapshots.save(state)

        const started = await this.recordEvent(identity, state, node.id, 'node.started', {
          nodeId: node.id,
          stepIndex: state.cursor.stepIndex
        })
        state = {
          ...state,
          cursor: { ...state.cursor, checkpointSeq: started.seq },
          updatedAt: this.options.nowIso()
        }

        const before = await this.options.middleware.run(
          'beforeNode',
          this.middlewareContext(identity, state, 'beforeNode', node)
        )
        const beforeOutcome = this.commandOutcome(before?.commands)
        if (beforeOutcome) {
          state = this.withOutcome(this.applyCommands(state, before?.commands), beforeOutcome)
          await snapshots.save(state)
          return beforeOutcome
        }

        const handler = this.options.nodes[node.id]
        if (!handler) throw new Error(`missing runtime node handler: ${node.id}`)
        const result = await handler({ identity, state, node, hook: 'beforeNode' })
        const commands = [...(before?.commands ?? []), ...(result?.commands ?? [])]
        const condition = result?.condition ?? 'next'
        const outcome = result?.outcome
          ?? this.commandOutcome(commands)
          ?? (node.terminal
            ? { status: 'completed', reason: 'normal_stop', retryable: false } as const
            : undefined)
        const payload: CompletedNodePayload = {
          nodeId: node.id,
          stepIndex: state.cursor.stepIndex,
          condition,
          commands,
          ...(result && 'value' in result ? { value: result.value } : {}),
          ...(outcome ? { outcome } : {})
        }
        const completed = await this.recordEvent(
          identity,
          state,
          node.id,
          'node.completed',
          payload
        )
        state = this.reduceCompletedNode(state, node, payload, completed.seq)
        if (checkpointsAfter(node) || isTerminal(state)) await snapshots.save(state)

        const afterNode = await this.options.middleware.run(
          'afterNode',
          this.middlewareContext(identity, state, 'afterNode', node)
        )
        if (isTerminal(state)) {
          // Terminal outcomes are monotonic. Middleware may record diagnostics,
          // but cannot reopen or replace an already committed terminal result.
          await this.options.middleware.run(
            'afterRun',
            this.middlewareContext(identity, state, 'afterRun')
          )
          return outcomeFromTerminalState(state)
        }

        state = this.applyCommands(state, afterNode?.commands)
        const afterOutcome = this.commandOutcome(afterNode?.commands)
        if (afterOutcome) {
          state = this.withOutcome(state, afterOutcome)
          await snapshots.save(state)
          return afterOutcome
        }
      }
    } catch (error) {
      const outcome: RunOutcome = {
        status: 'failed',
        reason: 'runtime_error',
        retryable: true,
        details: { message: error instanceof Error ? error.message : String(error) }
      }
      const state = await snapshots.load(identity)
      if (state && !isTerminal(state)) {
        await snapshots.save(this.withOutcome(state, outcome))
      }
      return state && isTerminal(state) ? outcomeFromTerminalState(state) : outcome
    } finally {
      await leases.release(identity.runId, holderId)
    }
  }

  private initialState(identity: RunIdentity): RunStateV3 {
    const now = this.options.nowIso()
    return {
      version: 3,
      graphVersion: this.options.graph.version,
      runtimeMode: 'kernel_v3',
      ...identity,
      status: 'created',
      cursor: {
        stepIndex: 0,
        nodeId: this.options.graph.startNodeId,
        attempt: 0,
        checkpointSeq: 0
      },
      budgets: {
        stepsUsed: 0,
        toolCallsUsed: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0
      },
      recovery: { attempts: 0, maxAttempts: 1 },
      middleware: {},
      nodeData: {},
      taskRevision: 0,
      pendingEffects: [],
      committedEffects: [],
      createdAt: now,
      updatedAt: now
    }
  }

  private async replayAfterCheckpoint(
    identity: RunIdentity,
    initial: RunStateV3
  ): Promise<RunStateV3> {
    let state = initial
    const events = await this.options.events.listAfter(identity, state.cursor.checkpointSeq)
    for (const event of events.sort((left, right) => left.seq - right.seq)) {
      this.assertEventIdentity(identity, event)
      if (event.eventType === 'node.started') {
        state = {
          ...state,
          cursor: { ...state.cursor, checkpointSeq: event.seq },
          updatedAt: event.timestamp
        }
        continue
      }
      if (event.eventType !== 'node.completed') continue
      const payload = parseCompletedNodePayload(event.payload)
      if (payload.nodeId !== state.cursor.nodeId) {
        throw new Error(
          `run event cursor mismatch: expected ${state.cursor.nodeId}, received ${payload.nodeId}`
        )
      }
      state = this.reduceCompletedNode(state, this.nodeFor(payload.nodeId), payload, event.seq)
    }
    return state
  }

  private reduceCompletedNode(
    state: RunStateV3,
    node: RuntimeNode,
    payload: CompletedNodePayload,
    checkpointSeq: number
  ): RunStateV3 {
    let next = this.applyCommands(state, payload.commands)
    if ('value' in payload) {
      next = {
        ...next,
        nodeData: { ...next.nodeData, [node.id]: payload.value }
      }
    }
    if (payload.outcome) {
      return {
        ...this.withOutcome(next, payload.outcome),
        cursor: { ...next.cursor, checkpointSeq },
        updatedAt: this.options.nowIso()
      }
    }

    const jump = [...payload.commands].reverse().find((command) => command.type === 'jump')
    const edge = jump
      ? { to: jump.nodeId, loop: false }
      : outgoingEdges(this.options.graph, node.id, payload.condition)[0]
    if (!edge) throw new Error(`no graph edge for ${node.id} condition ${payload.condition}`)
    this.nodeFor(edge.to)
    return {
      ...next,
      status: 'running',
      cursor: {
        stepIndex: next.cursor.stepIndex + 1,
        nodeId: edge.to,
        attempt: edge.loop ? next.cursor.attempt + 1 : 0,
        checkpointSeq
      },
      updatedAt: this.options.nowIso()
    }
  }

  private middlewareContext(
    identity: RunIdentity,
    state: RunStateV3,
    hook: RuntimeHook,
    node?: RuntimeNode
  ) {
    return { identity, state, node, hook, commands: [] as const }
  }

  private applyCommands(
    state: RunStateV3,
    commands: readonly MiddlewareCommand[] | undefined
  ): RunStateV3 {
    let next = state
    for (const command of commands ?? []) {
      if (command.type === 'set-middleware-state') {
        next = {
          ...next,
          middleware: { ...next.middleware, [command.id]: command.state }
        }
      }
      if (command.type === 'set-budget') {
        next = { ...next, budgets: { ...next.budgets, [command.key]: command.value } }
      }
      if (command.type === 'set-node-data') {
        next = { ...next, nodeData: { ...next.nodeData, [command.nodeId]: command.value } }
      }
      if (command.type === 'set-task-revision') {
        if (command.revision < next.taskRevision) {
          throw new Error(
            `task revision cannot move backwards: ${next.taskRevision} -> ${command.revision}`
          )
        }
        next = { ...next, taskRevision: command.revision }
      }
      if (command.type === 'set-recovery') {
        next = { ...next, recovery: command.recovery }
      }
      if (command.type === 'set-effects') {
        next = {
          ...next,
          pendingEffects: command.pendingEffects,
          committedEffects: command.committedEffects
        }
      }
    }
    return next
  }

  private commandOutcome(commands: readonly MiddlewareCommand[] | undefined): RunOutcome | undefined {
    const command = commands?.find(
      (candidate) => candidate.type === 'terminate' || candidate.type === 'suspend'
    )
    return command?.type === 'terminate' || command?.type === 'suspend'
      ? command.outcome
      : undefined
  }

  private withOutcome(state: RunStateV3, outcome: RunOutcome): RunStateV3 {
    if (isTerminal(state)) return state
    return {
      ...state,
      status: outcome.status,
      outcome,
      updatedAt: this.options.nowIso()
    }
  }

  private nodeFor(nodeId: string): RuntimeNode {
    const node = this.options.graph.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) throw new Error(`unknown graph node: ${nodeId}`)
    return node
  }

  private assertStateIdentity(identity: RunIdentity, state: RunStateV3): void {
    for (const field of identityFields) {
      if (state[field] !== identity[field]) {
        throw new Error(`run state identity mismatch: ${field}`)
      }
    }
  }

  private assertEventIdentity(identity: RunIdentity, event: RunEventEnvelope): void {
    for (const field of identityFields) {
      if (event[field] !== identity[field]) {
        throw new Error(`run event identity mismatch: ${field}`)
      }
    }
  }

  private async recordEvent(
    identity: RunIdentity,
    state: RunStateV3,
    nodeId: string,
    eventType: string,
    payload: unknown
  ): Promise<RunEventEnvelope> {
    const existing = await this.options.events.listAfter(identity, 0)
    const seq = existing.reduce((max, event) => Math.max(max, event.seq), 0) + 1
    return this.options.events.append({
      eventId: randomUUID(),
      seq,
      ...identity,
      stepId: nodeId,
      nodeAttemptId: `${nodeId}:${state.cursor.attempt}`,
      eventType,
      payload,
      timestamp: this.options.nowIso()
    })
  }
}

const identityFields = [
  'ownerUserId',
  'workspaceKey',
  'threadId',
  'turnId',
  'runId'
] as const

function checkpointsBefore(node: RuntimeNode): boolean {
  return node.checkpoint === 'before' || node.checkpoint === 'both'
}

function checkpointsAfter(node: RuntimeNode): boolean {
  return node.checkpoint === 'after' || node.checkpoint === 'both'
}

function isTerminal(state: RunStateV3): boolean {
  return state.status === 'completed'
    || state.status === 'degraded'
    || state.status === 'failed'
    || state.status === 'aborted'
    || state.status === 'suspended'
}

function outcomeFromTerminalState(state: RunStateV3): RunOutcome {
  return state.outcome ?? {
    status: state.status as RunOutcome['status'],
    reason: 'runtime_error',
    retryable: false
  }
}

function parseCompletedNodePayload(value: unknown): CompletedNodePayload {
  if (!value || typeof value !== 'object') throw new Error('invalid node.completed payload')
  const record = value as Record<string, unknown>
  if (typeof record.nodeId !== 'string' || !record.nodeId) {
    throw new Error('invalid node.completed nodeId')
  }
  if (!Number.isInteger(record.stepIndex) || (record.stepIndex as number) < 0) {
    throw new Error('invalid node.completed stepIndex')
  }
  if (typeof record.condition !== 'string' || !record.condition) {
    throw new Error('invalid node.completed condition')
  }
  if (!Array.isArray(record.commands)) throw new Error('invalid node.completed commands')
  return record as CompletedNodePayload
}
