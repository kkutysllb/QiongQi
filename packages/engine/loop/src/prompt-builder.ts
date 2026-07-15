/**
 * PromptBuilder assembles the `ModelRequest` for a single step: it loads and
 * heals history, resolves the turn model (including auto-routing), resolves
 * attachments / skills / memories, detects tool-catalog drift, runs context
 * compaction, applies token-economy and history-hygiene transforms, and
 * records the `input_*` / `pre_send` / `post_send` pipeline stages.
 *
 * It owns three pieces of cross-step state that previously lived on the
 * monolithic `AgentLoop`: the auto-model-route cache, the prompt-token
 * pressure signal (produced by ModelStepRunner, consumed here), and the
 * tool-catalog fingerprint snapshots. Behaviour is preserved verbatim.
 */

import type {
  ModelClient,
  ModelRequest,
  ModelToolSpec,
  ModelInputAttachment,
  ModelTextAttachmentFallback
} from '@qiongqi/ports'
import type {
  ToolHost,
  ToolHostContext,
  GuiPlanContext,
  ToolProviderKind
} from '@qiongqi/ports'
import type { ThreadStore } from '@qiongqi/ports'
import type { SessionStore } from '@qiongqi/ports'
import type { UsageService } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { IdGenerator } from '@qiongqi/ports'
import type { ApprovalPolicy } from '@qiongqi/contracts'
import type { ModelCapabilityMetadata } from '@qiongqi/contracts'
import type { TurnItem } from '@qiongqi/contracts'
import type { ImmutablePrefix } from '@qiongqi/cache'
import { ContextCompactor } from './context-compactor.js'
import type { ContextCompactionConfig } from './model-context-profile.js'
import { modelCapabilitiesForModel } from './model-context-profile.js'
import type { SkillRuntime } from '@qiongqi/skills'
import type { SkillPluginHost } from '@qiongqi/skills'
import type { AttachmentStore, AttachmentContent } from '@qiongqi/attachments'
import type { MemoryStore } from '@qiongqi/memory'
import type { UserInputResolution } from '@qiongqi/ports'
import {
  shouldVerifyImmutablePrefix,
  verifyImmutablePrefix
} from '@qiongqi/cache'
import { detectVolatilePrefixContent } from '@qiongqi/cache'
import { buildToolCatalogFingerprint } from '@qiongqi/cache'
import { repairModelHistoryItems } from '@qiongqi/domain'
import { healLoadedHistoryItems } from './history-healing.js'
import { makeUserItem, makeErrorItem } from '@qiongqi/domain'
import { touchThread } from '@qiongqi/domain'
import {
  applyTokenEconomyToRequest,
  normalizeTokenEconomyConfig,
  type TokenEconomyConfig
} from './token-economy.js'
import { applyRequestHistoryHygiene } from './request-history-hygiene.js'
import { estimateModelRequestInputTokens } from './model-request-estimator.js'
import {
  recentAutoRouterContext,
  resolveAutoModelRoute,
  type AutoModelRouteSelection
} from './auto-model-router.js'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'
import { shellRuntimeInstruction } from '@qiongqi/adapter-tools'
import {
  PLAN_MODE_INSTRUCTION,
  goalContinuationInstruction,
  todoContinuationInstruction,
  hasSuccessfulCreatePlanResult,
  allowedToolNamesWithGuiStateTools,
  normalizeApprovalPolicy,
  isAdditiveToolCatalogChange,
  buildToolCatalogDriftMessage,
  buildTextAttachmentFallback,
  attachmentRequestPipelineDetails,
  buildModelCompactionPrompt,
  effectiveHistoryAfterLatestCompaction,
  resolveModelMode,
  normalizeRequestedReasoningEffort,
  autoModelRouteKey,
  memoryInstructions,
  prefixVolatilityStageDetails,
  type ToolCatalogSnapshot,
  type ToolCatalogDrift,
  DEFAULT_COMPACTION_SUMMARY_TIMEOUT_MS,
  DEFAULT_COMPACTION_SUMMARY_MAX_TOKENS,
  DEFAULT_COMPACTION_SUMMARY_INPUT_MAX_BYTES
} from './loop-helpers.js'
import {
  recordPipelineStage,
  recordTokenEconomySavings,
  recordToolCatalogDrift
} from './loop-events.js'

