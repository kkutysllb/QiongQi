import { randomUUID } from 'node:crypto'
import type { RunEventEnvelope, RunIdentity, RunOutcome, RunStateV3 } from '@qiongqi/contracts'
import type { RunEventStore, RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'
import { MiddlewareChain } from './middleware-chain.js'
import { outgoingEdges, validateExecutionGraph, type ExecutionGraph, type RuntimeNode } from './execution-graph.js'
import type { RuntimeNodeHandler, RuntimeNodeResult } from './runtime-kernel-context.js'

export type RuntimeKernelOptions = {
  graph: ExecutionGraph
  snapshots: RunSnapshotStore
  events: RunEventStore
  leases: RunLeaseStore
  holderId: string
  nowIso?: () => string
  leaseTtlMs?: number
  middleware?: MiddlewareChain
  nodes: Record<string, RuntimeNodeHandler>
}

export class RuntimeKernel {
  private readonly options: Omit<RuntimeKernelOptions, 'nowIso' | 'leaseTtlMs' | 'middleware'> &
    Required<Pick<RuntimeKernelOptions, 'nowIso' | 'leaseTtlMs' | 'middleware'>>

  constructor(options: RuntimeKernelOptions) {
    validateExecutionGraph(options.graph)
    this.options = { nowIso: () => new Date().toISOString(), leaseTtlMs: 30_000, middleware: new MiddlewareChain(), ...options }
  }

  async run(identity: RunIdentity): Promise<RunOutcome> {
    const { leases, snapshots, events, holderId } = this.options
    const lease = await leases.acquire(identity.runId, holderId, this.options.leaseTtlMs)
    if (!lease.acquired) return { status: 'failed', reason: 'runtime_error', retryable: true, details: { code: 'lease_unavailable' } }
    try {
      let state = await snapshots.load(identity)
      if (!state) state = this.initialState(identity)
      if (state.status === 'completed' || state.status === 'degraded' || state.status === 'failed' || state.status === 'aborted' || state.status === 'suspended') {
        return state.outcome ?? { status: state.status, reason: 'runtime_error', retryable: false }
      }
      state = { ...state, status: 'running', updatedAt: this.options.nowIso() }
      await snapshots.save(state)
      await this.options.middleware.run('beforeRun', this.middlewareContext(identity, state, 'beforeRun'))
      while (true) {
        const node = this.options.graph.nodes.find((candidate) => candidate.id === state!.cursor.nodeId)
        if (!node) throw new Error(`unknown graph node: ${state!.cursor.nodeId}`)
        await snapshots.save(state)
        const started = await this.recordEvent(identity, state, node.id, 'node.started', { nodeId: node.id, stepIndex: state.cursor.stepIndex })
        state = { ...state, cursor: { ...state.cursor, checkpointSeq: started.seq }, updatedAt: this.options.nowIso() }
        const before = await this.options.middleware.run('beforeNode', this.middlewareContext(identity, state, 'beforeNode', node))
        const handler = this.options.nodes[node.id]
        if (!handler) throw new Error(`missing runtime node handler: ${node.id}`)
        const result = await handler({ identity, state, node, hook: 'beforeNode' })
        const merged = this.applyCommands(state, [...(before?.commands ?? []), ...(result?.commands ?? [])])
        const outcome = result?.outcome ?? (node.terminal ? { status: 'completed', reason: 'normal_stop', retryable: false } : undefined)
        const completed = await this.recordEvent(identity, merged, node.id, 'node.completed', { nodeId: node.id, stepIndex: merged.cursor.stepIndex, outcome })
        if (outcome) {
          state = { ...merged, status: outcome.status, outcome, cursor: { ...merged.cursor, checkpointSeq: completed.seq }, updatedAt: this.options.nowIso() }
          await snapshots.save(state)
          await this.options.middleware.run('afterNode', this.middlewareContext(identity, state, 'afterNode', node))
          await this.options.middleware.run('afterRun', this.middlewareContext(identity, state, 'afterRun'))
          return outcome
        }
        const condition = result?.condition ?? 'next'
        const edge = outgoingEdges(this.options.graph, node.id, condition)[0]
        if (!edge) throw new Error(`no graph edge for ${node.id} condition ${condition}`)
        state = { ...merged, status: 'running', cursor: { stepIndex: merged.cursor.stepIndex + 1, nodeId: edge.to, attempt: edge.loop ? merged.cursor.attempt + 1 : 0, checkpointSeq: completed.seq }, updatedAt: this.options.nowIso() }
        await snapshots.save(state)
        await this.options.middleware.run('afterNode', this.middlewareContext(identity, state, 'afterNode', node))
      }
    } catch (error) {
      const outcome: RunOutcome = { status: 'failed', reason: 'runtime_error', retryable: true, details: { message: error instanceof Error ? error.message : String(error) } }
      const state = await snapshots.load(identity)
      if (state) await snapshots.save({ ...state, status: 'failed', outcome, updatedAt: this.options.nowIso() })
      return outcome
    } finally {
      await leases.release(identity.runId, holderId)
    }
  }

  private initialState(identity: RunIdentity): RunStateV3 {
    const now = this.options.nowIso()
    return { version: 3, graphVersion: this.options.graph.version, runtimeMode: 'kernel_v3', ...identity, status: 'created', cursor: { stepIndex: 0, nodeId: this.options.graph.startNodeId, attempt: 0, checkpointSeq: 0 }, budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, pendingEffects: [], committedEffects: [], createdAt: now, updatedAt: now }
  }

  private middlewareContext(identity: RunIdentity, state: RunStateV3, hook: 'beforeRun' | 'beforeNode' | 'afterNode' | 'afterRun', node?: RuntimeNode) {
    return { identity, state, node, hook, commands: [] as const }
  }

  private applyCommands(state: RunStateV3, commands: RuntimeNodeResult['commands']): RunStateV3 {
    let next = state
    for (const command of commands ?? []) {
      if (command.type === 'set-middleware-state') next = { ...next, middleware: { ...next.middleware, [command.id]: command.state } }
      if (command.type === 'set-budget') next = { ...next, budgets: { ...next.budgets, [command.key]: command.value } }
    }
    return next
  }

  private async recordEvent(identity: RunIdentity, state: RunStateV3, nodeId: string, eventType: string, payload: unknown): Promise<RunEventEnvelope> {
    const existing = await this.options.events.listAfter(identity, 0)
    const seq = (existing.reduce((max, event) => Math.max(max, event.seq), 0)) + 1
    return this.options.events.append({ eventId: randomUUID(), seq, ...identity, stepId: nodeId, nodeAttemptId: `${nodeId}:${state.cursor.attempt}`, eventType, payload, timestamp: this.options.nowIso() })
  }
}
