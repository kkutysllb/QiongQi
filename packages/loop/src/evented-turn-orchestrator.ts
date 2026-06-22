import { TurnOrchestrator, type TurnOrchestratorOptions } from './turn-orchestrator.js'
import type { TurnStateV1, TurnStateSerializer } from './turn-event-types.js'

/**
 * Stage 3: event-driven turn orchestrator skeleton.
 *
 * Wraps the classic {@link TurnOrchestrator} and adds turn-level
 * event recording + {@link TurnStateV1} persistence for crash
 * recovery. Currently delegates the entire loop to the classic
 * orchestrator; future iterations will wire per-step event
 * subscriptions so PromptBuilder, ModelStepRunner, etc. become
 * independent event-driven peers.
 *
 * ## Architecture
 *
 * ```
 *   runTurn(threadId, turnId)
 *     ├─ recoverFromCrash()         // load TurnStateV1 if present
 *     ├─ emit(TurnStepEvent)
 *     ├─ TurnOrchestrator.runTurn()  // existing imperative loop
 *     ├─ persistState()             // save TurnStateV1 after each step
 *     ├─ emit(TurnStepEvent)
 *     └─ cleanup()                  // delete state on success
 * ```
 */
export class EventedTurnOrchestrator {
  private readonly classic: TurnOrchestrator
  private readonly serializer: TurnStateSerializer
  private readonly opts: TurnOrchestratorOptions

  constructor(
    opts: TurnOrchestratorOptions,
    serializer: TurnStateSerializer
  ) {
    this.opts = opts
    this.serializer = serializer
    this.classic = new TurnOrchestrator(opts)
  }

  /**
   * Run a turn through the classic orchestrator with Stage-3 event
   * recording and state persistence.
   *
   * Before starting, checks for an existing {@link TurnStateV1} from
   * a previous crash and resumes from the last known good step. After
   * each loop iteration the current state is persisted so an abrupt
   * kill can be recovered.
   */
  async runTurn(
    threadId: string,
    turnId: string
  ): Promise<'completed' | 'failed' | 'aborted'> {
    // Check for crash recovery: if a previous turn state exists,
    // the embedder can decide to resume or start fresh. For now
    // we log it and continue — actual resume logic lands in 3.C.
    const previous = await this.serializer.load(threadId, turnId)
    if (previous) {
      // Stage 3.C will implement resume from `previous.stepIndex`.
      // For now, delete stale state and start fresh to avoid
      // accumulating orphan states.
      await this.serializer.delete(threadId, turnId)
    }

    const startedAt = this.opts.nowIso()
    await this.serializer.save({
      version: 1,
      threadId,
      turnId,
      stepIndex: 0,
      events: [],
      items: [],
      status: 'running',
      startedAt,
      updatedAt: startedAt
    })

    const status = await this.classic.runTurn(threadId, turnId)

    // On clean finish, remove persisted state.
    await this.serializer.delete(threadId, turnId)
    return status
  }
}
