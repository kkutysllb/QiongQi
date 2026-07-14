import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '@qiongqi/adapter-tools'
import { LocalToolHost } from '@qiongqi/adapter-tools'
import { buildMemoryToolProviders } from '@qiongqi/adapter-tools'
import { QiongqiCapabilitiesConfig, type MemoryCapabilityConfig } from '@qiongqi/contracts'
import { FileMemoryStore } from '@qiongqi/memory'
import type { ModelClient, ModelRequest } from '@qiongqi/ports'
import { dispatchRequest } from '@qiongqi/http'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'
import { buildHarness, readJson } from './http-server-test-harness.js'

describe('Memory store and recall', () => {
  let dir = ''
  let nextId = 1

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-memory-'))
    nextId = 1
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stores scoped memories, retrieves relevant records, and keeps tombstones', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'User prefers pnpm for frontend projects',
      scope: 'workspace',
      workspace: '/tmp/ws',
      tags: ['frontend'],
      confidence: 0.9
    })
    await store.create({
      content: 'Unrelated backend preference',
      scope: 'workspace',
      workspace: '/tmp/other'
    })

    expect((await store.retrieve({ query: 'frontend pnpm preference', workspace: '/tmp/ws', limit: 3 })).map((item) => item.id)).toEqual([memory.id])
    expect(await createStore({ enabled: false }).retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])

    await store.update(memory.id, { disabled: true })
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])
    await store.update(memory.id, { disabled: false, content: 'User strongly prefers pnpm' })
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toHaveLength(1)
    await store.delete(memory.id)
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/ws', limit: 3 })).toEqual([])
    expect((await store.list({ workspace: '/tmp/ws', includeDeleted: true })).find((item) => item.id === memory.id)?.deletedAt).toBeTruthy()
  })

  it('retrieves user and workspace memories across threads while keeping project memories thread-scoped', async () => {
    const store = createStore()
    const userMemory = await store.create({
      content: 'User prefers pnpm for frontend analysis dashboards',
      scope: 'user',
      workspace: '/tmp/ws',
      sourceThreadId: 'old_thread'
    })
    const workspaceMemory = await store.create({
      content: 'Workspace financial reports should include MD and HTML outputs',
      scope: 'workspace',
      workspace: '/tmp/ws',
      sourceThreadId: 'old_thread'
    })
    await store.create({
      content: 'Project-specific draft uses yarn',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'old_thread'
    })

    expect((await store.retrieve({
      query: 'frontend financial analysis reports pnpm MD HTML',
      workspace: '/tmp/ws',
      threadId: 'new_thread',
      limit: 5
    })).map((item) => item.id)).toEqual([workspaceMemory.id, userMemory.id])
  })

  it('carries current-thread project memories across continue prompts without leaking other tasks', async () => {
    const store = createStore()
    const currentTask = await store.create({
      content: '真实任务是宁德时代 300750 全面深度分析，需要输出 MD 报告和 HTML 看板',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'catl_thread'
    })
    await store.create({
      content: '旧任务是股指期货联动分析',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'futures_thread'
    })

    expect((await store.retrieve({
      query: '继续',
      workspace: '/tmp/ws',
      threadId: 'catl_thread',
      limit: 5
    })).map((item) => item.id)).toEqual([currentTask.id])
  })

  it('exposes memory API routes with diagnostics', async () => {
    const h = buildHarness()
    h.runtime.memoryStore = createStore()
    const created = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Remember pnpm',
          scope: 'workspace',
          workspace: '/tmp/ws'
        })
      })
    )
    expect(created.status).toBe(201)
    const body = await readJson(created) as { memory: { id: string } }

    const list = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory?workspace=/tmp/ws', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect((await readJson(list)) as { memories: unknown[] }).toMatchObject({ memories: [expect.any(Object)] })

    const disabled = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/memory/${body.memory.id}`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: true })
      })
    )
    expect(disabled.status).toBe(200)
    const deleted = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/memory/${body.memory.id}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(deleted.status).toBe(200)
    const diagnostics = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/memory/diagnostics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(await readJson(diagnostics)).toMatchObject({ tombstoneCount: 1 })
  })

  it('gates memory mutation tools through approval', async () => {
    const store = createStore()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildMemoryToolProviders(store))
    })
    let approvals = 0
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'memory_create',
      arguments: { content: 'Use pnpm', workspace: '/tmp/ws' }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'on-request',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => {
        approvals += 1
        return 'allow'
      }
    })

    expect(approvals).toBe(1)
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    const memories = await store.list({ workspace: '/tmp/ws' })
    expect(memories).toHaveLength(1)
    expect(memories[0]).toMatchObject({
      scope: 'project',
      sourceThreadId: 'thr_1'
    })
  })

  it('injects relevant memories into TurnOrchestrator metadata and stops after deletion', async () => {
    const store = createStore()
    const memory = await store.create({
      content: 'Use pnpm when touching frontend code',
      scope: 'workspace',
      workspace: '/tmp/ws'
    })
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h, { workspace: '/tmp/ws', request: { prompt: 'frontend pnpm setup?' } })

    await h.loop.runTurn(h.threadId, h.turnId)

    expect(seenRequests.at(-1)?.contextInstructions?.[0]).toContain(memory.id)
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryIds).toEqual([memory.id])
    expect((await store.diagnostics()).lastInjectedIds).toEqual([memory.id])

    await store.delete(memory.id)
    const h2 = makeHarness(model, { memoryStore: store })
    await bootstrapThread(h2, { workspace: '/tmp/ws', request: { prompt: 'frontend pnpm setup?' } })
    await h2.loop.runTurn(h2.threadId, h2.turnId)
    const finalInstructions = seenRequests.at(-1)?.contextInstructions?.join('\n') ?? ''
    expect(finalInstructions).not.toContain(memory.id)
    expect(finalInstructions).toContain('Shell runtime:')
  })

  it('injects current task project memory on continue prompts without pulling another task', async () => {
    const store = createStore()
    const seenRequests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { memoryStore: store })
    const current = await store.create({
      content: '真实任务是宁德时代 300750 全面深度分析，需要输出 MD 报告和 HTML 看板',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: h.threadId
    })
    const other = await store.create({
      content: '旧任务是股指期货联动分析',
      scope: 'project',
      workspace: '/tmp/ws',
      sourceThreadId: 'futures_thread'
    })
    await bootstrapThread(h, {
      workspace: '/tmp/ws',
      request: { prompt: '继续' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const instructions = seenRequests.at(-1)?.contextInstructions?.join('\n') ?? ''
    expect(instructions).toContain(current.id)
    expect(instructions).toContain('宁德时代 300750')
    expect(instructions).not.toContain(other.id)
    expect(instructions).not.toContain('股指期货')
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryIds).toEqual([current.id])
  })

  it('writes memory records atomically (no .tmp file left on success)', async () => {
    const store = createStore()
    await store.create({ content: 'atomic test memory' })

    // Final file present and parseable.
    const finalContents = await readFile(
      join(dir, 'memory', 'mem_1.json'),
      'utf8'
    )
    expect(finalContents.length).toBeGreaterThan(0)
    expect(JSON.parse(finalContents).content).toBe('atomic test memory')

    // No .tmp leftover from the atomic write.
    const entries = await readdir(join(dir, 'memory'))
    expect(entries.filter((entry) => entry.includes('.tmp'))).toEqual([])
  })

  function createStore(overrides: Partial<MemoryCapabilityConfig> = {}) {
    return new FileMemoryStore({
      rootDir: join(dir, 'memory'),
      config: memoryConfig(overrides),
      nowIso: () => '2026-06-03T00:00:00.000Z',
      idGenerator: () => `mem_${nextId++}`
    })
  }

  function memoryConfig(overrides: Partial<MemoryCapabilityConfig> = {}) {
    return QiongqiCapabilitiesConfig.parse({
      memory: {
        enabled: true,
        ...overrides
      }
    }).memory
  }
})
