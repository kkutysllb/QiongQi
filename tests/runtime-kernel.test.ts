import { describe, expect, it } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import { MiddlewareChain, RuntimeKernel, validateExecutionGraph, type ExecutionGraph } from '@qiongqi/loop'
import type { RunIdentity } from '@qiongqi/contracts'

const identity: RunIdentity = { ownerUserId: 'u1', threadId: 't1', turnId: 'tu1', runId: 'r1', workspaceKey: 'w1' }

const graph: ExecutionGraph = {
  version: 'test-v1', startNodeId: 'prepare', predicates: ['next'],
  nodes: [
    { id: 'prepare', kind: 'prepare', effect: 'pure', checkpoint: 'both' },
    { id: 'model', kind: 'model', effect: 'model', checkpoint: 'both' },
    { id: 'evaluate', kind: 'evaluate', effect: 'pure', checkpoint: 'both' },
    { id: 'complete', kind: 'complete', effect: 'state', terminal: true, checkpoint: 'after' }
  ],
  edges: [
    { from: 'prepare', to: 'model', when: 'next' },
    { from: 'model', to: 'evaluate', when: 'next' },
    { from: 'evaluate', to: 'complete', when: 'next' }
  ]
}

describe('RuntimeKernel', () => {
  it('runs a graph, checkpoints each node, and returns a structured outcome', async () => {
    validateExecutionGraph(graph)
    const snapshots = new InMemoryRunStateStore()
    const events = new InMemoryRunEventStore()
    const kernel = new RuntimeKernel({
      graph,
      snapshots,
      events,
      leases: snapshots,
      holderId: 'test-holder',
      nowIso: () => '2026-07-15T00:00:00.000Z',
      nodes: {
        prepare: async () => ({ condition: 'next' }),
        model: async () => ({ condition: 'next' }),
        evaluate: async () => ({ condition: 'next' }),
        complete: async () => ({ outcome: { status: 'completed', reason: 'normal_stop', retryable: false } })
      }
    })
    await expect(kernel.run(identity)).resolves.toMatchObject({ status: 'completed', reason: 'normal_stop' })
    const persisted = await snapshots.load(identity)
    expect(persisted?.status).toBe('completed')
    await expect(events.listAfter(identity, 0)).resolves.toHaveLength(8)
  })
})
