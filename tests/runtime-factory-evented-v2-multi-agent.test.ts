import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQiongqiServeRuntime } from '@qiongqi/http'

type RuntimeOptions = Parameters<typeof createQiongqiServeRuntime>[0]

async function withRuntime(
  orchestrationMode: RuntimeOptions['orchestrationMode'],
  assertion: (runtime: Awaited<ReturnType<typeof createQiongqiServeRuntime>>) => void
) {
  const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-runtime-evented-v2-'))
  let runtime: Awaited<ReturnType<typeof createQiongqiServeRuntime>> | undefined
  try {
    runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      ...(orchestrationMode ? { orchestrationMode } : {})
    })

    assertion(runtime)
  } finally {
    await runtime?.shutdown?.()
    await rm(dataDir, { recursive: true, force: true })
  }
}

describe('runtime factory evented_v2 multi-agent wiring', () => {
  it('attaches multiAgentRuntime only for evented_v2', async () => {
    await withRuntime('evented_v2', (runtime) => {
      expect(runtime.multiAgentRuntime).toBeDefined()
    })

    await withRuntime(undefined, (runtime) => {
      expect(runtime.multiAgentRuntime).toBeUndefined()
    })

    await withRuntime('classic', (runtime) => {
      expect(runtime.multiAgentRuntime).toBeUndefined()
    })
  })
})
