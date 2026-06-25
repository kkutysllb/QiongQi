/**
 * LoopPolicy: pure decision function deciding whether a turn step should
 * stop, continue, fail, dispatch tool calls, or materialise a plan.
 *
 * Logic migrated verbatim from continuation-policy.ts decideContinuation.
 * Zero side effects. Side effects (applyItem/dispatch/record) live in LoopRunner.
 */

import type { ToolCallLike } from '@qiongqi/ports'
import type { IdGenerator } from '@qiongqi/ports'
import type { TurnItem } from '@qiongqi/contracts'
import { makeToolCallItem } from '@qiongqi/domain'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'
import { latestUserMessageText } from './loop-helpers.js'
import type { BuildContext } from './prompt-builder.js'
import type { StepResult } from './model-step-runner.js'

export interface LoopPolicyInput {
  stepResult: Extract<StepResult, { kind: 'ran' }>
  ctx: BuildContext
  ids: IdGenerator
  threadId: string
  turnId: string
}

export type LoopDecision =
  | { action: 'stop' }
  | { action: 'continue' }
  | { action: 'failed' }
  | { action: 'failed_with_error'; errorMessage: string; errorCode: string }
  | { action: 'materialize_plan'; planCall: ToolCallLike; planToolCallItem: TurnItem }
  | { action: 'dispatch' }

export function decideLoopContinuation(input: LoopPolicyInput): LoopDecision {
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
