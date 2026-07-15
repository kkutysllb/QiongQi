import { describe, expect, it } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore, InMemoryTaskStateStore } from '@qiongqi/adapter-storage'
import type { ModelProposal, RunIdentity, TaskStateV1 } from '@qiongqi/contracts'
import { makeToolResultItem, makeUserItem } from '@qiongqi/domain'
import {
  RuntimeKernel,
  createKernelV3NodeHandlers,
  productionKernelV3Graph
} from '@qiongqi/loop'

const identity: RunIdentity = {
  ownerUserId: 'owner-1',
  workspaceKey: '/workspace-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  runId: 'run-1'
}

describe('Kernel v3 production node handlers', () => {
  it('commits a normal final proposal through the production graph', async () => {
    const harness = await createHarness([
      proposal({ text: '报告已完成。' })
    ])
    const outcome = await harness.kernel.run(identity)

    expect(outcome).toMatchObject({ status: 'completed', reason: 'normal_stop' })
    expect(harness.applied).toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: '报告已完成。',
      status: 'completed'
    }))
    expect(await nodeSequence(harness.events)).toEqual([
      'prepare-turn',
      'restore-task',
      'build-context',
      'invoke-model',
      'normalize-proposal',
      'evaluate',
      'commit-assistant'
    ])
  })

  it('recovers from task discontinuity without committing the model question', async () => {
    const harness = await createHarness([
      proposal({ text: 'What should I continue with?' }),
      proposal({ text: '已继续生成报告。' })
    ])
    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })

    expect(harness.applied).not.toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: 'What should I continue with?'
    }))
    expect(harness.requests[1]?.contextInstructions).toContainEqual(
      expect.stringContaining('Authoritative task recovery entry')
    )
    expect(await nodeSequence(harness.events)).toEqual([
      'prepare-turn', 'restore-task', 'build-context', 'invoke-model',
      'normalize-proposal', 'evaluate', 'recover-context', 'build-context',
      'invoke-model', 'normalize-proposal', 'evaluate', 'commit-assistant'
    ])
  })

  it('commits tools, advances TaskState, and loops back through build-context', async () => {
    const harness = await createHarness([
      proposal({
        stopClass: 'tool_calls',
        toolIntents: [{ callId: 'call-1', toolName: 'read_data', arguments: { path: 'data.json' } }],
        text: ''
      }),
      proposal({ text: '数据读取完成。' })
    ])
    await expect(harness.kernel.run(identity)).resolves.toMatchObject({ status: 'completed' })

    await expect(harness.taskStates.load(identity)).resolves.toMatchObject({
      revision: 2,
      toolLedger: [expect.objectContaining({ callId: 'call-1', status: 'committed' })]
    })
    expect(await nodeSequence(harness.events)).toEqual([
      'prepare-turn', 'restore-task', 'build-context', 'invoke-model',
      'normalize-proposal', 'evaluate', 'prepare-tools', 'commit-tools',
      'build-context', 'invoke-model', 'normalize-proposal', 'evaluate',
      'commit-assistant'
    ])
  })
})

async function createHarness(proposals: ModelProposal[]) {
  const snapshots = new InMemoryRunStateStore()
  const events = new InMemoryRunEventStore()
  const taskStates = new InMemoryTaskStateStore()
  const prepared = await taskStates.prepare(task(), 0)
  await taskStates.commit(prepared)
  const applied: Array<Record<string, unknown>> = []
  const requests: Array<Record<string, unknown>> = []
  const queue = [...proposals]
  const signal = new AbortController().signal
  const thread = {
    id: identity.threadId,
    ownerUserId: identity.ownerUserId,
    workspace: identity.workspaceKey,
    title: 'test',
    status: 'running',
    turns: [{
      id: identity.turnId,
      threadId: identity.threadId,
      status: 'running',
      prompt: '继续',
      steering: [],
      items: [],
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      createdAt: 'now'
    }],
    createdAt: 'now',
    updatedAt: 'now'
  }
  const handlers = createKernelV3NodeHandlers({
    threadStore: { get: async () => thread } as never,
    sessionStore: {
      loadItems: async () => [makeUserItem({
        id: 'user-1',
        threadId: identity.threadId,
        turnId: identity.turnId,
        text: '完成报告'
      })]
    } as never,
    taskStates,
    turns: {
      getTurn: async () => thread.turns[0],
      getAbortController: () => signal,
      applyItem: async (_threadId: string, item: Record<string, unknown>) => {
        applied.push(item)
      },
      updateItem: async () => null
    } as never,
    promptBuilder: {
      build: async () => ({
        kind: 'built',
        ctx: {
          request: {
            threadId: identity.threadId,
            turnId: identity.turnId,
            model: 'test-model',
            prefix: [],
            history: [],
            tools: [{
              name: 'read_data',
              description: 'read',
              inputSchema: {},
              effectPolicy: { effect: 'read', replay: 'safe' }
            }],
            abortSignal: signal
          }
        }
      })
    } as never,
    proposalRunner: {
      run: async (request: Record<string, unknown>) => {
        requests.push(request)
        const next = queue.shift()
        if (!next) throw new Error('proposal queue exhausted')
        return next
      }
    } as never,
    toolRuntime: {
      execute: async (input: { state: unknown; call: { callId: string; toolName: string } }) => ({
        state: input.state,
        replayed: false,
        result: {
          approved: true,
          item: makeToolResultItem({
            id: `result-${input.call.callId}`,
            threadId: identity.threadId,
            turnId: identity.turnId,
            callId: input.call.callId,
            toolName: input.call.toolName,
            output: { ok: true }
          })
        }
      })
    } as never,
    createToolContext: async () => ({
      threadId: identity.threadId,
      turnId: identity.turnId,
      workspace: identity.workspaceKey,
      ownerUserId: identity.ownerUserId,
      approvalPolicy: 'trusted',
      abortSignal: signal,
      awaitApproval: async () => 'allow'
    }),
    ids: { next: (prefix: string) => `${prefix}-1` },
    nowIso: () => '2026-07-15T00:00:00.000Z'
  })
  return {
    kernel: new RuntimeKernel({
      graph: productionKernelV3Graph(),
      snapshots,
      events,
      leases: snapshots,
      holderId: 'test',
      nodes: handlers
    }),
    events,
    taskStates,
    applied,
    requests
  }
}

async function nodeSequence(events: InMemoryRunEventStore): Promise<string[]> {
  return (await events.listAfter(identity, 0))
    .filter((event) => event.eventType === 'node.started')
    .map((event) => event.stepId ?? '')
}

function proposal(overrides: Partial<ModelProposal>): ModelProposal {
  return {
    proposalId: `proposal-${Math.random()}`,
    model: 'test-model',
    stopClass: 'normal',
    integrity: {
      leakedProtocolText: false,
      malformedToolCall: false,
      completeToolCalls: true
    },
    text: 'done',
    reasoning: '',
    toolIntents: [],
    ...overrides
  }
}

function task(): TaskStateV1 {
  return {
    version: 1,
    identity,
    revision: 1,
    source: {
      objectiveItemId: 'user-1',
      sourceItemIds: ['user-1'],
      sourceDigest: 'source-1'
    },
    objective: '完成报告',
    constraints: [],
    completedActions: [],
    pendingActions: [{ id: 'next-1', text: '生成报告', status: 'pending', evidenceItemIds: [] }],
    activeSkillIds: [],
    artifacts: [],
    toolLedger: [],
    createdAt: 'now',
    updatedAt: 'now'
  }
}
