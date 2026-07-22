import { createHash } from 'node:crypto'
import {
  MailboxMessageSchema,
  MultiAgentRunSchema,
  TaskEnvelopeSchema,
  type AgentGraph,
  type MailboxMessage,
  type MultiAgentRun
} from '@qiongqi/contracts'
import type { MailboxStore, MultiAgentRunStore } from '@qiongqi/ports'
import { nextNodeForCondition, requireGraphNode, validateAgentGraph } from './multi-agent-graph.js'

export type EventedV2MultiAgentRuntimeOptions = {
  runs: MultiAgentRunStore
  mailbox: MailboxStore
  graph: AgentGraph
  ids: (prefix: string) => string
  nowIso: () => string
}

export class EventedV2MultiAgentRuntime {
  private readonly graph: AgentGraph
  private readonly runLocks = new Map<string, Promise<void>>()

  constructor(private readonly options: EventedV2MultiAgentRuntimeOptions) {
    this.graph = validateAgentGraph(options.graph)
  }

  async start(input: {
    threadId: string
    turnId: string
    workspaceKey: string
    prompt: string
  }): Promise<MultiAgentRun> {
    const now = this.options.nowIso()
    const startNode = requireGraphNode(this.graph, this.graph.startNodeId)
    if (startNode.kind !== 'agent') throw new Error(`AgentGraph start node must be agent: ${startNode.id}`)
    const run = MultiAgentRunSchema.parse({
      version: 1,
      runId: this.options.ids('mar'),
      threadId: input.threadId,
      turnId: input.turnId,
      workspaceKey: input.workspaceKey,
      status: 'running',
      graphId: this.graph.graphId,
      activeNodeId: startNode.id,
      activeAgentStack: [startNode.agentId],
      branchStatus: {},
      agentRuns: [{
        agentRunId: this.options.ids('agent_run'),
        agentId: startNode.agentId,
        nodeId: startNode.id,
        status: 'running',
        startedAt: now,
        updatedAt: now
      }],
      events: [{
        eventId: this.options.ids('mae'),
        type: 'run_started',
        nodeId: startNode.id,
        agentId: startNode.agentId,
        payload: { prompt: input.prompt },
        timestamp: now
      }],
      retryCounters: {},
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      createdAt: now,
      updatedAt: now
    })
    await this.options.runs.save(run)
    return run
  }

  async handoff(input: {
    runId: string
    sourceAgentId: string
    targetAgentId: string
    prompt: string
  }): Promise<MultiAgentRun> {
    return this.withRunLock(input.runId, () => this.handoffUnlocked(input))
  }

