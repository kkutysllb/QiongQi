import type { MailboxMessage, MultiAgentRun } from '@qiongqi/contracts'
import type { LeaseFence } from './runtime-kernel.js'

export type MultiAgentRunUpdateOptions = {
  fence?: LeaseFence
  expectedVersion?: number
}

export interface MultiAgentRunStore {
  save(run: MultiAgentRun): Promise<void>
  load(runId: string): Promise<MultiAgentRun | undefined>
  update(
    runId: string,
    mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>,
    options?: MultiAgentRunUpdateOptions
  ): Promise<MultiAgentRun>
  loadVersion?(runId: string): Promise<number | undefined>
  acquireLease?(runId: string, holderId: string, ttlMs: number): Promise<{
    acquired: boolean
    expiresAt?: string
    fence?: LeaseFence
  }>
  renewLease?(runId: string, holderId: string, fenceOrTtl: LeaseFence | number, ttlMs?: number): Promise<boolean>
  releaseLease?(runId: string, holderId: string, fence?: LeaseFence): Promise<void>
  listWithPendingOutbox(): Promise<MultiAgentRun[]>
  listByThread(threadId: string): Promise<MultiAgentRun[]>
  delete(runId: string): Promise<void>
}

export interface MailboxStore {
  enqueue(message: MailboxMessage): Promise<void>
  claimNext(agentId: string): Promise<MailboxMessage | undefined>
  complete(messageId: string): Promise<void>
  listForRun(runId: string): Promise<MailboxMessage[]>
}
