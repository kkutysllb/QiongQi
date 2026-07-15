import type { RuntimeMiddleware } from '../runtime-middleware.js'

export type BudgetMiddlewareOptions = { maxSteps?: number; maxTokens?: number; maxCostUsd?: number }

export function budgetMiddleware(options: BudgetMiddlewareOptions = {}): RuntimeMiddleware {
  return {
    id: 'budget', version: 1, hooks: ['beforeNode'],
    handle: async (context, next) => {
      const budget = context.state.budgets
      const totalTokens = budget.inputTokens + budget.outputTokens
      const outcome = budget.stepsUsed >= (options.maxSteps ?? Number.POSITIVE_INFINITY)
        ? { status: 'degraded' as const, reason: 'step_capped' as const, retryable: false }
        : totalTokens >= (options.maxTokens ?? Number.POSITIVE_INFINITY)
          ? { status: 'degraded' as const, reason: 'token_capped' as const, retryable: false }
          : budget.costUsd >= (options.maxCostUsd ?? Number.POSITIVE_INFINITY)
            ? { status: 'degraded' as const, reason: 'cost_capped' as const, retryable: false }
            : undefined
      if (outcome) return { commands: [{ type: 'terminate', outcome }] }
      return next(context)
    }
  }
}
