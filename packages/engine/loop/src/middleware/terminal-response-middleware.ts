import type { RuntimeMiddleware } from '../runtime-middleware.js'

export function terminalResponseMiddleware(): RuntimeMiddleware {
  return {
    id: 'terminal-response', version: 1, hooks: ['afterNode'],
    handle: async (context, next) => {
      const hasProposalText = context.facts?.proposalHasText === true
        || String(context.facts?.proposalText ?? '').trim().length > 0
      const empty = context.facts?.stopClass === 'normal'
        && !hasProposalText
        && context.facts?.hadToolResult === true
      if (!empty) return next(context)
      const attempts = Number(context.state.middleware['terminal-response']?.data ?? 0)
      if (attempts < 1) return { commands: [{ type: 'set-middleware-state', id: 'terminal-response', state: { version: 1, data: attempts + 1 } }, { type: 'retry', reason: 'empty post-tool terminal response' }] }
      return { commands: [{ type: 'terminate', outcome: { status: 'degraded', reason: 'tool_completed_no_final_text', retryable: false } }] }
    }
  }
}
