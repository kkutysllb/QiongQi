import type { RunIdentity, RunOutcome } from '@qiongqi/contracts'
import type { RunEventStore, RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'
import { RuntimeKernel } from './runtime-kernel.js'

export type KernelTurnRunnerOptions = {
  snapshots: RunSnapshotStore
  events: RunEventStore
  leases: RunLeaseStore
  holderId: string
  identityForTurn: (threadId: string, turnId: string) => Promise<RunIdentity> | RunIdentity
  delegate: (threadId: string, turnId: string) => Promise<'completed' | 'failed' | 'aborted'> | 'completed' | 'failed' | 'aborted'
  nowIso?: () => string
}

/** Compatibility shell: RuntimeKernel owns lease/checkpoint/events while the classic turn remains a delegate. */
export class KernelTurnRunner {
  constructor(private readonly options: KernelTurnRunnerOptions) {}

  async runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> {
    const identity = await this.options.identityForTurn(threadId, turnId)
    const kernel = new RuntimeKernel({
      graph: {
        version: 'kernel-v3-delegating-classic-v1', startNodeId: 'delegate', predicates: ['next'],
        nodes: [{ id: 'delegate', kind: 'turn_delegate', effect: 'state', terminal: true, checkpoint: 'both' }],
        edges: []
      },
      snapshots: this.options.snapshots,
      events: this.options.events,
      leases: this.options.leases,
      holderId: this.options.holderId,
      ...(this.options.nowIso ? { nowIso: this.options.nowIso } : {}),
      nodes: {
        delegate: async () => {
          const status = await this.options.delegate(threadId, turnId)
          return { outcome: outcomeForStatus(status) }
        }
      }
    })
    const outcome = await kernel.run(identity)
    return outcome.status === 'completed' ? 'completed' : outcome.status === 'aborted' ? 'aborted' : 'failed'
  }
}

function outcomeForStatus(status: 'completed' | 'failed' | 'aborted'): RunOutcome {
  if (status === 'completed') return { status: 'completed', reason: 'normal_stop', retryable: false }
  if (status === 'aborted') return { status: 'aborted', reason: 'user_aborted', retryable: false }
  return { status: 'failed', reason: 'runtime_error', retryable: true }
}
