import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'

export async function listSkills(runtime: ServerRuntime): Promise<JsonResponse> {
  const diagnostics = runtime.skills
    ? await runtime.skills()
    : {
        enabled: false,
        roots: [],
        skills: [],
        validationErrors: [],
        lastActivations: []
      }
  // v1 plugin diagnostics carry per-skill commands/contributions/permissions.
  // When available, merge those enriched fields onto each skill entry so the
  // renderer can render plugin-declared UI and slash commands. Falls back to
  // the legacy diagnostics shape when the plugin host is absent.
  const v2 = runtime.skillsV2 ? await runtime.skillsV2() : null
  const enrichedSkills = v2
    ? diagnostics.skills.map((skill) => {
        const plugin = v2.skills.find((p) => p.id === skill.id)
        return plugin
          ? {
              ...skill,
              commands: plugin.commands,
              contributions: plugin.contributions,
              permissions: plugin.permissions,
              category: plugin.category,
              source: plugin.source
            }
          : skill
      })
    : diagnostics.skills
  return jsonResponse({
    enabled: diagnostics.enabled,
    roots: diagnostics.roots,
    skills: enrichedSkills,
    validationErrors: diagnostics.validationErrors,
    lastActivations: diagnostics.lastActivations ?? []
  })
}

