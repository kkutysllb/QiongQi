import {
  RuntimeEvent as RuntimeEventSchema,
  type UsageEvent,
  type RuntimeEvent
} from '@qiongqi/contracts'
import type { EventBus } from '@qiongqi/ports'
import type { SessionStore } from '@qiongqi/ports'
import type { RunEventEnvelope } from '@qiongqi/contracts'
import type { RunEventStore } from '@qiongqi/ports'

type RuntimeEventWithoutStamp<Event extends RuntimeEvent> = Omit<Event, 'seq' | 'timestamp'> &
  Partial<Pick<Event, 'seq' | 'timestamp'>>

export type RuntimeEventDraft = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? RuntimeEventWithoutStamp<Event>
    : never
  : never

export type RuntimeEventRecorderOptions = {
  eventBus: EventBus
  sessionStore: SessionStore
  allocateSeq: (threadId: string) => number
  nowIso: () => string
  usageSink?: (event: UsageEvent) => Promise<void> | void
  runEventStore?: RunEventStore
}

/**
 * Application-level event boundary.
 *
 * Services and loops produce semantic event drafts; this recorder
 * stamps ordering/time, validates the public contract, fans out to
 * live subscribers, and persists the same event for SSE replay.
 */
export class RuntimeEventRecorder {
  private readonly options: RuntimeEventRecorderOptions

  constructor(options: RuntimeEventRecorderOptions) {
    this.options = options
  }

  async record(draft: RuntimeEventDraft): Promise<RuntimeEvent> {
    const allocatedSeq = this.options.allocateSeq(draft.threadId)
    const persistedSeq = await this.options.sessionStore.highestSeq(draft.threadId)
    const event = RuntimeEventSchema.parse({
      ...draft,
      seq: draft.seq ?? Math.max(allocatedSeq, persistedSeq + 1),
      timestamp: draft.timestamp ?? this.options.nowIso()
    })
    this.options.eventBus.publish(event)
    await this.options.sessionStore.appendEvent(event.threadId, event)
    if (event.kind === 'usage') {
      await this.options.usageSink?.(event)
    }
    return event
  }

  async recordKernelEvent(event: RunEventEnvelope): Promise<RunEventEnvelope> {
    if (!this.options.runEventStore) throw new Error('run event store is not configured')
    return this.options.runEventStore.append(event)
  }
}
