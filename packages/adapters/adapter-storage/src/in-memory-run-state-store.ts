import { RunStateV3Schema, encodeScopeKey, type RunIdentity, type RunStateV3 } from '@qiongqi/contracts'
import type { RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'

type Lease = { holderId: string; expiresAt: number }

function stateKey(state: RunStateV3): string {
  return encodeScopeKey({
    ownerUserId: state.ownerUserId,
    workspaceKey: state.workspaceKey,
    threadId: state.threadId,
    turnId: state.turnId,
    runId: state.runId,
    purpose: 'runtime'
  })
}

function identityKey(identity: RunIdentity): string {
  return encodeScopeKey({ ...identity, purpose: 'runtime' })
}

export class InMemoryRunStateStore implements RunSnapshotStore, RunLeaseStore {
  private readonly snapshots = new Map<string, RunStateV3>()
  private readonly leases = new Map<string, Lease>()

  async save(state: RunStateV3): Promise<void> {
    const parsed = RunStateV3Schema.parse(state)
    this.snapshots.set(stateKey(parsed), structuredClone(parsed))
  }

  async load(identity: RunIdentity): Promise<RunStateV3 | undefined> {
    const state = this.snapshots.get(identityKey(identity))
    return state ? structuredClone(state) : undefined
  }

  async acquire(identity: RunIdentity, holderId: string, ttlMs: number): Promise<{ acquired: boolean; expiresAt?: string }> {
    const leaseKey = identityKey(identity)
    const now = Date.now()
    const current = this.leases.get(leaseKey)
    if (current && current.expiresAt > now && current.holderId !== holderId) return { acquired: false }
    const expiresAt = now + Math.max(1, Math.floor(ttlMs))
    this.leases.set(leaseKey, { holderId, expiresAt })
    return { acquired: true, expiresAt: new Date(expiresAt).toISOString() }
  }

  async renew(identity: RunIdentity, holderId: string, ttlMs: number): Promise<boolean> {
    const current = this.leases.get(identityKey(identity))
    if (!current || current.holderId !== holderId || current.expiresAt <= Date.now()) return false
    current.expiresAt = Date.now() + Math.max(1, Math.floor(ttlMs))
    return true
  }

  async release(identity: RunIdentity, holderId: string): Promise<void> {
    const key = identityKey(identity)
    const current = this.leases.get(key)
    if (current?.holderId === holderId) this.leases.delete(key)
  }
}
