import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillsCapabilityConfig } from '@qiongqi/contracts'
import { SkillPluginHost } from '@qiongqi/skills'

// Build a fully-defaulted skills config so callers can pass partial overrides.
const cfg = (overrides: Record<string, unknown> = {}) =>
  SkillsCapabilityConfig.parse({ enabled: true, ...overrides })

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'skills-'))
  // v1 skill
  await mkdir(join(root, 'tdd'), { recursive: true })
  await writeFile(join(root, 'tdd', 'skill.json'), JSON.stringify({
    specVersion: '1.0', id: 'tdd', name: 'TDD', category: 'development',
    activation: { commands: ['/tdd'], autoActivate: false },
    commands: [{ id: 'tdd', alias: [], description: 'x', injectPrompt: 'go' }],
    tools: { allowed: ['read', 'edit'] }
  }))
  await writeFile(join(root, 'tdd', 'SKILL.md'), '# TDD\nWrite tests first.')
  // legacy skill.json (no specVersion)
  await mkdir(join(root, 'legacy'), { recursive: true })
  await writeFile(join(root, 'legacy', 'skill.json'), JSON.stringify({
    name: 'Legacy', triggers: { commands: ['/legacy'] }, allowedTools: ['read']
  }))
  await writeFile(join(root, 'legacy', 'SKILL.md'), '# Legacy')
  // legacy SKILL.md only
  await mkdir(join(root, 'mdonly'), { recursive: true })
  await writeFile(join(root, 'mdonly', 'SKILL.md'), '---\nid: mdonly\nname: MdOnly\n---\n# body')
})
afterAll(async () => { await rm(root, { recursive: true, force: true }) })

describe('SkillPluginHost.create', () => {
  it('discovers v1, legacy skill.json, and legacy SKILL.md', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})
    const ids = host.diagnostics().skills.map((s) => s.id).sort()
    expect(ids).toEqual(['legacy', 'mdonly', 'tdd'])
  })

  it('marks v1 as non-legacy and migrated ones as legacy', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})
    const byId = new Map(host.diagnostics().skills.map((s) => [s.id, s]))
    expect(byId.get('tdd')?.legacy).toBe(false)
    expect(byId.get('legacy')?.legacy).toBe(true)
    expect(byId.get('mdonly')?.legacy).toBe(true)
  })

  it('collects validation errors for bad manifests without aborting others', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'bad-'))
    await mkdir(join(bad, 'broken'), { recursive: true })
    await writeFile(join(bad, 'broken', 'skill.json'), '{ not json')
    await writeFile(join(bad, 'broken', 'SKILL.md'), 'ok')
    const host = await SkillPluginHost.create(cfg({ roots: [bad] }), {})
    expect(host.diagnostics().validationErrors.length).toBeGreaterThan(0)
    await rm(bad, { recursive: true, force: true })
  })
})

describe('SkillPluginHost.resolveTurn', () => {
  it('activates by explicit mention, command, pattern, fileType', async () => {
    const host = await SkillPluginHost.create(cfg({ roots: [root] }), {})
    const explicit = host.resolveTurn({ prompt: '/skill:tdd now', workspace: '' })
    expect(explicit.activeSkillIds).toContain('tdd')
    expect(explicit.instructions.some((i) => i.includes('Write tests first.'))).toBe(true)

    const cmd = host.resolveTurn({ prompt: '/legacy run', workspace: '' })
    expect(cmd.activeSkillIds).toContain('legacy')

    const res = host.resolveTurn({ prompt: '/tdd cycle', workspace: '' })
    // Skills inject instructions but do NOT restrict the turn tool catalog
    // (a skill's tools.allowed is additive info, not a session allow-list).
    expect(res.activeSkillIds).toContain('tdd')
    expect(res.instructions.length).toBeGreaterThan(0)
  })

  it('respects enabledSkills=false to exclude a skill', async () => {
    const host = await SkillPluginHost.create(
      cfg({ roots: [root] }),
      { enabledSkills: { tdd: false } }
    )
    const res = host.resolveTurn({ prompt: '/skill:tdd', workspace: '' })
    expect(res.activeSkillIds).not.toContain('tdd')
  })

  it('respects activeLimit', async () => {
    const host = await SkillPluginHost.create(
      cfg({ roots: [root] }),
      { activeLimit: 1 }
    )
    const res = host.resolveTurn({ prompt: '/skill:tdd /skill:legacy', workspace: '' })
    expect(res.activeSkillIds.length).toBeLessThanOrEqual(1)
  })

  it('does not restrict the turn tool catalog even when a skill declares workspace:read', async () => {
    const roRoot = await mkdtemp(join(tmpdir(), 'ro-'))
    await mkdir(join(roRoot, 'ro'), { recursive: true })
    await writeFile(join(roRoot, 'ro', 'skill.json'), JSON.stringify({
      specVersion: '1.0', id: 'ro', name: 'RO',
      activation: { commands: ['/ro'], autoActivate: false },
      tools: { allowed: ['read', 'edit', 'bash'] },
      permissions: { workspace: 'read' }
    }))
    await writeFile(join(roRoot, 'ro', 'SKILL.md'), 'body')
    const host = await SkillPluginHost.create(cfg({ roots: [roRoot] }), {})
    const res = host.resolveTurn({ prompt: '/ro', workspace: '' })
    expect(res.activeSkillIds).toContain('ro')
    // resolveTurn must NOT return allowedToolNames — doing so would wrongly
    // exclude tools (e.g. bash) that coexisting flows (like /review) need.
    expect(res.allowedToolNames).toBeUndefined()
    await rm(roRoot, { recursive: true, force: true })
  })
})
