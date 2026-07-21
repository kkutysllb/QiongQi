import { describe, expect, it } from 'vitest'
import type { MailboxStore, MultiAgentRunStore } from '@qiongqi/ports'
import type { MailboxMessage, MultiAgentRun } from '@qiongqi/contracts'

describe('multi-agent runtime stores', () => {
  it('defines store contracts for runs and mailbox messages', async () => {
    const runs: MultiAgentRun[] = []
    const messages: MailboxMessage[] = []
    const runStore: MultiAgentRunStore = {
      save: async (run) => { runs.push(run) },
      load: async (runId) => runs.find((run) => run.runId === runId),
      listByThread: async (threadId) => runs.filter((run) => run.threadId === threadId),
      delete: async (runId) => {
        const index = runs.findIndex((run) => run.runId === runId)
        if (index >= 0) runs.splice(index, 1)
      }
    }
    const mailbox: MailboxStore = {
      enqueue: async (message) => { messages.push(message) },
      claimNext: async (agentId) => messages.find((message) => message.toAgentId === agentId && message.status === 'queued'),
      complete: async (messageId) => {
        const message = messages.find((candidate) => candidate.messageId === messageId)
        if (message) message.status = 'completed'
      },
      listForRun: async (runId) => messages.filter((message) => message.runId === runId)
    }

    await runStore.save(baseRun())
    await mailbox.enqueue(baseMessage())

    expect(await runStore.load('mar_1')).toBeDefined()
    expect(await mailbox.claimNext('researcher')).toMatchObject({ messageId: 'msg_1' })
  })
})

function baseRun(): MultiAgentRun {
  return {
    version: 1,
    runId: 'mar_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspaceKey: 'workspace_1',
    status: 'running',
    graphId: 'graph_default',
    activeNodeId: 'manager',
    activeAgentStack: ['manager'],
    branchStatus: {},
    agentRuns: [],
    events: [],
    retryCounters: {},
    budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z'
  }
}

function baseMessage(): MailboxMessage {
  return {
    messageId: 'msg_1',
    envelopeId: 'env_1',
    runId: 'mar_1',
    fromAgentId: 'manager',
    toAgentId: 'researcher',
    status: 'queued',
    payload: { prompt: 'Research runtime design.' },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z'
  }
}
