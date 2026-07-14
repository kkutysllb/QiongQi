import type { RunEventEnvelope, RunIdentity, RunStateV3 } from '@qiongqi/contracts'

export interface RunEventStore {
  append(event: RunEventEnvelope): Promise<RunEventEnvelope>
  listAfter(identity: RunIdentity, seq: number): Promise<RunEventEnvelope[]>
}
export interface RunSnapshotStore {
  save(state: RunStateV3): Promise<void>
  load(identity: RunIdentity): Promise<RunStateV3 | undefined>
}
export interface RunLeaseStore {
  acquire(runId: string, holderId: string, ttlMs: number): Promise<{ acquired: boolean; expiresAt?: string }>
  renew(runId: string, holderId: string, ttlMs: number): Promise<boolean>
  release(runId: string, holderId: string): Promise<void>
}
