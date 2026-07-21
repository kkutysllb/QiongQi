import { MailboxMessageSchema, MultiAgentRunSchema, type MailboxMessage, type MultiAgentRun } from '@qiongqi/contracts'
import type { MailboxStore, MultiAgentRunStore } from '@qiongqi/ports'

export class InMemoryMultiAgentRunStore implements MultiAgentRunStore {
  private readonly runs = new Map<string, MultiAgentRun>()

  async save(run: MultiAgentRun): Promise<void> {
    const parsed = MultiAgentRunSchema.parse(run)
    this.runs.set(parsed.runId, parsed)
  }

  async load(runId: string): Promise<MultiAgentRun | undefined> {
    return this.runs.get(runId)
  }

  async listByThread(threadId: string): Promise<MultiAgentRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async delete(runId: string): Promise<void> {
    this.runs.delete(runId)
  }
}

export class InMemoryMailboxStore implements MailboxStore {
  private readonly messages = new Map<string, MailboxMessage>()

  async enqueue(message: MailboxMessage): Promise<void> {
    const parsed = MailboxMessageSchema.parse(message)
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