type ThreadRecord = Awaited<ReturnType<ThreadStore['get']>>
type TurnRecord = Awaited<ReturnType<TurnService['getTurn']>>

export type BuildContext = {
  request: ModelRequest
  model: string
  modelCapabilities: ModelCapabilityMetadata
  reasoningEffort?: string
  thread: ThreadRecord
  turn: TurnRecord
  healedItems: readonly TurnItem[]
  activePlanContext: GuiPlanContext | undefined
  effectiveMode: 'agent' | 'plan' | undefined
  approvalPolicy: ApprovalPolicy
  planTurnActive: boolean
  allowedToolNames: readonly string[] | undefined
  activeSkillIds: readonly string[]
  activeGoalInstruction: string | null
  toolSpecs: ModelToolSpec[]
  toolProviderMetadata: Map<string, { providerId?: string; providerKind?: ToolProviderKind }>
  toolProviderKinds: Map<string, ToolProviderKind | undefined>
  toolKinds: Map<string, 'tool_call' | 'command_execution' | 'file_change' | undefined>
  toolCatalogDrift: ToolCatalogDrift
  attachments: { imageAttachments: ModelInputAttachment[]; textFallbacks: ModelTextAttachmentFallback[] }
}

export type BuildResult =
  | { kind: 'aborted' }
  | { kind: 'stop' }
  | { kind: 'built'; ctx: BuildContext }

export type PromptBuilderDeps = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  turns: TurnService
  usage: UsageService
  model: ModelClient
  toolHost: ToolHost
  compactor: ContextCompactor
  prefix: ImmutablePrefix
  ids: IdGenerator
  nowIso: () => string
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  skillRuntime?: SkillRuntime
  /**
   * v1 plugin host. When present, turn resolution (activation, instruction
   * injection, allowedToolNames, and permission enforcement) runs through it;
   * `skillRuntime` is kept as a legacy fallback. Both share the same
   * SkillTurnResolution shape.
   */
  skillPluginHost?: SkillPluginHost
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  tokenEconomy?: TokenEconomyConfig
  contextCompaction?: ContextCompactionConfig
  activePlanContext?: GuiPlanContext
  onActivePlanContextChange?: (context: GuiPlanContext | undefined) => void
  awaitUserInput: (
    threadId: string,
    turnId: string,
    input: {
      id: string
      itemId: string
      prompt: string
      questions: Array<{
        header: string
        id: string
        question: string
        options: Array<{ label: string; description: string }>
      }>
    },
    signal: AbortSignal
  ) => Promise<UserInputResolution>
}

export class PromptBuilder {
  private readonly autoModelRoutes = new Map<string, AutoModelRouteSelection>()
  private readonly promptTokenPressure = new Map<string, { model: string; promptTokens: number }>()
  private readonly toolCatalogSnapshots = new Map<string, ToolCatalogSnapshot>()

  constructor(private readonly deps: PromptBuilderDeps) {}

  /** Called by ModelStepRunner when a usage chunk reports prompt tokens. */
  recordPromptPressure(threadId: string, model: string, promptTokens: number): void {
    if (!threadId || promptTokens <= 0) return
    const current = this.promptTokenPressure.get(threadId)
    if (current && current.promptTokens >= promptTokens) return
    this.promptTokenPressure.set(threadId, { model, promptTokens })
  }

  /** Called by the orchestrator when a turn ends. */
  clearTurnAutoRoute(threadId: string, turnId: string): void {
    this.autoModelRoutes.delete(autoModelRouteKey(threadId, turnId))
  }

