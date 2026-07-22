import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileMailboxStore, FileMultiAgentRunStore, InMemoryMailboxStore, InMemoryMultiAgentRunStore } from '@qiongqi/adapter-storage'
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

  it('does not expose a mailbox message when the run update fails', async () => {
    const runs = new FailFirstUpdateAfterMutateRunStore()
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
    })).rejects.toThrow('update failed once')

    expect(await mailbox.listForRun(run.runId)).toEqual([])
    expect(await runs.load(run.runId)).toEqual(run)
  })

  it('recovers a handoff after run update succeeds but mailbox enqueue fails once', async () => {
    const runs = new InMemoryMultiAgentRunStore()
    const mailbox = new FailFirstEnqueueMailboxStore()
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
    })).rejects.toThrow('enqueue failed once')

    expect(await mailbox.listForRun(run.runId)).toEqual([])
    expect((await runs.load(run.runId))?.activeAgentStack).toEqual(['manager', 'researcher'])
    expect((await runs.load(run.runId))?.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'pending' }])

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
    expect((await runs.load(run.runId))?.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'published' }])
  })

  it('flushes pending outbox handoffs from a new runtime instance after enqueue failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-evented-v2-runtime-'))
    const runs = new FileMultiAgentRunStore(root)
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const runtimeA = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new FailFirstEnqueueFileMailboxStore(root),
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const runtimeB = new EventedV2MultiAgentRuntime({
      runs,
      mailbox: new FileMailboxStore(root),
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    try {
      const run = await runtimeA.start({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspaceKey: 'workspace_1',
        prompt: 'Research evented v2.'
      })

      await expect(runtimeA.handoff({
        runId: run.runId,
        sourceAgentId: 'manager',
        targetAgentId: 'researcher',
        prompt: 'Summarize the current evented loop.'
      })).rejects.toThrow('enqueue failed once')

      expect(await new FileMailboxStore(root).listForRun(run.runId)).toEqual([])
      expect((await runs.load(run.runId))?.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'pending' }])

      const recovered = await runtimeB.flushPendingOutbox(run.runId)

      expect(await new FileMailboxStore(root).listForRun(run.runId)).toMatchObject([
        { fromAgentId: 'manager', toAgentId: 'researcher', status: 'queued' }
      ])
      expect(recovered.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'published' }])
      expect((await runs.load(run.runId))?.outbox).toMatchObject([{ kind: 'mailbox_enqueue', status: 'published' }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not requeue a handoff message that another worker already claimed', async () => {
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
    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })
    expect(await mailbox.claimNext('researcher')).toMatchObject({ status: 'delivered' })

    await runtime.handoff({
      runId: run.runId,
      sourceAgentId: 'manager',
      targetAgentId: 'researcher',
      prompt: 'Summarize the current evented loop.'
    })

    expect(await mailbox.listForRun(run.runId)).toMatchObject([{ status: 'delivered' }])
  })

  it('keeps concurrent identical handoffs idempotent for the same run', async () => {
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

    await Promise.all([
      runtime.handoff({
        runId: run.runId,
        sourceAgentId: 'manager',
        targetAgentId: 'researcher',
        prompt: 'Summarize the current evented loop.'
      }),
      runtime.handoff({
        runId: run.runId,
        sourceAgentId: 'manager',
        targetAgentId: 'researcher',
        prompt: 'Summarize the current evented loop.'
      })
    ])

    const messages = await mailbox.listForRun(run.runId)
    const saved = await runs.load(run.runId)
    expect(messages).toHaveLength(1)
    expect(saved?.activeAgentStack).toEqual(['manager', 'researcher'])
    expect(saved?.agentRuns.filter((agentRun) => agentRun.agentId === 'researcher')).toHaveLength(1)
    expect(saved?.events.filter((event) => event.type === 'handoff_delivered')).toHaveLength(1)
  })

  it('keeps file-backed handoffs atomic across runtime instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-evented-v2-runtime-'))
    const runs = new FileMultiAgentRunStore(root)
    const mailbox = new FileMailboxStore(root)
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    const runtimeA = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    const runtimeB = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graph,
      ids: nextId(),
      nowIso: fixedClock()
    })
    try {
      const run = await runtimeA.start({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspaceKey: 'workspace_1',
        prompt: 'Research evented v2.'
      })

      await Promise.all([
        runtimeA.handoff({
          runId: run.runId,
          sourceAgentId: 'manager',
          targetAgentId: 'researcher',
          prompt: 'Summarize the current evented loop.'
        }),
        runtimeB.handoff({
          runId: run.runId,
          sourceAgentId: 'manager',
          targetAgentId: 'researcher',
          prompt: 'Summarize the current evented loop.'
        })
      ])

      const messages = await mailbox.listForRun(run.runId)
      const saved = await runs.load(run.runId)
      expect(messages).toHaveLength(1)
      expect(saved?.activeAgentStack).toEqual(['manager', 'researcher'])
      expect(saved?.agentRuns.filter((agentRun) => agentRun.agentId === 'researcher')).toHaveLength(1)
      expect(saved?.events.filter((event) => event.type === 'handoff_requested')).toHaveLength(1)
      expect(saved?.events.filter((event) => event.type === 'handoff_delivered')).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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

class FailFirstUpdateAfterMutateRunStore extends InMemoryMultiAgentRunStore implements MultiAgentRunStore {
  private updates = 0

  async update(runId: string, mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>): Promise<MultiAgentRun> {
    this.updates += 1
    if (this.updates === 1) {
      const current = await this.load(runId)
      if (!current) throw new Error(`MultiAgentRun not found: ${runId}`)
      await mutate(current)
      throw new Error('update failed once')
    }
    return super.update(runId, mutate)
  }
}

class FailFirstEnqueueMailboxStore extends InMemoryMailboxStore {
  private enqueues = 0

  async enqueue(message: Parameters<InMemoryMailboxStore['enqueue']>[0]): Promise<void> {
    this.enqueues += 1
    if (this.enqueues === 1) throw new Error('enqueue failed once')
    return super.enqueue(message)
  }
}

class FailFirstEnqueueFileMailboxStore extends FileMailboxStore {
  private enqueues = 0

  async enqueue(message: Parameters<FileMailboxStore['enqueue']>[0]): Promise<void> {
    this.enqueues += 1
    if (this.enqueues === 1) throw new Error('enqueue failed once')
    return super.enqueue(message)
  }
}
