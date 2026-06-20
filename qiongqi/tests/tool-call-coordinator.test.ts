import { describe, expect, it } from 'vitest'
import { LocalToolHost, buildDefaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import { CREATE_PLAN_TOOL_NAME } from '../src/adapters/tool/create-plan-tool.js'
import { createThreadRecord } from '../src/domain/thread.js'
import type { ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import {
  bootstrapThread,
  makeFakeModel,
  makeHarness,
  resolveNextUserInput
} from './loop-test-harness.js'

describe('ToolCallCoordinator', () => {
  it('runs a tool call and surfaces its result item', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'fake',
      model: 'fake',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
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
    })
    await bootstrapThread(h)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    const items = await h.sessionStore.loadItems(h.threadId)
    const result = items.find((item) => item.kind === 'tool_result')
    expect(result).toBeDefined()
    if (result?.kind === 'tool_result') {
      expect(result.toolName).toBe('echo')
    }
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.some((event) => event.kind === 'tool_call_ready' && event.readyCount === 1)).toBe(true)
    expect(events.some((event) =>
      event.kind === 'tool_result_upload_wait' && event.toolResultCount === 1
    )).toBe(true)
    const thread = await h.threadStore.get(h.threadId)
    const toolCall = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'tool_call' && item.callId === 'call_echo')
    expect(toolCall).toMatchObject({ kind: 'tool_call', status: 'completed' })
  })

  it('replaces live partial tool results with final tool results in the thread snapshot', async () => {
    const partialTool = LocalToolHost.defineTool({
      name: 'partial_bash',
      description: 'Emit a partial update then a final result',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (_args, _context, onUpdate) => {
        await onUpdate?.({ output: { partial: true }, isError: false })
        return { output: { exit_code: 127 }, isError: true }
      }
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'fake',
        model: 'fake',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_partial',
              toolName: 'partial_bash',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [partialTool] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const thread = await h.threadStore.get(h.threadId)
    const result = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'tool_result' && item.callId === 'call_partial')

    expect(status).toBe('completed')
    expect(result).toMatchObject({
      kind: 'tool_result',
      status: 'completed',
      isError: true,
      output: { exit_code: 127 }
    })
  })

  it('runs consecutive built-in read-only tool calls in a deterministic parallel batch', async () => {
    const started: string[] = []
    let resolveBothStarted!: () => void
    let releaseTools!: () => void
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseTools = resolve
    })
    const makeReadOnlyTool = (name: 'read' | 'grep') =>
      LocalToolHost.defineTool({
        name,
        description: `${name} test tool`,
        inputSchema: {
          type: 'object',
          properties: {}
        },
        policy: 'auto',
        execute: async () => {
          started.push(name)
          if (started.length === 2) resolveBothStarted()
          await release
          return { output: { name } }
        }
      })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'parallel-model',
        model: 'parallel-model',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_read',
              toolName: 'read',
              arguments: {}
            }
            yield {
              kind: 'tool_call_complete',
              callId: 'call_grep',
              toolName: 'grep',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [makeReadOnlyTool('read'), makeReadOnlyTool('grep')] }
    )
    await bootstrapThread(h)

    const run = h.loop.runTurn(h.threadId, h.turnId)
    let startupError: Error | undefined
    try {
      await Promise.race([
        bothStarted,
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error(`only started ${started.join(',') || 'none'}`)), 100)
        })
      ])
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error))
    } finally {
      releaseTools()
    }
    const status = await run
    if (startupError) throw startupError

    const resultCallIds = (await h.sessionStore.loadItems(h.threadId))
      .filter((item) => item.kind === 'tool_result')
      .map((item) => item.kind === 'tool_result' ? item.callId : '')

    expect(status).toBe('completed')
    expect(started).toEqual(['read', 'grep'])
    expect(resultCallIds).toEqual(['call_read', 'call_grep'])
  })

  it('repairs wrapped tool arguments before persisting and dispatching calls', async () => {
    let observedArguments: Record<string, unknown> | null = null
    let calls = 0
    const h = makeHarness(
      {
        provider: 'wrapped-tool-args',
        model: 'wrapped-tool-args',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls > 1) {
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          yield {
            kind: 'tool_call_complete',
            callId: 'call_wrapped',
            toolName: 'capture_args',
            arguments: {
              tool_name: 'capture_args',
              arguments: '{"path":"src/main.ts"}'
            }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
        }
      },
      {
        tools: [
          LocalToolHost.defineTool({
            name: 'capture_args',
            description: 'Capture repaired args.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: true },
            policy: 'auto',
            execute: async (args) => {
              observedArguments = { ...args }
              return { output: { ok: true } }
            }
          })
        ]
      }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(observedArguments).toEqual({ path: 'src/main.ts' })
    const items = await h.sessionStore.loadItems(h.threadId)
    const toolCall = items.find((item) => item.kind === 'tool_call' && item.callId === 'call_wrapped')
    expect(toolCall).toMatchObject({
      arguments: { path: 'src/main.ts' },
      summary: expect.stringContaining('flattened arguments wrapper')
    })
  })

  it('suppresses repeated identical tool calls within a turn', async () => {
    let executions = 0
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
        executions += 1
        return { output: { ok: executions } }
      }
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'storm-model',
        model: 'storm-model',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls <= 3) {
            yield {
              kind: 'tool_call_complete',
              callId: `call_echo_${calls}`,
              toolName: 'echo',
              arguments: { text: 'repeat me' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [echoTool] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const stormResult = items.find(
      (item) => item.kind === 'tool_result' && item.callId === 'call_echo_3'
    )
    const thirdCall = items.find(
      (item) => item.kind === 'tool_call' && item.callId === 'call_echo_3'
    )

    expect(status).toBe('completed')
    expect(executions).toBe(2)
    expect(thirdCall).toMatchObject({ kind: 'tool_call', status: 'failed' })
    expect(stormResult?.kind === 'tool_result' ? stormResult.isError : false).toBe(true)
    expect(stormResult?.kind === 'tool_result' ? JSON.stringify(stormResult.output) : '')
      .toContain('repeat-loop guard suppressed')
    expect(events.find((event) => event.kind === 'tool_storm_suppressed')).toMatchObject({
      kind: 'tool_storm_suppressed',
      callId: 'call_echo_3',
      toolName: 'echo'
    })
  })

  it('can disable the storm breaker through loop config', async () => {
    let executions = 0
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
        executions += 1
        return { output: { ok: executions } }
      }
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'storm-disabled-model',
        model: 'storm-disabled-model',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls <= 3) {
            yield {
              kind: 'tool_call_complete',
              callId: `call_echo_${calls}`,
              toolName: 'echo',
              arguments: { text: 'repeat me' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [echoTool], toolStorm: { enabled: false } }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

    expect(status).toBe('completed')
    expect(executions).toBe(3)
    expect(events.some((event) => event.kind === 'tool_storm_suppressed')).toBe(false)
  })

  it('propagates partial tool updates through item_updated before final completion', async () => {
    const streamingTool = LocalToolHost.defineTool({
      name: 'streamer',
      description: 'stream',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      execute: async (_args, _context, onUpdate) => {
        await onUpdate?.({ output: { partial: 'hello' } })
        return { output: { done: true } }
      }
    })
    const h = makeHarness(makeFakeModel([
      {
        kind: 'tool_call_complete',
        callId: 'call_streamer',
        toolName: 'streamer',
        arguments: {}
      },
      { kind: 'completed', stopReason: 'tool_calls' },
      { kind: 'completed', stopReason: 'stop' }
    ]), { tools: [streamingTool] })
    await bootstrapThread(h)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.some((event) => event.kind === 'item_updated')).toBe(true)
    const partialUpdate = events.find(
      (event) =>
        event.kind === 'item_updated' &&
        event.item.kind === 'tool_result' &&
        (event.item.output as { partial?: string }).partial === 'hello'
    )
    expect(partialUpdate).toBeDefined()
  })

  it('waits for GUI user input tool responses and resumes the turn', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'input-model',
      model: 'input-model',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_input',
            toolName: 'request_user_input',
            arguments: {
              prompt: 'Pick one',
              questions: [
                {
                  header: 'Decision',
                  id: 'choice',
                  question: 'Pick one',
                  options: [
                    { label: 'Yes', description: 'Continue' },
                    { label: 'No', description: 'Stop' }
                  ]
                }
              ]
            }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)
    const resolver = resolveNextUserInput(h, [
      { id: 'choice', label: 'Yes', value: 'yes' }
    ])

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    await resolver

    expect(status).toBe('completed')
    const thread = await h.threadStore.get(h.threadId)
    const inputItem = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'user_input')
    expect(inputItem).toMatchObject({
      kind: 'user_input',
      status: 'submitted',
      questions: [
        {
          header: 'Decision',
          id: 'choice',
          question: 'Pick one',
          options: [
            { label: 'Yes', description: 'Continue' },
            { label: 'No', description: 'Stop' }
          ]
        }
      ]
    })
    const result = (await h.sessionStore.loadItems(h.threadId)).find((item) => item.kind === 'tool_result')
    expect(result).toMatchObject({
      kind: 'tool_result',
      toolName: 'request_user_input',
      isError: false
    })
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.some((event) => event.kind === 'user_input_requested')).toBe(true)
    expect(events.some((event) => event.kind === 'user_input_resolved')).toBe(true)
  })

  it('uses the thread approval policy when executing auto tools', async () => {
    const approvalDecisions: string[] = []
    const tool = LocalToolHost.defineTool({
      name: 'dangerous_auto',
      description: 'Auto tool that should still prompt in untrusted mode.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      policy: 'auto',
      execute: async (args) => ({ output: { echoed: args.text ?? '' } })
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'approval-check',
        model: 'approval-check',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_danger',
              toolName: 'dangerous_auto',
              arguments: { text: 'hi' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [tool] }
    )
    await h.threadStore.upsert(
      createThreadRecord({
        id: h.threadId,
        title: 'demo',
        workspace: '/tmp',
        model: 'fake',
        approvalPolicy: 'untrusted'
      })
    )
    const response = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'hello' }
    })
    h.turnId = response.turnId
    h.approvalGate.request = async (approval) => {
      approvalDecisions.push(approval.toolName)
      return 'allow'
    }

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(approvalDecisions).toEqual(['dangerous_auto'])
  })

  it('persists toolKind from the advertised tool metadata', async () => {
    const tool = LocalToolHost.defineTool({
      name: 'write_file',
      description: 'Write a file.',
      toolKind: 'file_change',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      policy: 'auto',
      execute: async () => ({ output: { path: '/tmp/demo.ts' } })
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'file-tool',
        model: 'file-tool',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_file',
              toolName: 'write_file',
              arguments: { path: '/tmp/demo.ts' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [tool] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const toolCall = items.find((item) => item.kind === 'tool_call')
    const toolResult = items.find((item) => item.kind === 'tool_result')

    expect(status).toBe('completed')
    expect(toolCall).toMatchObject({ kind: 'tool_call', toolKind: 'file_change' })
    expect(toolResult).toMatchObject({ kind: 'tool_result', toolKind: 'file_change' })
  })

  it('continues after a normal agent turn attempts a non-advertised create_plan call', async () => {
    const observedRequests: ModelRequest[] = []
    let calls = 0
    const h = makeHarness(
      {
        provider: 'overeager-planner',
        model: 'overeager-planner',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          observedRequests.push(request)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_plan',
              toolName: CREATE_PLAN_TOOL_NAME,
              arguments: {
                markdown: '# Plan',
                operation: 'draft'
              }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'I will continue without the plan tool.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: buildDefaultLocalTools() }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const planCall = items.find(
      (item) => item.kind === 'tool_call' && item.toolName === CREATE_PLAN_TOOL_NAME
    )
    const planResult = items.find(
      (item) => item.kind === 'tool_result' && item.toolName === CREATE_PLAN_TOOL_NAME
    )

    expect(status).toBe('completed')
    expect(observedRequests[0]?.tools.map((tool) => tool.name)).not.toContain(CREATE_PLAN_TOOL_NAME)
    expect(observedRequests.length).toBe(2)
    expect(planCall).toMatchObject({ kind: 'tool_call', status: 'failed' })
    expect(planResult).toMatchObject({ kind: 'tool_result', isError: true })
    expect(planResult?.kind === 'tool_result' ? JSON.stringify(planResult.output) : '')
      .toContain('not advertised in this turn context')
    expect(events.some((event) =>
      event.kind === 'error' && event.code === 'tool_dispatch_rejected'
    )).toBe(true)
  })
})
