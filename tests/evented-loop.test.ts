import { describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EventedTurnOrchestrator,
  FileTurnStateStore,
  TurnEventBus,
  defaultLoopPlan,
  defaultLoopEvaluator
} from '@qiongqi/loop'
import { makeHarness, makeSilentModel, bootstrapThread } from './loop-test-harness.js'

function tempDir(): string {
  const r = Math.random().toString(36).slice(2)
  return join(tmpdir(), `qiongqi-evented-${r}`)
}

function makeEventedHarness(model = makeSilentModel()) {
  const base = makeHarness(model)
  const dir = tempDir()
  const serializer = new FileTurnStateStore(dir)
  const bus = new TurnEventBus()
  const loop = new EventedTurnOrchestrator(
    {
      threadStore: base.threadStore,
      sessionStore: base.sessionStore,
      approvalGate: base.approvalGate,
      userInputGate: base.userInputGate,
      model,
      toolHost: base.toolHost,
      usage: base.usage,
      events: base.events,
      turns: base.turns,
      inflight: base.inflight,
      steering: base.steering,
      compactor: base.compactor,
      prefix: base.prefix,
      ids: base.ids,
      nowIso: base.nowIso,
      nowMs: base.nowMs
    },
    serializer,
    bus,
    defaultLoopPlan(),
    defaultLoopEvaluator
  )
  return { base, loop, serializer, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

describe('EventedTurnOrchestrator (declarative loop)', () => {
  it('completes a simple turn via the LoopRunner', async () => {
    const h = makeEventedHarness()
    try {
      await bootstrapThread(h.base)
      const status = await h.loop.runTurn(h.base.threadId, h.base.turnId)
      expect(status).toBe('completed')
    } finally {
      await h.cleanup()
    }
  })

  it('deletes persisted state after completion', async () => {
    const h = makeEventedHarness()
    try {
      await bootstrapThread(h.base)
      await h.loop.runTurn(h.base.threadId, h.base.turnId)
      const leftover = await h.serializer.load(h.base.threadId, h.base.turnId)
      expect(leftover).toBeUndefined()
    } finally {
      await h.cleanup()
    }
  })
})
