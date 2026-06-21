import { describe, expect, it } from 'vitest'
import { qiongqiRuntimeListeningMessage, SERVE_USAGE } from '@qiongqi/cli'

describe('Qiongqi serve CLI text', () => {
  it('uses qiongqi naming in user-visible serve usage', () => {
    expect(SERVE_USAGE).toContain('qiongqi serve [options]')
    expect(SERVE_USAGE).not.toContain('kun serve')
  })

  it('uses qiongqi naming in the runtime ready message', () => {
    expect(qiongqiRuntimeListeningMessage('127.0.0.1', 8899)).toBe(
      'qiongqi runtime listening on http://127.0.0.1:8899'
    )
  })
})
