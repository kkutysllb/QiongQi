import { expect, it } from 'vitest'
import { normalizeOrchestrationMode } from '@qiongqi/loop'
import { orchestrationModeForRuntimeOptions } from '@qiongqi/http'

it('keeps classic default and maps legacy evented to evented_v2', () => {
  expect(normalizeOrchestrationMode(undefined)).toBe('classic')
  expect(normalizeOrchestrationMode('evented')).toBe('evented_v2')
  expect(normalizeOrchestrationMode('kernel_v3')).toBe('kernel_v3')
})

it('drives production kernel rollout from runtime config while preserving classic fallback', () => {
  expect(orchestrationModeForRuntimeOptions({ runtime: { kernelRollout: { defaultMode: 'kernel_v3' } } })).toBe('classic')
  expect(orchestrationModeForRuntimeOptions({ runtime: { kernelRollout: { enabled: true, defaultMode: 'kernel_v3' } } })).toBe('kernel_v3')
  expect(orchestrationModeForRuntimeOptions({ orchestrationMode: 'kernel_v3' })).toBe('kernel_v3')
})
