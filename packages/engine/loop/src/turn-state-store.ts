import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { TurnStateV1, TurnStateSerializer } from './turn-event-types.js'

/**
 * File-based persistence of {@link TurnStateV1} for crash recovery.
 *
 * Stores each turn state at:
 * `<rootDir>/<threadId>/turns/<turnId>/state.json`
 */
export class FileTurnStateStore implements TurnStateSerializer {
  constructor(private readonly rootDir: string) {}

  async save(state: TurnStateV1): Promise<void> {
    const dir = this.stateDir(state.threadId, state.turnId)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'state.json'),
      JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    )
  }

  async load(threadId: string, turnId: string): Promise<TurnStateV1 | undefined> {
    try {
      const text = await readFile(
        join(this.stateDir(threadId, turnId), 'state.json'),
        'utf8'
      )
      return JSON.parse(text) as TurnStateV1
    } catch {
      return undefined
    }
  }

  async delete(threadId: string, turnId: string): Promise<void> {
    await rm(this.stateDir(threadId, turnId), { recursive: true, force: true })
  }

  async list(threadId: string): Promise<TurnStateV1[]> {
    const root = join(this.rootDir, threadId, 'turns')
    try {
      const entries = await readdir(root, { withFileTypes: true })
      const states: TurnStateV1[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const text = await readFile(join(root, entry.name, 'state.json'), 'utf8')
          states.push(JSON.parse(text) as TurnStateV1)
        } catch {
          // Skip corrupt states
        }
      }
      return states
    } catch {
      return []
    }
  }

  private stateDir(threadId: string, turnId: string): string {
    return join(this.rootDir, threadId, 'turns', turnId)
  }
}
