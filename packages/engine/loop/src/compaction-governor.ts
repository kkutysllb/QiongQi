export type CompactionDecision =
  | { action: 'compact'; predictedNetSavings: number; reason: 'pressure' }
  | { action: 'skip'; predictedNetSavings: number; reason: 'insufficient_net_savings' | 'cooldown' | 'summary_only' | 'no_history' }

export class CompactionGovernor {
  private lastCompactionStep = -Infinity
  private lastSummaryDigest: string | undefined

  constructor(private readonly options: { cooldownSteps?: number; minimumNetSavings?: number } = {}) {}

  decide(input: {
    step: number
    fixedTokens: number
    compactableTokens: number
    summaryTokens: number
    historyItems: number
    summaryOnly?: boolean
  }): CompactionDecision {
    const predictedNetSavings = Math.max(0, input.compactableTokens - input.summaryTokens)
    if (input.summaryOnly) return { action: 'skip', predictedNetSavings, reason: 'summary_only' }
    if (input.historyItems <= 0 || input.compactableTokens <= 0) return { action: 'skip', predictedNetSavings, reason: 'no_history' }
    if (input.step - this.lastCompactionStep < (this.options.cooldownSteps ?? 2)) return { action: 'skip', predictedNetSavings, reason: 'cooldown' }
    if (predictedNetSavings < (this.options.minimumNetSavings ?? 128)) return { action: 'skip', predictedNetSavings, reason: 'insufficient_net_savings' }
    return { action: 'compact', predictedNetSavings, reason: 'pressure' }
  }

  commit(input: { step: number; summaryDigest: string }): void {
    this.lastCompactionStep = input.step
    this.lastSummaryDigest = input.summaryDigest
  }

  get summaryDigest(): string | undefined { return this.lastSummaryDigest }
}
