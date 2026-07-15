import type { RunIdentity, RunOutcome } from '@qiongqi/contracts'
import type { RunEventStore, RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'
import { productionKernelV3Graph } from './kernel-v3-graph.js'
import { RuntimeKernel } from './runtime-kernel.js'
import type { RuntimeNodeHandler } from './runtime-kernel-context.js'

export type KernelV3TurnRunnerOptions = {
  snapshots: RunSnapshotStore
  events: RunEventStore
  leases: RunLeaseStore
  holderId: string
  identityForTurn: (threadId: string, turnId: string) => Promise<RunIdentity> | RunIdentity
  nodes: Record<string, RuntimeNodeHandler>
  finishTurn: (
    threadId: string,
    turnId: string,
    status: 'completed' | 'failed' | 'aborted',
    outcome: RunOutcome
  ) => Promise<void> | void
  nowIso?: () => string
}

export class KernelV3TurnRunner {
  constructor(private readonly options: KernelV3TurnRunnerOptions) {}

  async runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> {
    const identity = await this.options.identityForTurn(threadId, turnId)
    const kernel = new RuntimeKernel({
      graph: productionKernelV3Graph(),
      snapshots: this.options.snapshots,
      events: this.options.events,
      leases: this.options.leases,
      holderId: this.options.holderId,
      nodes: this.options.nodes,
      ...(this.options.nowIso ? { nowIso: this.options.nowIso } : {})
    })
    const outcome = await kernel.run(identity)
    const status = legacyStatus(outcome)
    await this.options.finishTurn(threadId, turnId, status, outcome)
    return status
  }
}

function legacyStatus(outcome: RunOutcome): 'completed' | 'failed' | 'aborted' {
  if (outcome.status === 'completed') return 'completed'
  if (outcome.status === 'aborted') return 'aborted'
  return 'failed'
}
