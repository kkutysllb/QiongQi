import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileRunEventStore, InMemoryRunEventStore } from '@qiongqi/adapter-storage'
import type { RunEventEnvelope, RunIdentity } from '@qiongqi/contracts'

const identity: RunIdentity = {
  ownerUserId: 'u1', threadId: 't1', turnId: 'tu1', runId: 'r1', workspaceKey: 'w1'
}

function event(seq: number, eventId = `event-${seq}`): RunEventEnvelope {
  return {
    eventId, seq, ...identity, eventType: 'node.started', payload: { seq }, timestamp: `2026-07-15T00:00:0${seq}.000Z`
  }
}

describe.each([
  ['memory', () => new InMemoryRunEventStore()],
  ['file', async () => new FileRunEventStore(await mkdtemp(join(tmpdir(), 'qiongqi-run-events-')))]
])('run event store (%s)', (_name, create) => {
  it('replays after a sequence and deduplicates an event id', async () => {
    const store = await create()
    await store.append(event(1))
    await store.append(event(2))
    await store.append(event(2))
    await expect(store.listAfter(identity, 1)).resolves.toHaveLength(1)
    await expect(store.listAfter(identity, 1)).resolves.toMatchObject([{ eventId: 'event-2' }])
    if (store instanceof FileRunEventStore) await rm(store.rootDir, { recursive: true, force: true })
  })

  it('does not mix owners or runs that reuse thread ids', async () => {
    const store = await create()
    await store.append(event(1))
    await store.append({ ...event(2, 'other-run'), runId: 'r2' })
    await expect(store.listAfter(identity, 0)).resolves.toHaveLength(1)
    if (store instanceof FileRunEventStore) await rm(store.rootDir, { recursive: true, force: true })
  })
})
