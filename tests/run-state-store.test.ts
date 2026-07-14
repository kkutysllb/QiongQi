import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileRunStateStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'

const identity: RunIdentity = {
  ownerUserId: 'u1', threadId: 't1', turnId: 'tu1', runId: 'r1', workspaceKey: 'w1'
}

function state(): RunStateV3 {
  return {
    version: 3,
    graphVersion: 'kernel-v3-default',
    runtimeMode: 'kernel_v3',
    ...identity,
    status: 'running',
    cursor: { stepIndex: 2, nodeId: 'invoke-model', attempt: 1, checkpointSeq: 4 },
    budgets: { stepsUsed: 2, toolCallsUsed: 1, inputTokens: 10, outputTokens: 4, costUsd: 0.01 },
    recovery: { attempts: 0, maxAttempts: 1 },
    middleware: {},
    pendingEffects: [],
    committedEffects: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:01.000Z'
  }
}

describe.each([
  ['memory', () => new InMemoryRunStateStore()],
  ['file', async () => new FileRunStateStore(await mkdtemp(join(tmpdir(), 'qiongqi-run-state-')))]
])('run state store (%s)', (_name, create) => {
  it('round-trips snapshots and enforces lease ownership', async () => {
    const store = await create()
    await store.save(state())
    await expect(store.load(identity)).resolves.toMatchObject({ cursor: { stepIndex: 2 } })

    await expect(store.acquire(identity.runId, 'holder-a', 60_000)).resolves.toMatchObject({ acquired: true })
    await expect(store.acquire(identity.runId, 'holder-b', 60_000)).resolves.toMatchObject({ acquired: false })
    await expect(store.renew(identity.runId, 'holder-b', 60_000)).resolves.toBe(false)
    await store.release(identity.runId, 'holder-a')
    await expect(store.acquire(identity.runId, 'holder-b', 60_000)).resolves.toMatchObject({ acquired: true })

    if (store instanceof FileRunStateStore) await rm(store.rootDir, { recursive: true, force: true })
  })
})

describe('FileRunStateStore recovery behavior', () => {
  it('ignores a malformed snapshot instead of throwing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'qiongqi-run-state-invalid-'))
    const store = new FileRunStateStore(rootDir)
    await store.writeRawSnapshot(identity, '{broken')
    await expect(store.load(identity)).resolves.toBeUndefined()
    await rm(rootDir, { recursive: true, force: true })
  })
})
