import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { SkillPluginHost } from '../plugin-host.js'
import { SkillsCapabilityConfig } from '../../contracts/capabilities.js'

// Builtin skills ship under <repo>/qiongqi/skills/. process.cwd() is the
// repo root when vitest runs, so resolve relative to that.
const BUILTIN_ROOT = resolve(process.cwd(), 'qiongqi/skills')

const EXPECTED_IDS = [
  'code-review',
  'debugging',
  'git-worktrees',
  'goal',
  'planning',
  'refactoring',
  'review',
  'security-review',
  'tdd',
  'todo',
  'web'
]

describe('builtin skills', () => {
  it('all builtin skills load and validate against v1 schema', async () => {
    const cfg = SkillsCapabilityConfig.parse({ enabled: true, roots: [] })
    const host = await SkillPluginHost.create(cfg, { builtinRoot: BUILTIN_ROOT })
    const ids = host.diagnostics().skills.map((s) => s.id).sort()
    const errors = host.diagnostics().validationErrors
    for (const id of EXPECTED_IDS) {
      expect(ids, `builtin skill ${id} should be discovered`).toContain(id)
    }
    expect(errors).toEqual([])
  })

  it('tdd is the full-capability reference skill (commands + declaration + contributes + permissions)', async () => {
    const cfg = SkillsCapabilityConfig.parse({ enabled: true, roots: [] })
    const host = await SkillPluginHost.create(cfg, { builtinRoot: BUILTIN_ROOT })
    const tdd = host.list().find((p) => p.id === 'tdd')
    expect(tdd, 'tdd skill must load').toBeDefined()
    expect(tdd!.manifest.commands.length).toBeGreaterThan(0)
    expect(tdd!.manifest.tools.declarations.map((d) => d.name)).toContain('run_tests')
    expect(tdd!.manifest.contributes.chatMenu.length).toBeGreaterThan(0)
    expect(tdd!.manifest.contributes.quickTask.length).toBeGreaterThan(0)
    expect(tdd!.manifest.permissions.exec).toBe('workspace')
    expect(tdd!.source).toBe('official')
  })

  it('no builtin skill is marked legacy', async () => {
    const cfg = SkillsCapabilityConfig.parse({ enabled: true, roots: [] })
    const host = await SkillPluginHost.create(cfg, { builtinRoot: BUILTIN_ROOT })
    for (const skill of host.diagnostics().skills) {
      expect(skill.legacy, `${skill.id} should not be legacy`).toBe(false)
    }
  })
})
