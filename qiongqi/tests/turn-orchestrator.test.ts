import { describe, expect, it } from 'vitest'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { makeAssistantTextItem } from '../src/domain/item.js'
import type { ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import {
  bootstrapThread,
  makeHarness,
  makeSilentModel
} from './loop-test-harness.js'

describe('TurnOrchestrator', () => {
  it('finishes a silent model run as completed', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    expect(h.inflight.size()).toBe(0)
  })

  it('injects the current shell runtime when bash is available', async () => {
    let observedRequest: ModelRequest | null = null
    const h = makeHarness({
      provider: 'shell-context',
      model: 'shell-context',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        observedRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)

    const request = observedRequest as ModelRequest | null
    if (!request) throw new Error('expected model request')
    expect(request.tools.map((tool) => tool.name)).toContain('bash')
    expect(request.contextInstructions?.join('\n')).toContain('Shell runtime:')
    expect(request.contextInstructions?.join('\n')).toContain('shell commands appropriate for the host platform')
  })

  it('records elapsed seconds for active goals after a turn finishes', async () => {
    let nowMs = 1_000
    const h = makeHarness(
      {
        provider: 'goal-timer',
        model: 'goal-timer',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          nowMs = 4_700
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { nowMs: () => nowMs }
    )
    await bootstrapThread(h)
    await h.threads.setGoal(h.threadId, { objective: 'ship the feature' })

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const goal = await h.threads.getGoal(h.threadId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

    expect(status).toBe('completed')
    expect(goal?.timeUsedSeconds).toBe(3)
    expect(events.some((event) =>
      event.kind === 'goal_updated' && event.goal?.timeUsedSeconds === 3
    )).toBe(true)
  })

  it('includes the failure reason on turn_failed events', async () => {
    const h = makeHarness({
      provider: 'throwing',
      model: 'throwing',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        const chunks: ModelStreamChunk[] = []
        for (const chunk of chunks) yield chunk
        throw new Error('model stream exploded')
      }
    })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const failed = events.find((event) => event.kind === 'turn_failed')

    expect(status).toBe('failed')
    expect(failed).toMatchObject({
      kind: 'turn_failed',
      message: 'model stream exploded'
    })
  })

  it('fails the turn when the model stream yields an error chunk', async () => {
    const h = makeHarness({
      provider: 'error-chunk',
      model: 'error-chunk',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'error', message: 'model request failed with status 400', code: 'http_400' }
      }
    })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

    expect(status).toBe('failed')
    expect(events.some((event) =>
      event.kind === 'error' &&
      event.message === 'model request failed with status 400' &&
      event.code === 'http_400'
    )).toBe(true)
    expect(events.some((event) => event.kind === 'turn_failed')).toBe(true)
  })

  it('emits named pipeline lifecycle stages for a model request', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const stages = events
      .filter((event) => event.kind === 'pipeline_stage')
      .map((event) => event.kind === 'pipeline_stage' ? event.stage : '')

    expect(stages).toEqual([
      'setup',
      'pre_start',
      'post_start',
      'input_received',
      'input_cached',
      'input_routed',
      'input_compressed',
      'input_remembered',
      'pre_send',
      'post_send',
      'response_received'
    ])
  })

  it('aborts the turn when the abort signal fires', async () => {
    const h = makeHarness({
      provider: 'blocker',
      model: 'blocker',
      async *stream({ abortSignal }): AsyncIterable<ModelStreamChunk> {
        await new Promise<void>((resolve) => {
          if (abortSignal.aborted) return resolve()
          abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
        yield { kind: 'error', message: 'aborted' }
      }
    })
    await bootstrapThread(h)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    h.turns['inflightTurns'].set(h.turnId, controller)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status === 'aborted' || status === 'failed').toBe(true)
    expect(h.inflight.size()).toBe(0)
  })

  it('can discard generated items when interrupting a foreground turn', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    await h.turns.applyItem(
      h.threadId,
      makeAssistantTextItem({
        id: 'partial_answer',
        turnId: h.turnId,
        threadId: h.threadId,
        text: 'partial',
        status: 'running'
      })
    )

    await h.turns.interruptTurn({ threadId: h.threadId, turnId: h.turnId, discard: true })
    const sessionItems = await h.sessionStore.loadItems(h.threadId)
    const thread = await h.threadStore.get(h.threadId)
    const turnItems = thread?.turns.find((turn) => turn.id === h.turnId)?.items ?? []

    expect(sessionItems.filter((item) => item.turnId === h.turnId).map((item) => item.kind))
      .toEqual(['user_message'])
    expect(turnItems.map((item) => item.kind)).toEqual(['user_message'])
  })

  it('surfaces tool catalog drift to the UI and next model request', async () => {
    const seenInstructions: string[][] = []
    let modelCalls = 0
    let advertiseExtra = false
    const echoTool = LocalToolHost.defineTool({
      name: 'echo',
      description: 'Echo text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      policy: 'auto',
      execute: async () => {
        advertiseExtra = true
        return { output: { ok: true } }
      }
    })
    const extraTool = LocalToolHost.defineTool({
      name: 'extra_tool',
      description: 'Appears after the first tool call',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      shouldAdvertise: () => advertiseExtra,
      execute: async () => ({ output: { ok: true } })
    })
    const h = makeHarness(
      {
        provider: 'catalog-drift',
        model: 'catalog-drift',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          seenInstructions.push(request.contextInstructions ?? [])
          modelCalls += 1
          if (modelCalls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_echo',
              toolName: 'echo',
              arguments: { text: 'hi' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [echoTool, extraTool] }
    )
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(events.some((event) => event.kind === 'tool_catalog_changed')).toBe(true)
    expect(events.find((event) => event.kind === 'tool_catalog_changed')).toMatchObject({
      kind: 'tool_catalog_changed',
      changeKind: 'additive'
    })
    expect(items.some((item) => item.kind === 'error' && item.code === 'tool_catalog_changed')).toBe(true)
    expect(seenInstructions[1]?.some((text) => text.includes('Tool catalog changed'))).toBe(true)
  })

  it('stops the turn when an existing tool schema mutates in-place', async () => {
    let modelCalls = 0
    const inputSchema: Record<string, unknown> = {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
    const echoTool = LocalToolHost.defineTool({
      name: 'echo',
      description: 'Echo text.',
      inputSchema,
      policy: 'auto',
      execute: async () => {
        inputSchema.properties = {
          text: { type: 'string' },
          unexpected: { type: 'boolean' }
        }
        return { output: { ok: true } }
      }
    })
    const h = makeHarness(
      {
        provider: 'catalog-breaking-drift',
        model: 'catalog-breaking-drift',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          modelCalls += 1
          yield {
            kind: 'tool_call_complete',
            callId: 'call_echo',
            toolName: 'echo',
            arguments: { text: 'hi' }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
        }
      },
      { tools: [echoTool] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('completed')
    expect(modelCalls).toBe(1)
    expect(events.find((event) => event.kind === 'tool_catalog_changed')).toMatchObject({
      kind: 'tool_catalog_changed',
      changeKind: 'breaking'
    })
    expect(items.find((item) => item.kind === 'error' && item.code === 'tool_catalog_changed'))
      .toMatchObject({
        kind: 'error',
        message: expect.stringContaining('Qiongqi stopped this turn')
      })
  })

  it('steers the turn and injects user messages', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    h.steering.enqueue(h.turnId, 'follow up')
    await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const user = items.find((item) => item.kind === 'user_message' && item.text === 'follow up')
    expect(user).toBeDefined()
  })

  it('cleans up inflight ids after success and error', async () => {
    const h = makeHarness({
      provider: 'flaky',
      model: 'flaky',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'error', message: 'boom' }
        yield { kind: 'completed', stopReason: 'error' }
      }
    })
    await bootstrapThread(h)
    await h.loop.runTurn(h.threadId, h.turnId)
    expect(h.inflight.size()).toBe(0)
  })

  it('warns once near the thread cost budget and blocks when exhausted', async () => {
    let modelCalls = 0
    const h = makeHarness({
      provider: 'budget',
      model: 'budget',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        modelCalls += 1
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)
    const thread = await h.threadStore.get(h.threadId)
    await h.threadStore.upsert({ ...thread!, costBudgetUsd: 10 })
    h.usage.record(h.threadId, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitRate: null,
      turns: 0,
      costUsd: 8
    })

    await h.loop.runTurn(h.threadId, h.turnId)
    const warnedThread = await h.threadStore.get(h.threadId)
    expect(modelCalls).toBe(1)
    expect(warnedThread?.costBudgetWarningSent).toBe(true)
    expect((await h.sessionStore.loadItems(h.threadId)).some((item) =>
      item.kind === 'error' && item.code === 'budget_warning'
    )).toBe(true)

    const second = await h.turns.startTurn({ threadId: h.threadId, request: { prompt: 'again' } })
    h.turnId = second.turnId
    h.usage.record(h.threadId, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitRate: null,
      turns: 0,
      costUsd: 2
    })
    await h.loop.runTurn(h.threadId, h.turnId)
    expect(modelCalls).toBe(1)
    expect((await h.sessionStore.loadItems(h.threadId)).some((item) =>
      item.kind === 'error' && item.code === 'budget_limited'
    )).toBe(true)
  })
})
