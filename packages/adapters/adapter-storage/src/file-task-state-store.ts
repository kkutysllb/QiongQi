import { randomUUID } from 'node:crypto'
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { TaskStateV1Schema, type RunIdentity, type TaskStateV1 } from '@qiongqi/contracts'
import type {
  TaskStateMigrationRecord,
  TaskStatePreparedRevision,
  TaskStateStore
} from '@qiongqi/ports'
import { atomicWriteFile } from './atomic-write.js'
import { runtimeScopeDigest } from './runtime-store-utils.js'

type ActivePointer = { revision: number; token: string }
type PreparedPayload = { prepared: TaskStatePreparedRevision; state: TaskStateV1 }

const LOCK_ATTEMPTS = 100
const LOCK_DELAY_MS = 10
const LOCK_STALE_MS = 10_000

export class FileTaskStateStore implements TaskStateStore {
  public readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir)
  }

  async load(identity: RunIdentity): Promise<TaskStateV1 | undefined> {
    return this.loadByScopeDigest(runtimeScopeDigest(identity))
  }

  async prepare(state: TaskStateV1, expectedRevision: number): Promise<TaskStatePreparedRevision> {
    const parsed = TaskStateV1Schema.parse(state)
    const scopeDigest = runtimeScopeDigest(parsed.identity)
    const activeRevision = (await this.readActive(scopeDigest))?.revision ?? 0
    if (activeRevision !== expectedRevision || parsed.revision !== expectedRevision + 1) {
      throw revisionConflict(expectedRevision, activeRevision, parsed.revision)
    }
    const prepared: TaskStatePreparedRevision = {
      identity: parsed.identity,
      revision: parsed.revision,
      expectedRevision,
      token: randomUUID(),
      scopeDigest
    }
    const payload: PreparedPayload = { prepared, state: parsed }
    await atomicWriteFile(this.revisionPath(prepared), JSON.stringify(payload, null, 2))
    return prepared
  }

  async commit(prepared: TaskStatePreparedRevision): Promise<void> {
    this.assertPreparedIdentity(prepared)
    const release = await this.acquireScopeLock(prepared.scopeDigest)
    try {
      const payload = await this.readPrepared(prepared)
      const activeRevision = (await this.readActive(prepared.scopeDigest))?.revision ?? 0
      if (activeRevision !== prepared.expectedRevision) {
        throw revisionConflict(prepared.expectedRevision, activeRevision, prepared.revision)
      }
      if (payload.state.revision !== prepared.revision) {
        throw new Error('prepared task revision payload mismatch')
      }
      await atomicWriteFile(
        this.activePath(prepared.scopeDigest),
        JSON.stringify({ revision: prepared.revision, token: prepared.token })
      )
    } finally {
      await release()
    }
  }

  async abort(prepared: TaskStatePreparedRevision): Promise<void> {
    this.assertPreparedIdentity(prepared)
    await rm(this.revisionPath(prepared), { force: true })
  }

  async listForThread(
    scope: Pick<RunIdentity, 'ownerUserId' | 'workspaceKey' | 'threadId'>
  ): Promise<TaskStateV1[]> {
    let directories: string[]
    try {
      directories = await readdir(this.taskRoot())
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return []
      throw error
    }
    const states = await Promise.all(directories.map((digest) => this.loadByScopeDigest(digest)))
    return states.filter((state): state is TaskStateV1 => Boolean(
      state &&
      state.identity.ownerUserId === scope.ownerUserId &&
      state.identity.workspaceKey === scope.workspaceKey &&
      state.identity.threadId === scope.threadId
    ))
  }

  async appendMigrationRecord(record: TaskStateMigrationRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    await appendFile(this.migrationsPath(), `${JSON.stringify(record)}\n`, 'utf8')
  }

  private async loadByScopeDigest(scopeDigest: string): Promise<TaskStateV1 | undefined> {
    const active = await this.readActive(scopeDigest)
    if (!active) return undefined
    const prepared: TaskStatePreparedRevision = {
      identity: {
        ownerUserId: 'unresolved',
        workspaceKey: 'unresolved',
        threadId: 'unresolved',
        turnId: 'unresolved',
        runId: 'unresolved'
      },
      expectedRevision: active.revision - 1,
      revision: active.revision,
      token: active.token,
      scopeDigest
    }
    try {
      const raw = await readFile(this.revisionPath(prepared), 'utf8')
      const value = JSON.parse(raw) as { state?: unknown }
      const state = TaskStateV1Schema.parse(value.state)
      if (runtimeScopeDigest(state.identity) !== scopeDigest) {
        throw new Error('task state identity does not match storage scope')
      }
      return state
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async readPrepared(prepared: TaskStatePreparedRevision): Promise<PreparedPayload> {
    try {
      const raw = await readFile(this.revisionPath(prepared), 'utf8')
      const value = JSON.parse(raw) as { prepared?: TaskStatePreparedRevision; state?: unknown }
      const state = TaskStateV1Schema.parse(value.state)
      if (
        value.prepared?.token !== prepared.token ||
        value.prepared.revision !== prepared.revision ||
        runtimeScopeDigest(state.identity) !== prepared.scopeDigest
      ) {
        throw new Error('prepared task revision payload mismatch')
      }
      return { prepared: value.prepared, state }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        throw new Error('prepared task revision not found')
      }
      throw error
    }
  }

  private async readActive(scopeDigest: string): Promise<ActivePointer | undefined> {
    try {
      const value = JSON.parse(await readFile(this.activePath(scopeDigest), 'utf8')) as Partial<ActivePointer>
      if (!Number.isInteger(value.revision) || (value.revision ?? 0) <= 0 || typeof value.token !== 'string' || !value.token) {
        throw new Error('invalid task state active pointer')
      }
      return { revision: value.revision!, token: value.token }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined
      throw error
    }
  }

  private assertPreparedIdentity(prepared: TaskStatePreparedRevision): void {
    if (runtimeScopeDigest(prepared.identity) !== prepared.scopeDigest) {
      throw new Error('prepared task revision identity mismatch')
    }
  }

  private async acquireScopeLock(scopeDigest: string): Promise<() => Promise<void>> {
    const lockPath = join(this.scopeDir(scopeDigest), 'commit.lock')
    await mkdir(this.scopeDir(scopeDigest), { recursive: true })
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
      try {
        const handle = await open(lockPath, 'wx')
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }))
        await handle.close()
        return async () => {
          await rm(lockPath, { force: true })
        }
      } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error
        const info = await stat(lockPath).catch(() => undefined)
        if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true }).catch(() => undefined)
          continue
        }
        await delay(LOCK_DELAY_MS)
      }
    }
    throw new Error('task state commit lock unavailable')
  }

  private taskRoot(): string {
    return join(this.rootDir, 'task-state')
  }

  private scopeDir(scopeDigest: string): string {
    return join(this.taskRoot(), scopeDigest)
  }

  private activePath(scopeDigest: string): string {
    return join(this.scopeDir(scopeDigest), 'active.json')
  }

  private revisionPath(prepared: Pick<TaskStatePreparedRevision, 'scopeDigest' | 'revision' | 'token'>): string {
    return join(
      this.scopeDir(prepared.scopeDigest),
      'revisions',
      `${prepared.revision}-${prepared.token}.json`
    )
  }

  private migrationsPath(): string {
    return join(this.rootDir, 'task-migrations.jsonl')
  }
}

function revisionConflict(expected: number, active: number, next: number): Error {
  return new Error(`task revision conflict: expected active ${expected}, found ${active}, next ${next}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
