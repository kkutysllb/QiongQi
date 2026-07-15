import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RunStateV3Schema, type RunIdentity, type RunStateV3 } from '@qiongqi/contracts'
import type { RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'
import { atomicWriteFile } from './atomic-write.js'
import { runtimeScopeDigest } from './runtime-store-utils.js'

type Lease = { holderId: string; expiresAt: string }

export class FileRunStateStore implements RunSnapshotStore, RunLeaseStore {
  public readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir)
  }

  async save(state: RunStateV3): Promise<void> {
    const parsed = RunStateV3Schema.parse(state)
    await atomicWriteFile(this.snapshotPath(parsed), JSON.stringify(parsed, null, 2))
  }

  async load(identity: RunIdentity): Promise<RunStateV3 | undefined> {
    try {
      const raw = await readFile(this.snapshotPath(identity), 'utf8')
      return RunStateV3Schema.parse(JSON.parse(raw))
    } catch {
      return undefined
    }
  }

  async writeRawSnapshot(identity: RunIdentity, contents: string): Promise<void> {
    await mkdir(this.runDir(identity), { recursive: true })
    await writeFile(this.snapshotPath(identity), contents, 'utf8')
  }

  async acquire(identity: RunIdentity, holderId: string, ttlMs: number): Promise<{ acquired: boolean; expiresAt?: string }> {
    const path = this.leasePath(identity)
    const current = await this.readLease(path)
    const now = Date.now()
    if (current && Date.parse(current.expiresAt) > now && current.holderId !== holderId) return { acquired: false }
    const expiresAt = new Date(now + Math.max(1, Math.floor(ttlMs))).toISOString()
    await atomicWriteFile(path, JSON.stringify({ holderId, expiresAt }))
    return { acquired: true, expiresAt }
  }

  async renew(identity: RunIdentity, holderId: string, ttlMs: number): Promise<boolean> {
    const path = this.leasePath(identity)
    const current = await this.readLease(path)
    if (!current || current.holderId !== holderId || Date.parse(current.expiresAt) <= Date.now()) return false
    const expiresAt = new Date(Date.now() + Math.max(1, Math.floor(ttlMs))).toISOString()
    await atomicWriteFile(path, JSON.stringify({ holderId, expiresAt }))
    return true
  }

  async release(identity: RunIdentity, holderId: string): Promise<void> {
    const path = this.leasePath(identity)
    const current = await this.readLease(path)
    if (current?.holderId === holderId) await rm(path, { force: true })
  }

  private runDir(identity: RunIdentity): string {
    return join(this.rootDir, 'snapshots', runtimeScopeDigest(identity))
  }

  private snapshotPath(identity: RunIdentity): string {
    return join(this.runDir(identity), 'snapshot.json')
  }

  private leasePath(identity: RunIdentity): string {
    return join(this.rootDir, 'leases', `${runtimeScopeDigest(identity)}.json`)
  }

  private async readLease(path: string): Promise<Lease | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Lease
    } catch {
      return undefined
    }
  }
}
