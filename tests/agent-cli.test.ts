import { describe, expect, it } from 'vitest'
import { QIONGQI_CLI_USAGE, runAgentCommand, splitQiongqiCliCommand } from '@qiongqi/cli'
import { ServeExitCode } from '@qiongqi/cli'
import type { ServerRuntime } from '@qiongqi/http'

describe('Qiongqi agent CLI text', () => {
  it('uses qiongqi naming in the top-level usage text', () => {
    expect(QIONGQI_CLI_USAGE).toContain('qiongqi <command> [options]')
    expect(QIONGQI_CLI_USAGE).not.toContain('kun <command>')
  })

  it('uses qiongqi naming in command errors', async () => {
    let stderr = ''

    const code = await runAgentCommand('run', ['--data-dir', '/tmp/qiongqi-data', '--api-key', 'test-key', '--base-url', 'https://example.invalid/v1'], {
      stdout: { write: () => undefined },
      stderr: { write: (chunk) => { stderr += chunk } },
      env: {},
      cwd: () => '/tmp/workspace'
    })

    expect(code).toBe(64)
    expect(stderr).toContain('qiongqi run: missing prompt')
    expect(stderr).not.toContain('kun run')
  })

  it('recognizes the evented_v2 worker command', () => {
    expect(splitQiongqiCliCommand(['worker', '--once'])).toEqual({
      command: 'worker',
      args: ['--once']
    })
  })

  it('runs an evented_v2 worker flush once without starting the HTTP server', async () => {
    let stdout = ''
    let outboxFlushes = 0
    let remoteFlushes = 0
    let shutdowns = 0
    const runtime = {
      multiAgentOutboxReconciler: {
        flushOnce: async () => {
          outboxFlushes += 1
          return { runIds: ['mar_1'], runsFlushed: 1, startedAt: '2026-07-21T00:00:00.000Z', finishedAt: '2026-07-21T00:00:00.001Z' }
        },
        start: () => undefined,
        stop: () => undefined,
        isRunning: () => false
      },
      multiAgentRemoteScheduler: {
        flushOnce: async () => {
          remoteFlushes += 1
          return { agentIds: ['researcher'], agentsChecked: 1, messagesProcessed: 1, messageIds: ['msg_1'], startedAt: '2026-07-21T00:00:00.000Z', finishedAt: '2026-07-21T00:00:00.001Z' }
        },
        start: () => undefined,
        stop: () => undefined,
        isRunning: () => false,
        snapshot: () => ({ workerId: 'worker_a', status: 'stopped', health: 'ok', agentIds: ['researcher'] })
      },
      shutdown: async () => {
        shutdowns += 1
      }
    } as unknown as ServerRuntime

    const code = await runAgentCommand('worker' as never, [
      '--once',
      '--json',
      '--data-dir', '/tmp/qiongqi-data',
      '--api-key', 'test-key',
      '--base-url', 'https://example.invalid/v1'
    ], {
      stdout: { write: (chunk) => { stdout += chunk } },
      stderr: { write: () => undefined },
      env: {},
      cwd: () => '/tmp/workspace',
      createRuntime: async () => runtime
    })

    expect(code).toBe(ServeExitCode.ok)
    expect(outboxFlushes).toBe(1)
    expect(remoteFlushes).toBe(1)
    expect(shutdowns).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({
      mode: 'worker',
      outbox: { runsFlushed: 1 },
      remote: { messagesProcessed: 1 }
    })
  })
})
