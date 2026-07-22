import { describe, expect, it } from 'vitest'
import { InMemoryMailboxStore, InMemoryMultiAgentRunStore } from '@qiongqi/adapter-storage'
import type { AgentGraph, MultiAgentRun } from '@qiongqi/contracts'
import { EventedV2MultiAgentRuntime, defaultManagerSpecialistGraph } from '@qiongqi/loop'
import type { MultiAgentRunStore } from '@qiongqi/ports'

describe('EventedV2MultiAgentRuntime', () => {
  it('starts a durable multi-agent run without changing single-agent behavior', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })

    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    expect(run).toMatchObject({
      status: 'running',
      activeNodeId: 'manager',
      activeAgentStack: ['manager']
    })
    expect(await runs.load(run.runId)).toMatchObject({ runId: run.runId })
  })

  it('records a manager-to-specialist handoff into the durable mailbox', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    const next = await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })

    expect(next.activeNodeId).toBe('researcher')
    expect(next.activeAgentStack).toEqual(['manager', 'researcher'])
    expect(next.events.map((event) => event.type)).toContain('handoff_delivered')
    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ toAgentId: 'researcher', status: 'queued' }])
  })

  it('rejects a handoff when the accepted target node belongs to another agent', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const graph: AgentGraph = {
      version: 1,
      graphId: 'manager_to_mismatched_researcher',
      startNodeId: 'manager',
      nodes: [
        { id: 'manager', kind: 'agent', agentId: 'manager', label: 'Manager' },
        { id: 'handoff_researcher', kind: 'handoff', targetAgentId: 'researcher' },
        { id: 'writer', kind: 'agent', agentId: 'writer', label: 'Writer' }
      ],
      edges: [
        { from: 'manager', to: 'handoff_researcher', condition: 'handoff' },
        { from: 'handoff_researcher', to: 'writer', condition: 'accepted' }
      ]
    }
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await expect(runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })).rejects.toThrow('Handoff accepted target mismatch: writer !== researcher')
  })

  it('rejects a handoff for a run created from a different graph', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const researcherRuntime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const writerRuntime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'writer' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await researcherRuntime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await expect(writerRuntime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'writer',
      prompt: 'Summarize the current evented loop.'
    })).rejects.toThrow('MultiAgentRun graph mismatch: manager_to_researcher !== manager_to_writer')
  })

  it('rejects a handoff from a non-active source agent without mutating durable state', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await expect(runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'writer',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })).rejects.toThrow('Handoff source mismatch: manager !== writer')

    expect(await mailbox.listForRun(run.runId)).toEqual([])
    expect(await runs.load(run.runId)).toEqual(run)
  })

  it('recovers a handoff after mailbox enqueue succeeds but run save fails once', async () => {
    const runs = new FailSecondSaveOnceRunStore()
    const mailbox = new InMemoryMailboxStore()
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })

    await expect(runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })).rejects.toThrow('save failed once')

    const next = await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })

    expect(await mailbox.listForRun(run.runId)).toMatchObject([
      { fromAgentId: 'manager', toAgentId: 'researcher', status: 'queued' }
    ])
    expect(next.activeAgentStack).toEqual(['manager', 'researcher'])
    expect(next.agentRuns.filter((agentRun) => agentRun.agentId === 'researcher')).toHaveLength(1)
    expect(next.events.filter((event) => event.type === 'handoff_delivered')).toHaveLength(1)
  })

  it('returns a compact trace for observability', async () => {
    const runtime = new EventedV2MultiAgentRuntime({
      runs: new InMemoryMultiAgentRunStore(),
      mailbox: new InMemoryMailboxStore(),
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextId(),
      nowIso: fixedClock()
    })
    const run = await runtime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Research evented v2.'
    })
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize current loop.'
    })

    expect(await runtime.trace(run.runId)).toEqual([
      'run_started:manager',
      'handoff_requested:manager',
      'handoff_delivered:researcher'
    ])
  })
})

function fixedClock(): () => string {
  return () => '2026-07-21T00:00:00.000Z'
}

function nextId(): (prefix: string) => string {
  let seq = 0
  return (prefix) => `${prefix}_${++seq}`
}

class FailSecondSaveOnceRunStore extends InMemoryMultiAgentRunStore implements MultiAgentRunStore {
  private saves = 0

  async save(run: MultiAgentRun): Promise<void> {
    this.saves += 1
    if (this.saves === 2) throw new Error('save failed once')
    await super.save(run)
  }
}
