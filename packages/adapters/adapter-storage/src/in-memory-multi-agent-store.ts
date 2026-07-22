import { MailboxMessageSchema, MultiAgentRunSchema, type MailboxMessage, type MultiAgentRun } from '@qiongqi/contracts'
import type { MailboxStore, MultiAgentRunStore } from '@qiongqi/ports'

export class InMemoryMultiAgentRunStore implements MultiAgentRunStore {
  private readonly runs = new Map<string, MultiAgentRun>()
  private readonly runLocks = new Map<string, Promise<void>>()

  async save(run: MultiAgentRun): Promise<void> {
    const parsed = MultiAgentRunSchema.parse(run)
    this.runs.set(parsed.runId, parsed)
  }

  async load(runId: string): Promise<MultiAgentRun | undefined> {
    return this.runs.get(runId)
  }

  async update(runId: string, mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>): Promise<MultiAgentRun> {
    return this.withRunLock(runId, async () => {
      const current = this.runs.get(runId)
      if (!current) throw new Error(`MultiAgentRun not found: ${runId}`)
      const next = MultiAgentRunSchema.parse(await mutate(current))
      if (next.runId !== runId) throw new Error(`MultiAgentRun update cannot change runId: ${next.runId} !== ${runId}`)
      this.runs.set(runId, next)
      return next
    })
  }

  async listByThread(threadId: string): Promise<MultiAgentRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async delete(runId: string): Promise<void> {
    this.runs.delete(runId)
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
}

export class InMemoryMailboxStore implements MailboxStore {
  private readonly messages = new Map<string, MailboxMessage>()

  async enqueue(message: MailboxMessage): Promise<void> {
    const parsed = MailboxMessageSchema.parse(message)
    const existing = this.messages.get(parsed.messageId)
    if (existing) {
      this.messages.set(parsed.messageId, preserveMailboxProgress(existing, parsed))
      return
    }
    this.messages.set(parsed.messageId, parsed)
  }

  async claimNext(agentId: string): Promise<MailboxMessage | undefined> {
    const queued = [...this.messages.values()]
      .filter((message) => message.toAgentId === agentId && message.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (!queued) return undefined
    const delivered = MailboxMessageSchema.parse({ ...queued, status: 'delivered', updatedAt: new Date().toISOString() })
    this.messages.set(delivered.messageId, delivered)
    return delivered
  }

  async complete(messageId: string): Promise<void> {
    const current = this.messages.get(messageId)
    if (!current) return
    this.messages.set(messageId, MailboxMessageSchema.parse({ ...current, status: 'completed', updatedAt: new Date().toISOString() }))
  }

  async listForRun(runId: string): Promise<MailboxMessage[]> {
    return [...this.messages.values()]
      .filter((message) => message.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}

function preserveMailboxProgress(existing: MailboxMessage, incoming: MailboxMessage): MailboxMessage {
  if (mailboxStatusRank(existing.status) >= mailboxStatusRank(incoming.status)) return existing
  return incoming
}

function mailboxStatusRank(status: MailboxMessage['status']): number {
  return {
    queued: 0,
    delivered: 1,
    failed: 1,
    aborted: 1,
    completed: 2
  }[status]
}
