import type { MailboxMessage, MultiAgentRun } from '@qiongqi/contracts'

export interface MultiAgentRunStore {
  save(run: MultiAgentRun): Promise<void>
  load(runId: string): Promise<MultiAgentRun | undefined>
  update(runId: string, mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>): Promise<MultiAgentRun>
  listByThread(threadId: string): Promise<MultiAgentRun[]>
  delete(runId: string): Promise<void>
}

export interface MailboxStore {
  enqueue(message: MailboxMessage): Promise<void>
  claimNext(agentId: string): Promise<MailboxMessage | undefined>
  complete(messageId: string): Promise<void>
  listForRun(runId: string): Promise<MailboxMessage[]>
}
