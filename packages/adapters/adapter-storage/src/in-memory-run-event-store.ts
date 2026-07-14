import { RunEventEnvelopeSchema, encodeScopeKey, type RunEventEnvelope, type RunIdentity } from '@qiongqi/contracts'
import type { RunEventStore } from '@qiongqi/ports'

function eventKey(event: RunEventEnvelope): string {
  return encodeScopeKey({
    ownerUserId: event.ownerUserId,
    workspaceKey: event.workspaceKey,
    threadId: event.threadId,
    turnId: event.turnId,
    runId: event.runId,
    purpose: 'runtime'
  })
}

function identityKey(identity: RunIdentity): string {
  return encodeScopeKey({
    ownerUserId: identity.ownerUserId,
    workspaceKey: identity.workspaceKey,
    threadId: identity.threadId,
    turnId: identity.turnId,
    runId: identity.runId,
    purpose: 'runtime'
  })
}

export class InMemoryRunEventStore implements RunEventStore {
  private readonly events = new Map<string, RunEventEnvelope[]>()

  async append(input: RunEventEnvelope): Promise<RunEventEnvelope> {
    const event = RunEventEnvelopeSchema.parse(input)
    const key = eventKey(event)
    const list = this.events.get(key) ?? []
    const existing = list.find((candidate) => candidate.eventId === event.eventId)
    if (existing) return structuredClone(existing)
    if (list.some((candidate) => candidate.seq === event.seq)) {
      throw new Error(`duplicate run event sequence ${event.seq}`)
    }
    list.push(structuredClone(event))
    list.sort((a, b) => a.seq - b.seq)
    this.events.set(key, list)
    return structuredClone(event)
  }

  async listAfter(identity: RunIdentity, seq: number): Promise<RunEventEnvelope[]> {
    return structuredClone((this.events.get(identityKey(identity)) ?? []).filter((event) => event.seq > seq))
  }
}
