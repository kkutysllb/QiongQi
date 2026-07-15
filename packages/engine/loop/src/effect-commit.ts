import { createHash, randomUUID } from 'node:crypto'
import type { EffectIntent, RunEventEnvelope, RunIdentity, RunStateV3, ToolEffectPolicy } from '@qiongqi/contracts'
import type { EffectResultStore, RunEventStore } from '@qiongqi/ports'

export type EffectCommitOptions = {
  events: RunEventStore
  results: EffectResultStore
  nowIso?: () => string
}

export function digestValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]))
}

export class EffectCommitCoordinator {
  private readonly nowIso: () => string

  constructor(private readonly options: EffectCommitOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  idempotencyKey(identity: RunIdentity, callId: string): string {
    return `${identity.ownerUserId}:${identity.workspaceKey}:${identity.runId}:${callId}`
  }

  prepare(state: RunStateV3, identity: RunIdentity, input: { callId: string; kind?: EffectIntent['kind']; target: string; arguments: Record<string, unknown> }, policy: ToolEffectPolicy): { state: RunStateV3; intent: EffectIntent } {
    const now = this.nowIso()
    const intent: EffectIntent = { idempotencyKey: this.idempotencyKey(identity, input.callId), kind: input.kind ?? 'tool', effect: policy.effect, replay: policy.replay, target: input.target, payloadDigest: digestValue(input.arguments), preparedAt: now }
    if (state.pendingEffects.some((candidate) => candidate.idempotencyKey === intent.idempotencyKey)) return { state, intent }
    return { state: { ...state, pendingEffects: [...state.pendingEffects, intent], updatedAt: now }, intent }
  }

  async recordPrepared(identity: RunIdentity, state: RunStateV3, intent: EffectIntent): Promise<RunEventEnvelope> {
    return this.append(identity, state, 'effect.prepared', intent, intent.idempotencyKey)
  }

  async commit(identity: RunIdentity, state: RunStateV3, intent: EffectIntent, result: unknown): Promise<{ state: RunStateV3; event: RunEventEnvelope }> {
    const existing = state.committedEffects.find((candidate) => candidate.idempotencyKey === intent.idempotencyKey)
    if (existing) return { state, event: await this.append(identity, state, 'effect.committed', existing, intent.idempotencyKey) }
    const now = this.nowIso()
    const committed = { idempotencyKey: intent.idempotencyKey, resultDigest: digestValue(result), status: 'committed' as const, committedAt: now }
    await this.options.results.save(identity, intent.idempotencyKey, committed.resultDigest, result)
    return { state: { ...state, pendingEffects: state.pendingEffects.filter((candidate) => candidate.idempotencyKey !== intent.idempotencyKey), committedEffects: [...state.committedEffects, committed], updatedAt: now }, event: await this.append(identity, state, 'effect.committed', committed, intent.idempotencyKey) }
  }

  async storedResult(identity: RunIdentity, idempotencyKey: string): Promise<unknown> {
    return (await this.options.results.load(identity, idempotencyKey))?.result
  }

  private async append(identity: RunIdentity, state: RunStateV3, eventType: string, payload: unknown, idempotencyKey: string): Promise<RunEventEnvelope> {
    const events = await this.options.events.listAfter(identity, 0)
    return this.options.events.append({ eventId: randomUUID(), seq: Math.max(0, ...events.map((event) => event.seq)) + 1, ...identity, stepId: state.cursor.nodeId, nodeAttemptId: `${state.cursor.nodeId}:${state.cursor.attempt}`, eventType, idempotencyKey, payload, timestamp: this.nowIso() })
  }
}
