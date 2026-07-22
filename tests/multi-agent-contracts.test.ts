import { describe, expect, it } from 'vitest'
import {
  AgentGraphSchema,
  MailboxMessageSchema,
  MultiAgentOutboxIntentSchema,
  MultiAgentRunSchema,
  TaskEnvelopeSchema
} from '@qiongqi/contracts'

describe('multi-agent runtime contracts', () => {
  it('parses a manager-to-specialist graph', () => {
    const graph = AgentGraphSchema.parse({
      version: 1,
      graphId: 'graph_default',
      startNodeId: 'manager',
      nodes: [
        { id: 'manager', kind: 'agent', agentId: 'manager', label: 'Manager' },
        { id: 'handoff_research', kind: 'handoff', targetAgentId: 'researcher' },
        { id: 'researcher', kind: 'agent', agentId: 'researcher', label: 'Researcher' },
        { id: 'done', kind: 'terminate' }
      ],
      edges: [
        { from: 'manager', to: 'handoff_research', condition: 'handoff' },
        { from: 'handoff_research', to: 'researcher', condition: 'accepted' },
        { from: 'researcher', to: 'done', condition: 'completed' }
      ]
    })

    expect(graph.nodes.map((node) => node.kind)).toEqual(['agent', 'handoff', 'agent', 'terminate'])
  })

  it('parses a typed handoff task envelope', () => {
    const envelope = TaskEnvelopeSchema.parse({
      envelopeId: 'env_1',
      kind: 'handoff',
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      threadId: 'thread_1',
      turnId: 'turn_1',
      parentRunId: 'run_parent',
      payload: { prompt: 'Research durable multi-agent orchestration.' },
      createdAt: '2026-07-21T00:00:00.000Z'
    })

    expect(envelope.kind).toBe('handoff')
    expect(envelope.payload.prompt).toContain('Research')
  })

  it('parses a durable multi-agent run with agent sub-runs', () => {
    const run = MultiAgentRunSchema.parse({
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
      agentRuns: [{
        agentRunId: 'agent_run_1',
        agentId: 'manager',
        nodeId: 'manager',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z'
      }],
      events: [],
      outbox: [],
      retryCounters: {},
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    })

    expect(run.agentRuns[0]?.agentId).toBe('manager')
  })

  it('parses a pending mailbox enqueue outbox intent for recovery', () => {
    const intent = MultiAgentOutboxIntentSchema.parse({
      outboxId: 'outbox_1',
      kind: 'mailbox_enqueue',
      status: 'pending',
      message: {
        messageId: 'msg_1',
        envelopeId: 'env_1',
        runId: 'mar_1',
        fromAgentId: 'manager',
        toAgentId: 'researcher',
        status: 'queued',
        payload: { prompt: 'Summarize existing runtime modes.' },
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z'
      },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    })

    expect(intent.kind).toBe('mailbox_enqueue')
    expect(intent.status).toBe('pending')
  })

  it('parses a mailbox message correlated to an envelope', () => {
    const message = MailboxMessageSchema.parse({
      messageId: 'msg_1',
      envelopeId: 'env_1',
      runId: 'mar_1',
      fromAgentId: 'manager',
      toAgentId: 'researcher',
      status: 'queued',
      payload: { prompt: 'Summarize existing runtime modes.' },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z'
    })

    expect(message.status).toBe('queued')
  })
})
