/**
 * ContinuationPolicy is a pure decision function: given the ModelStepRunner
 * result and the build context, it decides whether the turn should stop,
 * continue (with or without dispatching tool calls), fail, or materialise
 * assistant plan text into a synthesised `create_plan` call.
 *
 * It performs NO side effects. The orchestrator is responsible for applying
 * the decision (recording error items, dispatching tool calls, etc.) so the
 * ordering of persistence stays in one place. Extracted verbatim from the
 * legacy monolithic `AgentLoop`.
 */

import type { ToolCallLike } from '@qiongqi/ports'
import type { IdGenerator } from '@qiongqi/ports'
import type { TurnItem } from '@qiongqi/contracts'
import { makeToolCallItem } from '@qiongqi/domain'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'
import { latestUserMessageText } from './loop-helpers.js'
import type { BuildContext } from './prompt-builder.js'
import type { StepResult } from './model-step-runner.js'

export type ContinuationDecision =
  | { action: 'stop' }
  | { action: 'continue' }
  | { action: 'failed' }
  | { action: 'failed_with_error'; errorMessage: string; errorCode: string }
  | { action: 'materialize_plan'; planCall: ToolCallLike; planToolCallItem: TurnItem }
  | { action: 'dispatch' }

export function decideContinuation(input: {
  stepResult: Extract<StepResult, { kind: 'ran' }>
  ctx: BuildContext
  ids: IdGenerator
  threadId: string
  turnId: string
}): ContinuationDecision {
  const { stepResult, ctx, ids, threadId, turnId } = input
  const request = ctx.request

  if (stepResult.stopReason === 'error') {
    return { action: 'failed' }
  }

  if (stepResult.completedToolCalls.length === 0) {
    if (request.requiredToolName) {
      if (
        request.requiredToolName === CREATE_PLAN_TOOL_NAME &&
        stepResult.text.trim()
      ) {
        const callId = ids.next('call_plan')
        const provider = ctx.toolProviderMetadata.get(CREATE_PLAN_TOOL_NAME)
        const toolKind = ctx.toolKinds.get(CREATE_PLAN_TOOL_NAME)
        const sourceRequest = ctx.activePlanContext?.sourceRequest ||
          latestUserMessageText(ctx.healedItems, turnId) ||
          ctx.turn?.prompt ||
          ''
        const argumentsForFallback: Record<string, unknown> = ctx.activePlanContext
          ? {
              markdown: stepResult.text.trim(),
              operation: ctx.activePlanContext.operation,
              plan_id: ctx.activePlanContext.planId,
              plan_relative_path: ctx.activePlanContext.relativePath,
              ...(sourceRequest ? { source_request: sourceRequest } : {}),
              ...(ctx.activePlanContext.title ? { title: ctx.activePlanContext.title } : {})
            }
          : {
              markdown: stepResult.text.trim(),
              operation: 'draft',
              ...(sourceRequest ? { source_request: sourceRequest } : {})
            }
        const planCall: ToolCallLike = {
          callId,
          toolName: CREATE_PLAN_TOOL_NAME,
          ...(provider?.providerId ? { providerId: provider.providerId } : {}),
          toolKind,
          arguments: argumentsForFallback
        }
        const itemId = `item_tool_${turnId}_${callId}`
        const planToolCallItem = makeToolCallItem({
          id: itemId,
          turnId,
          threadId,
          callId,
          toolName: CREATE_PLAN_TOOL_NAME,
          toolKind,
          arguments: argumentsForFallback,
          summary: 'Materialized assistant plan text into the required GUI plan.'
        })
        return { action: 'materialize_plan', planCall, planToolCallItem }
      }
      const message = `Model did not call the required \`${request.requiredToolName}\` tool for this GUI plan turn.`
      return { action: 'failed_with_error', errorMessage: message, errorCode: 'required_tool_missing' }
    }
    if (stepResult.stopReason === 'stop' && ctx.activeGoalInstruction) {
      return { action: 'continue' }
    }
    return { action: 'stop' }
  }

  return { action: 'dispatch' }
}

/** Sentinel used by the orchestrator for the normal "dispatch tool calls" path. */
export type DispatchDecision = { action: 'dispatch' }

export function isDispatchDecision(
  decision: ContinuationDecision
): decision is DispatchDecision {
  return decision.action === 'dispatch'
}
