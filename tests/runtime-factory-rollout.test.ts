import { expect, it } from 'vitest'
import { normalizeOrchestrationMode } from '@qiongqi/loop'

it('keeps classic default and maps legacy evented to evented_v2', () => {
  expect(normalizeOrchestrationMode(undefined)).toBe('classic')
  expect(normalizeOrchestrationMode('evented')).toBe('evented_v2')
  expect(normalizeOrchestrationMode('kernel_v3')).toBe('kernel_v3')
})
