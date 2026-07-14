import { describe, expect, it } from 'vitest'
import { defaultLoopEvaluator } from '@qiongqi/loop'
import type { LoopDecision, StepResult, BuildContext } from '@qiongqi/loop'

function mkRan(over: Partial<Extract<StepResult, { kind: 'ran' }>> = {}): Extract<StepResult, { kind: 'ran' }> {
  return {
    kind: 'ran', text: '', textItemId: 't', reasoning: '', reasoningItemId: 'r',
    completedToolCalls: [], stopReason: 'stop', ...over
  }
}
const ctx = {} as unknown as BuildContext

describe('defaultLoopEvaluator', () => {
  it('passes a normal stop decision', () => {
    const result = defaultLoopEvaluator({
      decision: { action: 'stop' } as LoopDecision,
      stepResult: mkRan({ stopReason: 'stop', text: 'done' }),
      ctx, retryCount: 0
    })
    expect(result.verdict).toBe('pass')
  })

  it('passes a dispatch decision', () => {
    const result = defaultLoopEvaluator({
      decision: { action: 'dispatch' } as LoopDecision,
      stepResult: mkRan({ stopReason: 'tool_calls' }),
      ctx, retryCount: 0
    })
    expect(result.verdict).toBe('pass')
  })

  it('fails when the decision is failed_with_error', () => {
    const result = defaultLoopEvaluator({
      decision: { action: 'failed_with_error', errorMessage: 'x', errorCode: 'y' },
      stepResult: mkRan({ stopReason: 'stop' }),
      ctx, retryCount: 0
    })
    expect(result.verdict).toBe('fail')
  })

  it('retries a length-truncated stop with no tool calls (first attempt)', () => {
    const result = defaultLoopEvaluator({
      decision: { action: 'stop' } as LoopDecision,
      stepResult: mkRan({ stopReason: 'length' }),
      ctx, retryCount: 0
    })
    expect(result.verdict).toBe('retry')
  })

  it('retries an empty stop with no tool calls once', () => {
    const result = defaultLoopEvaluator({
      decision: { action: 'stop' } as LoopDecision,
      stepResult: mkRan({ stopReason: 'stop', text: '', reasoning: '' }),
      ctx, retryCount: 0
    })
    expect(result.verdict).toBe('retry')
  })

  it('accepts an empty stop after prior tool results', () => {
    const result = defaultLoopEvaluator({
      decision: { action: 'stop' } as LoopDecision,
      stepResult: mkRan({ stopReason: 'stop', text: '', reasoning: '' }),
      ctx: {
        healedItems: [{ kind: 'tool_result', callId: 'c1' }]
      } as unknown as BuildContext,
      retryCount: 0
    })
    expect(result.verdict).toBe('pass')
  })

  it('stops retrying once retryCount reaches 1', () => {
    const result = defaultLoopEvaluator({
      decision: { action: 'stop' } as LoopDecision,
      stepResult: mkRan({ stopReason: 'length' }),
      ctx, retryCount: 1
    })
    expect(result.verdict).toBe('pass')
  })
})
