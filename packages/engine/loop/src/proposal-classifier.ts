import type { ModelProposal, TaskStateV1 } from '@qiongqi/contracts'

export type ProposalClass =
  | 'final_text'
  | 'tool_intents'
  | 'empty'
  | 'length_limited'
  | 'safety_or_refusal'
  | 'protocol_error'
  | 'context_discontinuity'

export function classifyProposal(input: {
  proposal: ModelProposal
  task: TaskStateV1
  providerSignals?: readonly string[]
}): ProposalClass {
  const { proposal } = input
  if (
    proposal.integrity.leakedProtocolText
    || proposal.integrity.malformedToolCall
    || !proposal.integrity.completeToolCalls
    || proposal.stopClass === 'protocol_error'
    || proposal.stopClass === 'transport_error'
    || proposal.stopClass === 'unknown'
  ) {
    return 'protocol_error'
  }
  if (proposal.stopClass === 'safety' || proposal.stopClass === 'refusal') {
    return 'safety_or_refusal'
  }
  const signals = [proposal.text, proposal.reasoning, ...(input.providerSignals ?? [])]
  if (signals.some(isContextDiscontinuityText)) return 'context_discontinuity'
  if (proposal.toolIntents.length > 0) return 'tool_intents'
  if (proposal.stopClass === 'length') return 'length_limited'
  if (!proposal.text.trim() && !proposal.reasoning.trim()) return 'empty'
  return 'final_text'
}

function isContextDiscontinuityText(text: string): boolean {
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
  if (!normalized) return false

  const asksForTask = includesAny(normalized, [
    '请重新描述',
    '请告诉我下一步',
    '请告诉我如何继续',
    '请问接下来想做什么',
    '应该继续什么',
    '应该做什么',
    'whatshouldicontinuewith',
    'tellmewhattocontinuewith',
    'tellmewhatishouldcontinuewith',
    'tellmewhattodonext',
    'whatshouldidonext',
    'restateyourtask',
    'repeattherequest'
  ])
  if (!asksForTask) return false

  const statesDiscontinuity = includesAny(normalized, [
    '上下文',
    '对话内容',
    '之前的任务',
    '之前的请求',
    '无法接续',
    '无法还原',
    '无法恢复',
    '不在我的可见范围',
    '看不到先前',
    'cannotseetheearlier',
    'cannotseetheprevious',
    'nolongerhavetheprior',
    'lostthecontext',
    'contextisnotavailable',
    'earliertaskanymore'
  ])
  if (statesDiscontinuity) return true

  // A bare continuation question is discontinuity-specific. Domain
  // clarifications ask for a concrete field, entity, or time range instead.
  return normalized === 'whatshouldicontinuewith'
    || normalized === '请告诉我下一步应该做什么'
    || normalized === '我应该继续什么'
}

function includesAny(text: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate))
}
