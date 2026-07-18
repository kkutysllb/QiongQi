import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RunEventEnvelopeSchema, type RunEventEnvelope, type RunIdentity } from '@qiongqi/contracts'
import type { LeaseFence, RunEventStore } from '@qiongqi/ports'
import { withFileLock } from './file-lock.js'

export type FileRunEventStoreOptions = { requireFence?: boolean }

function runScopeDir(identity: RunIdentity): string {
  return join(identity.threadId, identity.turnId, identity.runId)
}

export class FileRunEventStore implements RunEventStore {
  public readonly rootDir: string

  constructor(rootDir: string, private readonly options: FileRunEventStoreOptions = {}) {
    this.rootDir = resolve(rootDir)
  }

  async append(input: RunEventEnvelope, fence?: LeaseFence): Promise<RunEventEnvelope> {
    const event = RunEventEnvelopeSchema.parse(input)
    return this.withLock(event, async () => {
      await this.assertFence(event, fence)
      const existing = await this.readEvents(event)
      const duplicate = existing.find((candidate) => candidate.eventId === event.eventId)
      if (duplicate) return duplicate
      if (existing.some((candidate) => candidate.seq === event.seq)) {
        throw new Error(`duplicate run event sequence ${event.seq}`)
      }
      await mkdir(this.eventDir(event), { recursive: true })
      await appendFile(this.eventPath(event), `${JSON.stringify(event)}\n`, 'utf8')
      return event
    })
  }

  private async assertFence(event: RunEventEnvelope, fence?: LeaseFence): Promise<void> {
    if (!this.options.requireFence) return
    if (!fence) throw new Error('runtime event write requires an active lease fence')
    try {
      const raw = await readFile(this.leasePath(event), 'utf8')
      const lease = JSON.parse(raw) as { holderId?: string; epoch?: number; token?: string; expiresAt?: string }
      if (lease.holderId !== fence.holderId || lease.epoch !== fence.epoch || lease.token !== fence.token || !lease.expiresAt || Date.parse(lease.expiresAt) <= Date.now()) throw new Error('stale lease fence')
    } catch (error) {
      if (error instanceof Error && error.message === 'stale lease fence') throw new Error('runtime event write rejected by stale lease fence')
      throw new Error('runtime event write rejected: active lease fence unavailable')
    }
  }

  private async withLock<T>(identity: RunIdentity, operation: () => Promise<T>): Promise<T> {
    return withFileLock(this.leasePath(identity), operation)
  }

  async listAfter(identity: RunIdentity, seq: number): Promise<RunEventEnvelope[]> {
    return (await this.readEvents(identity)).filter((event) => event.seq > seq)
  }

  private eventDir(identity: RunIdentity | RunEventEnvelope): string {
    return join(this.rootDir, runScopeDir(identity))
  }

  private eventPath(identity: RunIdentity | RunEventEnvelope): string {
    return join(this.eventDir(identity), 'events.jsonl')
  }

  private leasePath(identity: RunIdentity | RunEventEnvelope): string {
    return join(this.eventDir(identity), 'lease.json')
  }

  private async readEvents(identity: RunIdentity | RunEventEnvelope): Promise<RunEventEnvelope[]> {
    try {
      const lines = (await readFile(this.eventPath(identity), 'utf8')).split('\n').filter(Boolean)
      return lines.map((line) => RunEventEnvelopeSchema.parse(JSON.parse(line)))
    } catch (error) {
      if ((error as { code?: string })?.code === 'ENOENT') return []
      throw new Error(`invalid run event log: ${String(error)}`)
    }
  }
}
