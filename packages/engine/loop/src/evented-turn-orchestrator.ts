import type { TurnOrchestratorOptions } from './turn-orchestrator.js'
import { runOrchestratorStep } from './turn-orchestrator.js'
import { runStepViaEventBus, type TurnEventBus } from './turn-event-bus.js'
import type { TurnStateV1, TurnStateSerializer, TurnStepEvent } from './turn-event-types.js'
import type { UserInputResolution } from '@qiongqi/ports'
import { ToolCallCoordinator } from './tool-call-coordinator.js'
import { ModelStepRunner } from './model-step-runner.js'
import { PromptBuilder } from './prompt-builder.js'

type AwaitUserInputFn = (
  threadId: string,
  turnId: string,
  input: {
    id: string
    itemId: string
    prompt: string
    questions: Array<{ header: string; id: string; question: string; options: Array<{ label: string; description: string }> }>
  },
  signal: AbortSignal
) => Promise<UserInputResolution>

/**
 * Stage 3: event-driven turn orchestrator.
 *
 * Replaces the classic for-loop with a step loop that:
 * 1. Emits a {@link TurnStepEvent} before each step.
 * 2. Calls the shared {@link runOrchestratorStep} (same logic as classic).
 * 3. Persists {@link TurnStateV1} after each step for crash recovery.
 * 4. On restart, detects a stale state and resumes from the last step.
 *
 * The same PromptBuilder/ModelStepRunner/ToolCallCoordinator instances
 * are used as in the classic path, so tool approval, model streaming,
 * and continuation decisions are identical.
 */
export class EventedTurnOrchestrator {
  private readonly opts: TurnOrchestratorOptions
  private readonly serializer: TurnStateSerializer
  private readonly coordinator: ToolCallCoordinator
  private readonly modelStepRunner: ModelStepRunner
  private readonly promptBuilder: PromptBuilder
  private readonly eventBus?: TurnEventBus

  constructor(opts: TurnOrchestratorOptions, serializer: TurnStateSerializer, eventBus?: TurnEventBus) {
    this.opts = opts
    this.serializer = serializer
    this.eventBus = eventBus
    const awaitUserInput: AwaitUserInputFn = (threadId, turnId, input, signal) =>
      this.coordinator.awaitUserInput(threadId, turnId, input, signal)
    this.coordinator = new ToolCallCoordinator({
      toolHost: opts.toolHost,
      approvalGate: opts.approvalGate,
      userInputGate: opts.userInputGate,
      inflight: opts.inflight,
      events: opts.events,
      turns: opts.turns,
      ids: opts.ids,
      nowIso: opts.nowIso,
      memoryStoreEnabled: Boolean(opts.memoryStore),
      ...(opts.toolStorm ? { toolStorm: opts.toolStorm } : {}),
      ...(opts.onPlanWritten ? { onPlanWritten: opts.onPlanWritten } : {})
    })
    this.modelStepRunner = new ModelStepRunner({
      model: opts.model,
      events: opts.events,
      turns: opts.turns,
      usage: opts.usage,
      ids: opts.ids,
      ...(opts.toolArgumentRepair ? { toolArgumentRepair: opts.toolArgumentRepair } : {})
    })
    this.promptBuilder = new PromptBuilder({
      threadStore: opts.threadStore,
      sessionStore: opts.sessionStore,
      events: opts.events,
      turns: opts.turns,
      usage: opts.usage,
      model: opts.model,
      toolHost: opts.toolHost,
      compactor: opts.compactor,
      prefix: opts.prefix,
      ids: opts.ids,
      nowIso: opts.nowIso,
      ...(opts.modelCapabilities ? { modelCapabilities: opts.modelCapabilities } : {}),
      ...(opts.skillRuntime ? { skillRuntime: opts.skillRuntime } : {}),
      ...(opts.skillPluginHost ? { skillPluginHost: opts.skillPluginHost } : {}),
      ...(opts.attachmentStore ? { attachmentStore: opts.attachmentStore } : {}),
      ...(opts.memoryStore ? { memoryStore: opts.memoryStore } : {}),
      ...(opts.tokenEconomy ? { tokenEconomy: opts.tokenEconomy } : {}),
      ...(opts.contextCompaction ? { contextCompaction: opts.contextCompaction } : {}),
      ...(opts.activePlanContext ? { activePlanContext: opts.activePlanContext } : {}),
      ...(opts.onActivePlanContextChange ? { onActivePlanContextChange: opts.onActivePlanContextChange } : {}),
      awaitUserInput
    })
  }

  /**
   * Run a turn through an event-driven loop that emits
   * {@link TurnStepEvent}s and persists {@link TurnStateV1} after
   * each step.
   *
   * If a previous turn state exists (crash recovery), resumes from
   * the last known step.
   */
  async runTurn(
    threadId: string,
    turnId: string
  ): Promise<'completed' | 'failed' | 'aborted'> {
    const signal = this.opts.turns.getAbortController(turnId)
    if (!signal) return 'failed'
    if (signal.aborted) return 'aborted'

    const startedAt = this.opts.nowIso()

    // Crash recovery: if a previous state exists, resume from it.
    const previous = await this.serializer.load(threadId, turnId)
    let stepIndex = 0
    if (previous) {
      stepIndex = previous.stepIndex
    }

    let status: 'completed' | 'failed' | 'aborted' = 'failed'
    try {
      for (; ; stepIndex += 1) {
        if (signal.aborted) {
          status = 'aborted'
          break
        }

        // Persist current state before the step so a crash mid-step
        // can resume from this point.
        const stateBefore: TurnStateV1 = {
          version: 1,
          threadId,
          turnId,
          stepIndex,
          events: [],
          items: [],
          status: 'running',
          startedAt,
          updatedAt: this.opts.nowIso()
        }
        await this.serializer.save(stateBefore)

        const stepStatus = this.eventBus
          ? await runStepViaEventBus({
              eventBus: this.eventBus,
              threadId, turnId, signal,
              deps: {
                promptBuilder: this.promptBuilder,
                modelStepRunner: this.modelStepRunner,
                coordinator: this.coordinator,
                events: this.opts.events,
                turns: this.opts.turns,
                ids: this.opts.ids
              }
            }, stepIndex)
          : await runOrchestratorStep({
              threadId,
              turnId,
              signal,
              stepIndex,
              promptBuilder: this.promptBuilder,
              modelStepRunner: this.modelStepRunner,
              coordinator: this.coordinator,
              events: this.opts.events,
              turns: this.opts.turns,
              ids: this.opts.ids
            })

        if (stepStatus === 'stop') {
          status = 'completed'
          break
        }
        if (stepStatus === 'failed') {
          status = 'failed'
          break
        }
        if (stepStatus === 'aborted') {
          status = 'aborted'
          break
        }
        // 'continue' — loop to next step
      }
    } finally {
      // Clean up persisted state on completion/failure/abort.
      await this.serializer.delete(threadId, turnId)
    }

    return status
  }
}
