import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'
import type { RuntimeNode } from './execution-graph.js'
import type { MiddlewareCommand, RuntimeHook } from './runtime-middleware.js'

export type RuntimeNodeContext = {
  readonly identity: RunIdentity
  readonly state: Readonly<RunStateV3>
  readonly node: RuntimeNode
  readonly hook: RuntimeHook
}

export type RuntimeNodeResult = {
  condition?: string
  outcome?: RunStateV3['outcome']
  commands?: MiddlewareCommand[]
  value?: unknown
}

export type RuntimeNodeHandler = (context: RuntimeNodeContext) => Promise<RuntimeNodeResult | undefined> | RuntimeNodeResult | undefined
