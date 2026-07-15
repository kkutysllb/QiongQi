import { describe, expect, it } from 'vitest'
import {
  MiddlewareChain,
  budgetMiddleware,
  identityScopeMiddleware,
  loopDetectionMiddleware,
  safetyTerminationMiddleware,
  terminalResponseMiddleware,
  type MiddlewareContext,
  type RuntimeMiddleware
} from '@qiongqi/loop'
import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'

const identity: RunIdentity = { ownerUserId: 'u1', workspaceKey: 'w1', threadId: 't1', turnId: 'tu1', runId: 'r1' }
function state(overrides: Partial<RunStateV3> = {}): RunStateV3 {
  return {
    version: 3, graphVersion: 'g1', runtimeMode: 'kernel_v3', ...identity, status: 'running',
    cursor: { stepIndex: 0, nodeId: 'node', attempt: 0, checkpointSeq: 0 },
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, pendingEffects: [], committedEffects: [],
    createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', ...overrides
  }
}
function context(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return { identity, state: state(), hook: 'beforeNode', commands: [], ...overrides }
}
async function run(middleware: RuntimeMiddleware, ctx: MiddlewareContext) {
  return new MiddlewareChain([middleware]).run(ctx.hook, ctx)
}

describe('governance middleware', () => {
  it('fails closed on identity scope mismatch', async () => {
    const result = await run(identityScopeMiddleware({ ...identity, workspaceKey: 'other' }), context())
    expect(result?.commands?.[0]).toMatchObject({ type: 'terminate', outcome: { reason: 'runtime_error' } })
  })

  it('returns structured budget outcomes before another node runs', async () => {
    const result = await new MiddlewareChain([budgetMiddleware({ maxSteps: 2 })]).run('beforeNode', context({ state: state({ budgets: { stepsUsed: 2, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } }) }))
    expect(result?.commands?.[0]).toMatchObject({ type: 'terminate', outcome: { reason: 'step_capped' } })
  })

  it('turns safety/refusal classes into provider safety outcomes', async () => {
    const result = await new MiddlewareChain([safetyTerminationMiddleware()]).run('afterNode', context({ hook: 'afterNode', facts: { stopClass: 'safety', providerReason: 'content_filter' } }))
    expect(result?.commands?.[0]).toMatchObject({ type: 'terminate', outcome: { reason: 'provider_safety_stop' } })
  })

  it('retries one empty post-tool terminal response then degrades', async () => {
    const middleware = terminalResponseMiddleware()
    const first = await run(middleware, context({ hook: 'afterNode', facts: { stopClass: 'normal', proposalText: '', hadToolResult: true } }))
    expect(first?.commands?.find((command) => command.type === 'retry')).toBeTruthy()
    const second = await run(middleware, context({ hook: 'afterNode', facts: { stopClass: 'normal', proposalText: '', hadToolResult: true }, state: state({ middleware: { 'terminal-response': { version: 1, data: 1 } } }) }))
    expect(second?.commands?.[0]).toMatchObject({ type: 'terminate', outcome: { reason: 'tool_completed_no_final_text' } })
  })

  it('caps repeated tool calls in a run-scoped window', async () => {
    const middleware = loopDetectionMiddleware({ threshold: 2 })
    const call = { callId: 'c', toolName: 'read', arguments: { path: 'a' } }
    await run(middleware, context({ facts: { toolCall: call } }))
    const result = await run(middleware, context({ facts: { toolCall: call } }))
    expect(result?.commands?.[0]).toMatchObject({ type: 'terminate', outcome: { reason: 'loop_capped' } })
  })
})
