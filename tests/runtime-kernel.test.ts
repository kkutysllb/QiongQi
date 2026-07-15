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
        prepare: async () => ({
          condition: 'next',
          value: { taskRevision: 2 },
          commands: [{ type: 'set-task-revision', revision: 2 }]
        }),
        model: async () => ({ condition: 'next' }),
        evaluate: async () => ({ condition: 'next' }),
        complete: async () => ({ outcome: { status: 'completed', reason: 'normal_stop', retryable: false } })
      }
    })
    await expect(kernel.run(identity)).resolves.toMatchObject({ status: 'completed', reason: 'normal_stop' })
    const persisted = await snapshots.load(identity)
    expect(persisted?.status).toBe('completed')
    expect(persisted?.nodeData.prepare).toEqual({ taskRevision: 2 })
    expect(persisted?.taskRevision).toBe(2)
    await expect(events.listAfter(identity, 0)).resolves.toHaveLength(8)
  })

  it('keeps a terminal outcome monotonic when afterNode middleware tries to replace it', async () => {
    const snapshots = new InMemoryRunStateStore()
    const kernel = new RuntimeKernel({
      graph: {
        version: 'terminal-v1',
        startNodeId: 'complete',
        predicates: ['next'],
        nodes: [{ id: 'complete', kind: 'complete', effect: 'state', terminal: true }],
        edges: []
      },
      snapshots,
      events: new InMemoryRunEventStore(),
      leases: snapshots,
      holderId: 'test-holder',
      middleware: new MiddlewareChain([{
        id: 'late-termination',
        version: 1,
        hooks: ['afterNode'],
        handle: async (_context, next) => {
          const result = await next(_context)
          return {
            ...result,
            commands: [{
              type: 'terminate',
              outcome: { status: 'failed', reason: 'runtime_error', retryable: true }
            }]
          }
        }
      }]),
      nodes: {
        complete: () => ({
          outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
        })
      }
    })

    await expect(kernel.run({ ...identity, runId: 'terminal-run' })).resolves.toMatchObject({
      status: 'completed',
      reason: 'normal_stop'
    })
  })
})
