import type { RunIdentity, RunOutcome, RunStateV3, ToolEffectPolicy } from '@qiongqi/contracts'
import type { ToolCallLike, ToolHost, ToolHostContext, ToolHostResult } from '@qiongqi/ports'
import { EffectCommitCoordinator } from './effect-commit.js'

export type CrashPoint = 'prepare' | 'after_tool_execute' | 'before_commit' | 'after_commit'
export type ToolRuntimeV3Options = { toolHost: ToolHost; effects: EffectCommitCoordinator; crashPoint?: (point: CrashPoint) => void }
export type ToolRuntimeV3Input = { identity: RunIdentity; state: RunStateV3; call: ToolCallLike; context: ToolHostContext; policy: ToolEffectPolicy; crashAfterExecute?: boolean }
export type ToolRuntimeV3Result = { state: RunStateV3; result?: ToolHostResult; replayed: boolean; outcome?: RunOutcome }

export class ToolRuntimeV3 {
  constructor(private readonly options: ToolRuntimeV3Options) {}

  async execute(input: ToolRuntimeV3Input): Promise<ToolRuntimeV3Result> {
    const key = this.options.effects.idempotencyKey(input.identity, input.call.callId)
    const committed = input.state.committedEffects.find((effect) => effect.idempotencyKey === key)
    if (committed && input.policy.replay !== 'safe') {
      const cached = this.options.effects.cachedResult(key) as ToolHostResult | undefined
      if (cached) return { state: input.state, result: cached, replayed: true }
      return { state: input.state, replayed: true, outcome: { status: 'suspended', reason: 'required_action_missing', retryable: true, details: { code: 'effect_requires_verification', idempotencyKey: key } } }
    }
    const prepared = this.options.effects.prepare(input.state, input.identity, { callId: input.call.callId, target: input.call.toolName, arguments: input.call.arguments }, input.policy)
    this.options.crashPoint?.('prepare')
    await this.options.effects.recordPrepared(input.identity, prepared.state, prepared.intent)
    const result = await this.options.toolHost.execute(input.call, input.context)
    this.options.crashPoint?.('after_tool_execute')
    if (input.crashAfterExecute) return { state: prepared.state, replayed: false, outcome: { status: 'suspended', reason: 'runtime_error', retryable: true, details: { code: 'crash_between_execute_and_commit', idempotencyKey: key } } }
    this.options.crashPoint?.('before_commit')
    const committedResult = await this.options.effects.commit(input.identity, prepared.state, prepared.intent, result)
    this.options.crashPoint?.('after_commit')
    return { state: committedResult.state, result, replayed: false }
  }
}
