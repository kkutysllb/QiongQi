import { createHash } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { MailboxMessageSchema, MultiAgentRunSchema, type MailboxMessage, type MultiAgentRun } from '@qiongqi/contracts'
import type { MailboxStore, MultiAgentRunStore } from '@qiongqi/ports'
import { atomicWriteFile } from './atomic-write.js'
import { withFileLock } from './file-lock.js'

function safeSegment(value: string, label: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed !== value ||
    value.includes('/') ||
    value.includes('\\') ||
    basename(value) !== value
  ) {
    throw new Error(`Invalid ${label} path segment`)
  }
  return value
}

function isNoEntry(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'ENOENT'
}

async function readDirIfExists(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (isNoEntry(error)) return []
    throw error
  }
}

async function readRunFile(path: string): Promise<MultiAgentRun> {
  return MultiAgentRunSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

async function readMessageFile(path: string): Promise<MailboxMessage> {
  return MailboxMessageSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

export class FileMultiAgentRunStore implements MultiAgentRunStore {
  constructor(readonly rootDir: string) {}

  async save(run: MultiAgentRun): Promise<void> {
    const parsed = MultiAgentRunSchema.parse(run)
    const threadId = safeSegment(parsed.threadId, 'threadId')
    const runId = safeSegment(parsed.runId, 'runId')
    const existingFiles = await this.findRunFiles(runId)
    await Promise.all(existingFiles
      .filter((existing) => existing.threadId !== threadId)
      .map((existing) => rm(existing.path, { force: true })))
    const dir = join(this.rootDir, 'multi-agent-runs', threadId)
    await atomicWriteFile(join(dir, `${runId}.json`), JSON.stringify(parsed, null, 2))
  }

  async load(runId: string): Promise<MultiAgentRun | undefined> {
    const safeRunId = safeSegment(runId, 'runId')
    return (await this.findRunFiles(safeRunId))[0]?.run
  }

  async listByThread(threadId: string): Promise<MultiAgentRun[]> {
    const safeThreadId = safeSegment(threadId, 'threadId')
    const dir = join(this.rootDir, 'multi-agent-runs', safeThreadId)
    const entries = await readDirIfExists(dir)
    const runs = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readRunFile(join(dir, safeSegment(entry, 'run file')))))
    return runs
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async delete(runId: string): Promise<void> {
    const safeRunId = safeSegment(runId, 'runId')
    const existingFiles = await this.findRunFiles(safeRunId)
    await Promise.all(existingFiles.map((existing) => rm(existing.path, { force: true })))
  }

  private async findRunFiles(runId: string): Promise<Array<{ path: string, run: MultiAgentRun, threadId: string }>> {
    const safeRunId = safeSegment(runId, 'runId')
    const root = join(this.rootDir, 'multi-agent-runs')
    const threadDirs = await readDirIfExists(root)
    const runs: Array<{ path: string, run: MultiAgentRun, threadId: string }> = []
    for (const threadDir of threadDirs) {
      const threadId = safeSegment(threadDir, 'threadId')
      const path = join(root, threadId, `${safeRunId}.json`)
      try {
        runs.push({ path, run: await readRunFile(path), threadId })
      } catch (error) {
        if (isNoEntry(error)) continue
        throw error
      }
    }
    return runs
  }
}

export class FileMailboxStore implements MailboxStore {
  constructor(readonly rootDir: string) {}

  async enqueue(message: MailboxMessage): Promise<void> {
    const parsed = MailboxMessageSchema.parse(message)
    await this.write(parsed)
  }

  async claimNext(agentId: string): Promise<MailboxMessage | undefined> {
    return withFileLock(this.claimLockPath(agentId), async () => {
      const all = await this.listAll()
      const queued = all
        .filter((message) => message.toAgentId === agentId && message.status === 'queued')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      if (!queued) return undefined
      const delivered = MailboxMessageSchema.parse({ ...queued, status: 'delivered', updatedAt: new Date().toISOString() })
      await this.write(delivered)
      return delivered
    })
  }

  async complete(messageId: string): Promise<void> {
    safeSegment(messageId, 'messageId')
    const all = await this.listAll()
    const current = all.find((message) => message.messageId === messageId)
    if (!current) return
    await this.write(MailboxMessageSchema.parse({ ...current, status: 'completed', updatedAt: new Date().toISOString() }))
  }

  async listForRun(runId: string): Promise<MailboxMessage[]> {
    return (await this.listAll())
      .filter((message) => message.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  private async write(message: MailboxMessage): Promise<void> {
    const runId = safeSegment(message.runId, 'runId')
    const messageId = safeSegment(message.messageId, 'messageId')
    const dir = join(this.rootDir, 'mailbox', runId)
    await atomicWriteFile(join(dir, `${messageId}.json`), JSON.stringify(message, null, 2))
  }

  private async listAll(): Promise<MailboxMessage[]> {
    const mailboxRoot = join(this.rootDir, 'mailbox')
    const runDirs = await readDirIfExists(mailboxRoot)
    const all: MailboxMessage[] = []
    for (const runId of runDirs) {
      const safeRunId = safeSegment(runId, 'runId')
      const entries = await readDirIfExists(join(mailboxRoot, safeRunId))
      const messages = await Promise.all(entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readMessageFile(join(mailboxRoot, safeRunId, safeSegment(entry, 'message file')))))
      all.push(...messages)
    }
    return all
  }

  private claimLockPath(agentId: string): string {
    const digest = createHash('sha256').update(agentId).digest('hex')
    return join(this.rootDir, 'mailbox-claims', `${digest}.json`)
  }
}