  private async handoffUnlocked(input: {
    runId: string
    sourceAgentId: string
    targetAgentId: string
    prompt: string
  }): Promise<MultiAgentRun> {
    const current = await this.options.runs.load(input.runId)
    if (!current) throw new Error(`MultiAgentRun not found: ${input.runId}`)
    if (current.graphId !== this.graph.graphId) {
      throw new Error(`MultiAgentRun graph mismatch: ${current.graphId} !== ${this.graph.graphId}`)
    }
    const existingMessage = (await this.options.mailbox.listForRun(current.runId)).find((message) =>
      message.fromAgentId === input.sourceAgentId &&
      message.toAgentId === input.targetAgentId &&
      message.payload.prompt === input.prompt &&
      ['queued', 'delivered', 'completed'].includes(message.status)
    )
    const activeNode = requireGraphNode(this.graph, current.activeNodeId)
    const activeStackAgentId = current.activeAgentStack.at(-1)
    if (
      existingMessage &&
      activeNode.kind === 'agent' &&
      activeNode.agentId === input.targetAgentId &&
      activeStackAgentId === input.targetAgentId
    ) {
      const next = MultiAgentRunSchema.parse(current)
      await this.options.runs.save(next)
      return next
    }
    if (activeNode.kind !== 'agent') throw new Error(`Handoff active node must be agent: ${activeNode.id}`)
    if (activeNode.agentId !== input.sourceAgentId) {
      throw new Error(`Handoff source mismatch: ${activeNode.agentId} !== ${input.sourceAgentId}`)
    }
    if (activeStackAgentId !== input.sourceAgentId) {
      throw new Error(`Handoff source stack mismatch: ${activeStackAgentId ?? '<empty>'} !== ${input.sourceAgentId}`)
    }
    const handoffNodeId = nextNodeForCondition(this.graph, activeNode.id, 'handoff')
    if (!handoffNodeId) throw new Error(`No handoff edge from node: ${activeNode.id}`)
    const handoffNode = requireGraphNode(this.graph, handoffNodeId)
    if (handoffNode.kind !== 'handoff') throw new Error(`Expected handoff node: ${handoffNodeId}`)
    if (handoffNode.targetAgentId !== input.targetAgentId) {
      throw new Error(`Handoff target mismatch: ${handoffNode.targetAgentId} !== ${input.targetAgentId}`)
    }
    const targetNodeId = nextNodeForCondition(this.graph, handoffNode.id, 'accepted')
    if (!targetNodeId) throw new Error(`No accepted edge from handoff node: ${handoffNode.id}`)
    const targetNode = requireGraphNode(this.graph, targetNodeId)
    if (targetNode.kind !== 'agent') throw new Error(`Handoff target node must be agent: ${targetNodeId}`)
    if (targetNode.agentId !== input.targetAgentId) {
      throw new Error(`Handoff accepted target mismatch: ${targetNode.agentId} !== ${input.targetAgentId}`)
    }
    const now = this.options.nowIso()
    const idempotencyKey = handoffIdempotencyKey({
      graphId: current.graphId,
      runId: current.runId,
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      prompt: input.prompt
    })
    const envelopeId = existingMessage?.envelopeId ?? `env_${idempotencyKey}`
    if (!existingMessage) {
      const envelope = TaskEnvelopeSchema.parse({
        envelopeId,
        kind: 'handoff',
        sourceAgentId: input.sourceAgentId,
        targetAgentId: input.targetAgentId,
        threadId: current.threadId,
        turnId: current.turnId,
        parentRunId: current.runId,
        payload: { prompt: input.prompt },
        createdAt: now
      })
      const message: MailboxMessage = MailboxMessageSchema.parse({
        messageId: `msg_${idempotencyKey}`,
        envelopeId: envelope.envelopeId,
        runId: current.runId,
        fromAgentId: input.sourceAgentId,
        toAgentId: input.targetAgentId,
        status: 'queued',
        payload: envelope.payload,
        createdAt: now,
        updatedAt: now
      })
      await this.options.mailbox.enqueue(message)
    }
    const hasTargetAgentRun = current.agentRuns.some((agentRun) =>
      agentRun.agentId === targetNode.agentId && agentRun.nodeId === targetNode.id
    )
    const hasHandoffRequestedEvent = current.events.some((event) =>
      event.type === 'handoff_requested' &&
      event.nodeId === handoffNode.id &&
      event.agentId === input.sourceAgentId &&
      event.envelopeId === envelopeId
    )
    const hasHandoffDeliveredEvent = current.events.some((event) =>
      event.type === 'handoff_delivered' &&
      event.nodeId === targetNode.id &&
      event.agentId === targetNode.agentId &&
      event.envelopeId === envelopeId
    )
    const next = MultiAgentRunSchema.parse({
      ...current,
      activeNodeId: targetNode.id,
      activeAgentStack: [...current.activeAgentStack, targetNode.agentId],
      agentRuns: hasTargetAgentRun ? current.agentRuns : [...current.agentRuns, {
        agentRunId: this.options.ids('agent_run'),
        agentId: targetNode.agentId,
        nodeId: targetNode.id,
        status: 'queued',
        startedAt: now,
        updatedAt: now
      }],
      events: [
        ...current.events,
        ...(hasHandoffRequestedEvent ? [] : [{
          eventId: this.options.ids('mae'),
          type: 'handoff_requested',
          nodeId: handoffNode.id,
          agentId: input.sourceAgentId,
          envelopeId,
          timestamp: now
        }]),
        ...(hasHandoffDeliveredEvent ? [] : [{
          eventId: this.options.ids('mae'),
          type: 'handoff_delivered',
          nodeId: targetNode.id,
          agentId: targetNode.agentId,
          envelopeId,
          timestamp: now
        }])
      ],
      updatedAt: now
    })
    await this.options.runs.save(next)
    return next
  }

  private async withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = previous
      .catch(() => undefined)
      .then(() => gate)
    this.runLocks.set(runId, current)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.runLocks.get(runId) === current) this.runLocks.delete(runId)
    }
  }

  async trace(runId: string): Promise<string[]> {
    const run = await this.options.runs.load(runId)
    if (!run) throw new Error(`MultiAgentRun not found: ${runId}`)
    return run.events.map((event) => `${event.type}:${event.agentId ?? event.nodeId ?? 'runtime'}`)
  }
}

function handoffIdempotencyKey(input: {
  graphId: string
  runId: string
  sourceAgentId: string
  targetAgentId: string
  prompt: string
}): string {
  return createHash('sha256')
    .update(JSON.stringify([
      input.graphId,
      input.runId,
      input.sourceAgentId,
      input.targetAgentId,
      input.prompt
    ]))
    .digest('hex')
    .slice(0, 32)
}
