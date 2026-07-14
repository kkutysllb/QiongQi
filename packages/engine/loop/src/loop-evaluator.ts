/**
 * LoopEvaluator: deterministic rule-based quality check for a loop step.
 * No LLM call. Decides whether to accept the policy decision, retry the
 * step, or force a failure.
 */

import type { LoopDecision } from './loop-policy.js'
import type { StepResult } from './model-step-runner.js'
import type { BuildContext } from './prompt-builder.js'

export interface LoopEvaluationInput {
  decision: LoopDecision
  stepResult: Extract<StepResult, { kind: 'ran' }>
  ctx: BuildContext
  retryCount: number
}

export type LoopEvaluation =
  | { verdict: 'pass' }
  | { verdict: 'retry'; reason: string }
  | { verdict: 'fail'; reason: string }

/** Evaluator function signature (pluggable). */
export type LoopEvaluator = (input: LoopEvaluationInput) => LoopEvaluation

/** Max retries the default evaluator tolerates before giving up. */
export const DEFAULT_EVALUATOR_MAX_RETRIES = 1

export function defaultLoopEvaluator(input: LoopEvaluationInput): LoopEvaluation {
  const { decision, stepResult, retryCount } = input

  // Hard failure decisions are honoured immediately.
  if (decision.action === 'failed' || decision.action === 'failed_with_error') {
    return { verdict: 'fail', reason: decision.action === 'failed_with_error' ? decision.errorMessage : 'step failed' }
  }

  // Truncation without a tool call: the model likely ran out of output
  // budget. Retry once to let it continue, then give up.
  if (
    stepResult.stopReason === 'length' &&
    stepResult.completedToolCalls.length === 0 &&
    retryCount < DEFAULT_EVALUATOR_MAX_RETRIES
  ) {
    return { verdict: 'retry', reason: 'model output truncated (length stop reason); retrying' }
  }

  // Provider/gateway compatibility guard: some OpenAI-compatible endpoints
  // occasionally finish a turn with `stop` but no visible text, no reasoning,
  // and no tool calls. Treat the first occurrence as a recoverable stalled
  // model step instead of accepting an empty terminal answer.
  if (
    decision.action === 'stop' &&
    stepResult.stopReason === 'stop' &&
    stepResult.completedToolCalls.length === 0 &&
    !stepResult.text.trim() &&
    !stepResult.reasoning.trim() &&
    !hasPriorToolResult(input.ctx) &&
    retryCount < DEFAULT_EVALUATOR_MAX_RETRIES
  ) {
    return { verdict: 'retry', reason: 'model returned an empty stop response; retrying once' }
  }

  return { verdict: 'pass' }
}

function hasPriorToolResult(ctx: BuildContext): boolean {
  return (ctx.healedItems ?? []).some((item) => item.kind === 'tool_result')
}
