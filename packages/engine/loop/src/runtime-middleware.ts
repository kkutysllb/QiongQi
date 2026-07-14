import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'
import type { RuntimeNode } from './execution-graph.js'

export type RuntimeHook = 'beforeRun' | 'beforeNode' | 'afterNode' | 'afterRun' | 'onError' | (string & {})

export type MiddlewareCommand =
  | { type: 'set-middleware-state'; id: string; state: { version: number; data: unknown } }
  | { type: 'set-budget'; key: 'stepsUsed' | 'toolCallsUsed' | 'inputTokens' | 'outputTokens' | 'costUsd'; value: number }

export type MiddlewareContext = {
  readonly identity: RunIdentity
  readonly state: Readonly<RunStateV3>
  readonly node?: RuntimeNode
  readonly hook: RuntimeHook
  readonly error?: unknown
  readonly commands: readonly MiddlewareCommand[]
}

export type MiddlewareResult = {
  context?: MiddlewareContext
  commands?: MiddlewareCommand[]
  value?: unknown
}

export type RuntimeMiddleware = {
  id: string
  version: number
  hooks: RuntimeHook[]
  before?: string[]
  after?: string[]
  handle: (context: MiddlewareContext, next: (context: MiddlewareContext) => Promise<MiddlewareResult | undefined>) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined
}
