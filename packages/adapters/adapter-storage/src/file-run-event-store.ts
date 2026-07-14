import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RunEventEnvelopeSchema, type RunEventEnvelope, type RunIdentity } from '@qiongqi/contracts'
import type { RunEventStore } from '@qiongqi/ports'
import { runtimeScopeDigest } from './runtime-store-utils.js'

export class FileRunEventStore implements RunEventStore {
  public readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir)
  }

  async append(input: RunEventEnvelope): Promise<RunEventEnvelope> {
    const event = RunEventEnvelopeSchema.parse(input)
    const existing = await this.readEvents(event)
    const duplicate = existing.find((candidate) => candidate.eventId === event.eventId)
    if (duplicate) return duplicate
    if (existing.some((candidate) => candidate.seq === event.seq)) {
      throw new Error(`duplicate run event sequence ${event.seq}`)
    }
    await mkdir(this.rootDir, { recursive: true })
    await appendFile(this.eventPath(event), `${JSON.stringify(event)}\n`, 'utf8')
    return event
  }

  async listAfter(identity: RunIdentity, seq: number): Promise<RunEventEnvelope[]> {
    return (await this.readEvents(identity)).filter((event) => event.seq > seq)
  }

  private eventPath(identity: RunIdentity | RunEventEnvelope): string {
    return join(this.rootDir, `${runtimeScopeDigest(identity)}.jsonl`)
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