  async build(input: {
    threadId: string
    turnId: string
    signal: AbortSignal
    stepIndex: number
  }): Promise<BuildResult> {
    const { threadId, turnId, signal, stepIndex } = input
    if (shouldVerifyImmutablePrefix()) {
      verifyImmutablePrefix(this.deps.prefix)
    }
    const [thread, turn] = await Promise.all([
      this.deps.threadStore.get(threadId),
      this.deps.turns.getTurn(threadId, turnId)
    ])
    await recordPipelineStage(this.deps.events, { threadId, turnId, stage: 'input_received', details: { stepIndex } })
    const activePlanContext = turn?.guiPlan
      ? { ...turn.guiPlan, turnId }
      : this.deps.activePlanContext
    const budgetGate = await this.checkBudgetGate(thread, threadId, turnId)
    if (budgetGate === 'blocked') return { kind: 'stop' }
    const loadedItems = await this.deps.sessionStore.loadItems(threadId)
    const healed = healLoadedHistoryItems(loadedItems)
    if (healed.changed) {
      await this.deps.sessionStore.rewriteItems(threadId, healed.items)
    }
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'input_cached',
      details: prefixVolatilityStageDetails(detectVolatilePrefixContent(this.deps.prefix))
    })
    if (stepIndex > 0) {
      const toolResultCount = healed.items.filter(
        (item) => item.turnId === turnId && item.kind === 'tool_result'
      ).length
      await this.deps.events.record({
        kind: 'tool_result_upload_wait',
        threadId,
        turnId,
        status: 'waiting',
        toolResultCount
      })
    }
    const items = repairModelHistoryItems(
      effectiveHistoryAfterLatestCompaction(healed.items)
    )
    const approvalPolicy = normalizeApprovalPolicy(thread?.approvalPolicy)
    const effectiveMode = turn?.mode ?? thread?.mode
    const modelRoute = await this.resolveTurnModel({
      threadId,
      turnId,
      latestRequest: turn?.prompt ?? '',
      items,
      signal,
      reasoningEffort: turn?.reasoningEffort,
      candidates: [turn?.model, thread?.model, this.deps.model.model]
    })
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'input_routed',
      details: {
        model: modelRoute.model,
        ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {})
      }
    })
    const model = modelRoute.model
    const modelCapabilities = this.deps.modelCapabilities?.(model) ?? modelCapabilitiesForModel(model)
    const attachments = await this.resolveAttachments({
      attachmentIds: turn?.attachmentIds ?? [],
      threadId,
      workspace: thread?.workspace ?? '',
      modelCapabilities
    })
    const skillResolution = this.deps.skillPluginHost?.resolveTurn({
      prompt: turn?.prompt ?? '',
      workspace: thread?.workspace ?? ''
    }) ?? this.deps.skillRuntime?.resolveTurn({
      prompt: turn?.prompt ?? '',
      workspace: thread?.workspace ?? ''
    }) ?? {
      activeSkillIds: [],
      activations: [],
      instructions: [],
      injectedBytes: 0
    }
    const memories = await this.retrieveMemories({
      prompt: turn?.prompt ?? '',
      workspace: thread?.workspace ?? '',
      threadId,
      ownerUserId: thread?.ownerUserId
    })
    const planTurnActive = effectiveMode === 'plan' || Boolean(activePlanContext)
    const activeGoalInstruction = planTurnActive
      ? null
      : goalContinuationInstruction(thread?.goal)
    const activeTodoInstruction = todoContinuationInstruction(thread?.todos)
    const allowedToolNames = allowedToolNamesWithGuiStateTools(
      skillResolution.allowedToolNames,
      activeGoalInstruction !== null
    )
    const toolContext: ToolHostContext = {
      threadId,
      turnId,
      workspace: thread?.workspace ?? '',
      threadMode: effectiveMode,
      ...(activePlanContext ? { guiPlan: activePlanContext } : {}),
      model: modelCapabilities,
      activeSkillIds: skillResolution.activeSkillIds,
      memoryPolicy: { enabled: Boolean(this.deps.memoryStore) },
      delegationPolicy: { enabled: false },
      ...(allowedToolNames ? { allowedToolNames } : {}),
      approvalPolicy,
      abortSignal: signal,
      awaitApproval: async () => 'allow',
      awaitUserInput: (userInput) => this.deps.awaitUserInput(threadId, turnId, userInput, signal)
    }
    const tools = await this.deps.toolHost.listTools(toolContext)
    const toolSpecs: ModelToolSpec[] = tools
    const toolProviderMetadata = new Map(
      tools.map((tool) => [tool.name, { providerId: tool.providerId, providerKind: tool.providerKind }])
    )
    const toolCatalog = buildToolCatalogFingerprint(toolSpecs)
    const toolCatalogDrift = this.recordToolCatalogFingerprint({
      threadId,
      workspace: thread?.workspace ?? '',
      mode: effectiveMode ?? 'agent',
      model: modelCapabilities.id,
      activeSkillIds: skillResolution.activeSkillIds,
      allowedToolNames,
      fingerprint: toolCatalog.fingerprint,
      toolNames: toolCatalog.toolNames,
      toolHashes: toolCatalog.toolHashes
    })
    const toolCatalogDriftMessage = toolCatalogDrift.kind !== 'none'
      ? buildToolCatalogDriftMessage(toolCatalog, toolCatalogDrift.kind)
      : undefined
    if (toolCatalogDrift.kind !== 'none' && toolCatalogDriftMessage) {
      await recordToolCatalogDrift(this.deps.turns, this.deps.events, {
        threadId,
        turnId,
        fingerprint: toolCatalog.fingerprint,
        toolCount: toolCatalog.toolCount,
        toolNames: toolCatalog.toolNames,
        changeKind: toolCatalogDrift.kind,
        message: toolCatalogDriftMessage
      })
    }
    if (turn) {
      await this.deps.turns.updateTurnMetadata(threadId, turnId, {
        activeSkillIds: skillResolution.activeSkillIds,
        skillInjectionBytes: skillResolution.injectedBytes,
        injectedMemoryIds: memories.map((memory) => memory.id),
        toolCatalogFingerprint: toolCatalog.fingerprint,
        toolCatalogToolCount: toolCatalog.toolCount,
        toolCatalogDrift: toolCatalogDrift.kind !== 'none'
      })
    }
    if (toolCatalogDrift.kind === 'breaking') return { kind: 'stop' }
    const toolKinds = new Map(toolSpecs.map((tool) => [tool.name, tool.toolKind]))
    const createPlanSatisfied = planTurnActive
      ? hasSuccessfulCreatePlanResult(healed.items, turnId)
      : false
    const requiredToolName =
      planTurnActive &&
      !createPlanSatisfied &&
      toolSpecs.some((tool) => tool.name === CREATE_PLAN_TOOL_NAME)
        ? CREATE_PLAN_TOOL_NAME
        : undefined
    const history = await this.compactIfNeeded(items, model, signal, { threadId, turnId })
    if (signal.aborted) return { kind: 'aborted' }
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'input_compressed',
      details: { historyItems: history.length }
    })
    const contextInstructions = [
      ...(activeGoalInstruction ? [activeGoalInstruction] : []),
      ...(activeTodoInstruction ? [activeTodoInstruction] : []),
      ...memoryInstructions(memories),
      ...skillResolution.instructions,
      ...(toolSpecs.some((tool) => tool.name === 'bash') ? [shellRuntimeInstruction()] : []),
      ...(toolCatalogDriftMessage ? [toolCatalogDriftMessage] : [])
    ]
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'input_remembered',
      details: {
        memoryCount: memories.length,
        contextInstructionCount: contextInstructions.length
      }
    })
    const tokenEconomy = normalizeTokenEconomyConfig(this.deps.tokenEconomy)
    const baseRequest: ModelRequest = {
      threadId,
      turnId,
      model,
      systemPrompt: this.deps.prefix.systemPrompt,
      ...(planTurnActive ? { modeInstruction: PLAN_MODE_INSTRUCTION } : {}),
      ...(contextInstructions.length ? { contextInstructions } : {}),
      prefix: this.deps.prefix.fewShots,
      history,
      ...(attachments.imageAttachments.length ? { attachments: attachments.imageAttachments } : {}),
      ...(attachments.textFallbacks.length ? { attachmentTextFallbacks: attachments.textFallbacks } : {}),
      tools: toolSpecs,
      ...(requiredToolName ? { requiredToolName } : {}),
      ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {}),
      abortSignal: signal
    }
    const rawInputTokens = tokenEconomy.enabled
      ? estimateModelRequestInputTokens(baseRequest)
      : 0
    const economyRequest = applyTokenEconomyToRequest(baseRequest, tokenEconomy)
    const request: ModelRequest = {
      ...economyRequest,
      history: applyRequestHistoryHygiene(economyRequest.history, tokenEconomy.historyHygiene)
    }
    if (tokenEconomy.enabled) {
      await recordTokenEconomySavings(this.deps.usage, this.deps.events, {
        threadId,
        turnId,
        model,
        rawInputTokens,
        sentInputTokens: estimateModelRequestInputTokens(request)
      })
    }
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'pre_send',
      details: {
        model: request.model,
        historyItems: request.history.length,
        toolCount: request.tools.length,
        ...(request.requiredToolName ? { requiredToolName: request.requiredToolName } : {}),
        ...attachmentRequestPipelineDetails({
          attachmentIds: turn?.attachmentIds ?? [],
          imageAttachments: attachments.imageAttachments,
          textFallbacks: attachments.textFallbacks,
          modelCapabilities
        })
      }
    })
    await recordPipelineStage(this.deps.events, {
      threadId,
      turnId,
      stage: 'post_send',
      details: { model: request.model }
    })

    const ctx: BuildContext = {
      request,
      model,
      modelCapabilities,
      ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {}),
      thread,
      turn,
      healedItems: healed.items,
      activePlanContext,
      effectiveMode,
      approvalPolicy,
      planTurnActive,
      allowedToolNames,
      activeSkillIds: skillResolution.activeSkillIds,
      activeGoalInstruction,
      toolSpecs,
      toolProviderMetadata,
      toolProviderKinds: new Map(tools.map((tool) => [tool.name, tool.providerKind])),
      toolKinds,
      toolCatalogDrift,
      attachments
    }
    return { kind: 'built', ctx }
  }

  private async resolveTurnModel(input: {
    threadId: string
    turnId: string
    latestRequest: string
    items: readonly TurnItem[]
    signal: AbortSignal
    reasoningEffort?: string
    candidates: Array<string | undefined>
  }): Promise<{ model: string; reasoningEffort?: string }> {
    const requestedReasoningEffort = normalizeRequestedReasoningEffort(input.reasoningEffort)
    const resolved = resolveModelMode(...input.candidates)
    if (resolved.kind === 'fixed') {
      return {
        model: resolved.model,
        ...(requestedReasoningEffort ? { reasoningEffort: requestedReasoningEffort } : {})
      }
    }
    const key = autoModelRouteKey(input.threadId, input.turnId)
    const cached = this.autoModelRoutes.get(key)
    if (cached) {
      return {
        model: cached.model,
        reasoningEffort: requestedReasoningEffort ?? cached.reasoningEffort
      }
    }
    const route = await resolveAutoModelRoute({
      modelClient: this.deps.model,
      threadId: input.threadId,
      turnId: input.turnId,
      latestRequest: input.latestRequest,
      recentContext: recentAutoRouterContext(input.items, input.turnId),
      selectedModelMode: 'auto',
      abortSignal: input.signal
    })
    this.autoModelRoutes.set(key, route)
    return {
      model: route.model,
      reasoningEffort: requestedReasoningEffort ?? route.reasoningEffort
    }
  }

  private async resolveAttachments(input: {
    attachmentIds: readonly string[]
    threadId: string
    workspace: string
    modelCapabilities: ModelCapabilityMetadata
  }): Promise<{ imageAttachments: ModelInputAttachment[]; textFallbacks: ModelTextAttachmentFallback[] }> {
    if (input.attachmentIds.length === 0) return { imageAttachments: [], textFallbacks: [] }
    if (!this.deps.attachmentStore) {
      throw new Error('attachment store is unavailable')
    }
    const supportsImageInput = input.modelCapabilities.inputModalities.includes('image')
    const textFallbackPolicy = this.deps.attachmentStore.textFallbackPolicy()
    const imageAttachments: ModelInputAttachment[] = []
    const textFallbacks: ModelTextAttachmentFallback[] = []
    for (const id of input.attachmentIds) {
      const attachment = await this.deps.attachmentStore.resolveContent(id, {
        threadId: input.threadId,
        workspace: input.workspace
      })
      if (supportsImageInput) {
        imageAttachments.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataBase64: attachment.data.toString('base64'),
          ...(attachment.width ? { width: attachment.width } : {}),
          ...(attachment.height ? { height: attachment.height } : {})
        })
        continue
      }
      textFallbacks.push(buildTextAttachmentFallback(
        attachment,
        textFallbackPolicy.textFallbackMaxBase64Bytes
      ))
    }
    return { imageAttachments, textFallbacks }
  }

  private async retrieveMemories(input: {
    prompt: string
    workspace: string
    threadId: string
    ownerUserId?: string
  }) {
    if (!this.deps.memoryStore) return []
    const memories = await this.deps.memoryStore.retrieve({
      query: input.prompt,
      workspace: input.workspace,
      threadId: input.threadId,
      ownerUserId: input.ownerUserId,
      limit: 8
    })
    this.deps.memoryStore.setLastInjected(memories.map((memory) => memory.id))
    return memories
  }

  private recordToolCatalogFingerprint(input: {
    threadId: string
    workspace: string
    mode: string
    model: string
    activeSkillIds: readonly string[]
    allowedToolNames?: readonly string[]
    fingerprint: string
    toolNames: string[]
    toolHashes: Record<string, string>
  }): ToolCatalogDrift {
    const key = JSON.stringify({
      threadId: input.threadId,
      workspace: input.workspace,
      mode: input.mode,
      model: input.model,
      activeSkillIds: [...input.activeSkillIds].sort(),
      allowedToolNames: input.allowedToolNames ? [...input.allowedToolNames].sort() : []
    })
    const current: ToolCatalogSnapshot = {
      fingerprint: input.fingerprint,
      toolNames: input.toolNames,
      toolHashes: input.toolHashes
    }
    const previous = this.toolCatalogSnapshots.get(key)
    this.toolCatalogSnapshots.set(key, current)
    if (!previous || previous.fingerprint === input.fingerprint) return { kind: 'none' }
    return isAdditiveToolCatalogChange(previous, current)
      ? { kind: 'additive', previous }
      : { kind: 'breaking', previous }
  }

  private async checkBudgetGate(
    thread: ThreadRecord,
    threadId: string,
    turnId: string
  ): Promise<'allow' | 'blocked'> {
    if (!thread) return 'allow'
    const budget = thread.costBudgetUsd
    if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) return 'allow'
    const spent = this.deps.usage.forThread(threadId).costUsd ?? 0
    if (spent >= budget) {
      const message = `Cost budget exhausted for this thread: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      await this.deps.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_limited`,
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      }))
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      })
      return 'blocked'
    }
    if (spent >= budget * 0.8 && thread.costBudgetWarningSent !== true) {
      const message = `Cost budget warning: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      await this.deps.threadStore.upsert({
        ...thread,
        costBudgetWarningSent: true,
        updatedAt: this.deps.nowIso()
      })
      await this.deps.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_warning`,
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      }))
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      })
    }
    return 'allow'
  }

  private consumePromptPressure(
    threadId: string,
    model: string
  ): { model: string; promptTokens: number } | undefined {
    if (!threadId) return undefined
    const pressure = this.promptTokenPressure.get(threadId)
    if (!pressure) return undefined
    this.promptTokenPressure.delete(threadId)
    return {
      model: pressure.model || model,
      promptTokens: pressure.promptTokens
    }
  }

  private async compactIfNeeded(
    items: TurnItem[],
    model: string,
    signal: AbortSignal,
    context: { threadId: string; turnId: string }
  ): Promise<TurnItem[]> {
    const pressure = this.consumePromptPressure(context.threadId, model)
    const thresholdModel = pressure?.model || model
    const plan = this.deps.compactor.planCompaction(items, { model: thresholdModel, promptTokens: pressure?.promptTokens })
    if (!plan) return items
    const threadId = context.threadId
    const turnId = context.turnId
    let result = this.deps.compactor.compact({
      threadId,
      turnId,
      history: items,
      prefix: this.deps.prefix,
      reason: plan.reason,
      mode: plan.mode,
      keepRecent: plan.keepRecent
    })
    if (result.replacedTokens > 0 && this.deps.contextCompaction?.summaryMode === 'model') {
      const modelSummary = await this.summarizeCompactionWithModel({
        threadId,
        turnId,
        model,
        items,
        heuristicSummary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
        signal
      })
      if (signal.aborted) return items
      if (modelSummary) {
        result = this.deps.compactor.compact({
          threadId,
          turnId,
          history: items,
          prefix: this.deps.prefix,
          reason: plan.reason,
          mode: plan.mode,
          keepRecent: plan.keepRecent,
          summaryOverride: modelSummary
        })
      }
    }
    if (result.replacedTokens > 0) {
      this.deps.toolHost.clearReadTracker?.(threadId)
      await this.deps.sessionStore.appendItem(threadId, result.summaryItem)
      await this.deps.events.record({
        kind: 'compaction_completed',
        threadId,
        turnId,
        itemId: result.summaryItem.id,
        summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
        replacedTokens: result.replacedTokens,
        pinnedConstraints: this.deps.prefix.pinnedConstraints,
        ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceDigest
          ? { sourceDigest: result.summaryItem.sourceDigest }
          : {}),
        ...(result.summaryItem.kind === 'compaction' && result.summaryItem.digestMarker
          ? { digestMarker: result.summaryItem.digestMarker }
          : {}),
        ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
          ? { sourceItemIds: result.summaryItem.sourceItemIds }
          : {})
      })
    }
    return result.next
  }

  private async summarizeCompactionWithModel(input: {
    threadId: string
    turnId: string
    model: string
    items: TurnItem[]
    heuristicSummary: string
    signal: AbortSignal
  }): Promise<string | undefined> {
    if (input.signal.aborted) return undefined
    const timeoutMs = Math.max(
      1,
      Math.floor(this.deps.contextCompaction?.summaryTimeoutMs ?? DEFAULT_COMPACTION_SUMMARY_TIMEOUT_MS)
    )
    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    input.signal.addEventListener('abort', onAbort, { once: true })
    let fallbackRecorded = false
    const recordFallback = async (message: string): Promise<void> => {
      if (fallbackRecorded || input.signal.aborted) return
      fallbackRecorded = true
      await this.deps.events.record({
        kind: 'error',
        threadId: input.threadId,
        turnId: input.turnId,
        message,
        code: 'compaction_summary_fallback',
        severity: 'warning'
      })
    }
    try {
      const requestItem = makeUserItem({
        id: `item_${input.turnId}_compaction_summary_request`,
        turnId: input.turnId,
        threadId: input.threadId,
        text: buildModelCompactionPrompt({
          items: input.items,
          heuristicSummary: input.heuristicSummary,
          maxBytes: this.deps.contextCompaction?.summaryInputMaxBytes ?? DEFAULT_COMPACTION_SUMMARY_INPUT_MAX_BYTES
        })
      })
      let text = ''
      for await (const chunk of this.deps.model.stream({
        threadId: input.threadId,
        turnId: input.turnId,
        model: input.model,
        systemPrompt: this.deps.prefix.systemPrompt,
        contextInstructions: [
          'Summarize context for a history fold. Preserve durable task state and omit transient chatter.'
        ],
        prefix: this.deps.prefix.fewShots,
        history: [requestItem],
        tools: [],
        stream: true,
        maxTokens: Math.max(
          1,
          Math.floor(this.deps.contextCompaction?.summaryMaxTokens ?? DEFAULT_COMPACTION_SUMMARY_MAX_TOKENS)
        ),
        temperature: 0,
        reasoningEffort: 'off',
        abortSignal: controller.signal
      })) {
        if (input.signal.aborted) return undefined
        if (controller.signal.aborted) {
          await recordFallback(
            `Model compaction summary timed out after ${timeoutMs}ms; using heuristic summary.`
          )
          return undefined
        }
        if (chunk.kind === 'assistant_text_delta') text += chunk.text
        if (chunk.kind === 'usage') {
          const usage = this.deps.usage.record(input.threadId, chunk.usage)
          await this.deps.events.record({
            kind: 'usage',
            threadId: input.threadId,
            turnId: input.turnId,
            model: input.model,
            usage
          })
        }
        if (chunk.kind === 'error') {
          await recordFallback(
            `Model compaction summary failed${chunk.code ? ` (${chunk.code})` : ''}: ${chunk.message}. Using heuristic summary.`
          )
          return undefined
        }
      }
      const summary = text.trim()
      if (!summary) {
        await recordFallback('Model compaction summary returned empty text; using heuristic summary.')
        return undefined
      }
      return summary ? summary : undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const reason = controller.signal.aborted && !input.signal.aborted
        ? `Model compaction summary timed out after ${timeoutMs}ms`
        : `Model compaction summary threw: ${message}`
      await recordFallback(`${reason}; using heuristic summary.`)
      return undefined
    } finally {
      clearTimeout(timeout)
      input.signal.removeEventListener('abort', onAbort)
    }
  }
}
