import { expect, it } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import { KernelTurnRunner } from '@qiongqi/loop'

it('runs turn orchestration through RuntimeKernel when selected', async () => {
  const snapshots = new InMemoryRunStateStore()
  const events = new InMemoryRunEventStore()
  let delegated = 0
  const runner = new KernelTurnRunner({
    snapshots,
    events,
    leases: snapshots,
    holderId: 'kernel-test',
    identityForTurn: async () => ({ ownerUserId: 'u1', workspaceKey: 'w1', threadId: 't1', turnId: 'tu1', runId: 'r1' }),
    delegate: async () => { delegated += 1; return 'completed' }
  })
  await expect(runner.runTurn('t1', 'tu1')).resolves.toBe('completed')
  expect(delegated).toBe(1)
  await expect(events.listAfter({ ownerUserId: 'u1', workspaceKey: 'w1', threadId: 't1', turnId: 'tu1', runId: 'r1' }, 0)).resolves.toHaveLength(2)
})
