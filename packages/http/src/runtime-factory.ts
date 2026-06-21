import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildRouter } from './routes/index.js'
import type { ServerRuntime } from './routes/server-runtime.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from './node-http-server.js'
import { FileAttachmentStore } from '@qiongqi/attachments'
import { InMemoryApprovalGate } from '@qiongqi/adapter-storage'
import { InMemoryUserInputGate } from '@qiongqi/adapter-storage'
import { InMemoryEventBus } from '@qiongqi/adapter-storage'
import { FileSessionStore, FileThreadStore } from '@qiongqi/adapter-storage'
import { HybridSessionStore, HybridThreadStore } from '@qiongqi/adapter-storage'
import { DeepseekCompatModelClient } from '@qiongqi/adapter-model'
import { CapabilityRegistry } from '@qiongqi/adapter-tools'
import { buildGoalLocalTools } from '@qiongqi/adapter-tools'
import { buildTodoLocalTools } from '@qiongqi/adapter-tools'
import { LocalToolHost, buildDefaultLocalTools } from '@qiongqi/adapter-tools'
import { buildMcpToolProviders } from '@qiongqi/adapter-tools'
import { buildMemoryToolProviders } from '@qiongqi/adapter-tools'
import { buildDelegationToolProviders } from '@qiongqi/adapter-tools'
import { buildWebToolProviders } from '@qiongqi/adapter-tools'
import { LocalWorkspaceInspector } from '@qiongqi/adapter-storage'
import { createImmutablePrefix } from '@qiongqi/cache'
import {
  buildRuntimeCapabilityManifest,
  type QiongqiCapabilitiesConfig
} from '@qiongqi/contracts'
import type { ApprovalPolicy, SandboxMode } from '@qiongqi/contracts'
import { TurnOrchestrator } from '@qiongqi/loop'
import { ContextCompactor } from '@qiongqi/loop'
import type { TokenEconomyConfig } from '@qiongqi/loop'
import {
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig,
  type ContextCompactionConfig,
  type ModelConfig
} from '@qiongqi/loop'
import {
  DEFAULT_STORAGE_CONFIG,
  expandHomePath,
  type RuntimeTuningConfig,
  type StorageConfig
} from '@qiongqi/contracts'
import { InflightTracker } from '@qiongqi/loop'
import { SteeringQueue } from '@qiongqi/loop'
import { RandomIdGenerator } from '@qiongqi/ports'
import type { SessionStore } from '@qiongqi/ports'
import type { ThreadStore } from '@qiongqi/ports'
import { QIONGQI_SYSTEM_PROMPT } from '@qiongqi/contracts'
import { RuntimeEventRecorder } from '@qiongqi/services'
import { ThreadService } from '@qiongqi/services'
import { TurnService } from '@qiongqi/services'
import { ReviewService } from './review-service.js'
import { UsageService } from '@qiongqi/services'
import type { UsageEvent } from '@qiongqi/contracts'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  type ModelEndpointFormat
} from '@qiongqi/contracts'
import { SkillRuntime } from '@qiongqi/skills'
import { SkillPluginHost } from '@qiongqi/skills'
import { buildSkillToolProvider, type SkillToolExecutor } from '@qiongqi/skills'
import { createBashLocalTool } from '@qiongqi/adapter-tools'
import { collectSkillMcpServers } from '@qiongqi/skills'
import { FileMemoryStore } from '@qiongqi/memory'
import { DelegationRuntime, FileDelegationStore } from '@qiongqi/delegation'
import { createChildAgentExecutor } from '@qiongqi/delegation'

export type QiongqiServeRuntimeOptions = {
  host: string
  port: number
  configPath?: string
  dataDir: string
  runtimeToken: string
  apiKey: string
  baseUrl: string
  endpointFormat?: ModelEndpointFormat
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  tokenEconomyMode: boolean
  tokenEconomy?: TokenEconomyConfig
  insecure: boolean
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  runtime?: RuntimeTuningConfig
  storage?: StorageConfig
  capabilities?: QiongqiCapabilitiesConfig
  startedAt?: string
  /**
   * System prompt for the agent. When omitted, falls back to the
   * built-in Qiongqi system prompt. Embedders (e.g. industry presets)
   * pass their own prompt here to rebrand the agent without forking
   * the runtime.
   */
  systemPrompt?: string
  /**
   * Pinned constraints prepended after the system prompt to keep the
   * stable prefix byte-stable across turns. Optional override for
   * embedders that need custom constraints.
   */
  pinnedConstraints?: string[]
  /**
   * Optional display name for this agent. Surfaced via runtime info
   * and (in later stages) the AgentCard. Defaults to 'Qiongqi'.
   */
  agentName?: string
}

export type QiongqiServeHandle = NodeHttpServerHandle & {
  runtime: ServerRuntime
}

/**
 * Composition root for serve mode. This is intentionally the only
 * place that wires concrete adapters to ports; domain, services, loop,
 * and HTTP handlers stay constructor-injected and testable.
 */
export async function createQiongqiServeRuntime(
  options: QiongqiServeRuntimeOptions
): Promise<ServerRuntime> {
  await mkdir(options.dataDir, { recursive: true })
  const eventBus = new InMemoryEventBus()
  const stores = await createPersistentStores({
    dataDir: options.dataDir,
    storage: options.storage,
    nowIso: () => new Date().toISOString()
  })
  const sessionStore = stores.sessionStore
  const threadStore = stores.threadStore
  const approvalGate = new InMemoryApprovalGate()
  const userInputGate = new InMemoryUserInputGate()
  const workspaceInspector = new LocalWorkspaceInspector()
  const usageService = new UsageService()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const compactor = new ContextCompactor({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  const tokenEconomy = tokenEconomyConfigForOptions(options)
  const ids = new RandomIdGenerator()
  const nowIso = () => new Date().toISOString()
  const allocateSeq = (threadId: string) => eventBus.allocateSeq(threadId)
  const events = new RuntimeEventRecorder({ eventBus, sessionStore, allocateSeq, nowIso })
  const prefix = createImmutablePrefix({
    systemPrompt: options.systemPrompt ?? QIONGQI_SYSTEM_PROMPT,
    pinnedConstraints: options.pinnedConstraints ?? [
      'system: preserve user intent across compaction',
      'system: keep the HTTP/SSE contract stable for the GUI',
      'system: keep the stable Qiongqi prefix byte-stable for prompt-cache reuse'
    ]
  })
  const turnService = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight,
    steering,
    compactor,
    ids,
    nowIso
  })
  const threadService = new ThreadService({ threadStore, sessionStore, events, ids, nowIso })
  await seedUsageCarryover({ threadStore, sessionStore, usageService })
  const modelClient = new DeepseekCompatModelClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
    model: options.model
  })
  const modelProfiles = modelContextProfilesFromConfig({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  const reviewService = new ReviewService({
    threadStore,
    turns: turnService,
    model: modelClient,
    defaultModel: options.model,
    nowIso,
    modelCapabilities: (model) => modelCapabilitiesForModel(model, modelProfiles),
    ...(options.models ? { models: options.models } : {}),
    ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
    ...(tokenEconomy ? { tokenEconomy } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {})
  })
  const skillRuntime = await SkillRuntime.create(options.capabilities?.skills)
  const skillPluginHost = await SkillPluginHost.create(options.capabilities?.skills, {
    builtinRoot: await resolveBuiltinSkillRoot(options.dataDir)
  })
  const skillMcpServers = collectSkillMcpServers(
    skillPluginHost.list(),
    process.cwd(),
    (p) => skillPluginHost.isEnabled(p)
  )
  const mergedMcpConfig = options.capabilities?.mcp && Object.keys(skillMcpServers).length > 0
    ? {
        ...options.capabilities.mcp,
        servers: {
          ...options.capabilities.mcp.servers,
          ...skillMcpServers as Record<string, typeof options.capabilities.mcp.servers[string]>
        }
      }
    : options.capabilities?.mcp
  const mcpProviders = await buildMcpToolProviders(mergedMcpConfig)
  const webProviders = buildWebToolProviders(options.capabilities?.web)
  const attachmentStore = options.capabilities?.attachments.enabled
    ? new FileAttachmentStore({
        rootDir: join(options.dataDir, 'attachments'),
        config: options.capabilities.attachments,
        nowIso
      })
    : undefined
  const memoryStore = options.capabilities?.memory.enabled
    ? new FileMemoryStore({
        rootDir: join(options.dataDir, 'memory'),
        config: options.capabilities.memory,
        nowIso
      })
    : undefined
  const baseToolProviders = [
    {
      id: 'builtin',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      tools: buildDefaultLocalTools()
    },
    ...mcpProviders.providers,
    ...webProviders.providers,
    ...buildMemoryToolProviders(memoryStore)
  ]
  const childRegistry = new CapabilityRegistry(baseToolProviders)
  const childToolHost = new LocalToolHost({ registry: childRegistry, readTracker: true })
  const delegationRuntime = options.capabilities?.subagents.enabled
    ? new DelegationRuntime({
        config: options.capabilities.subagents,
        store: new FileDelegationStore(join(options.dataDir, 'child-runs')),
        events,
        nowIso,
        executor: createChildAgentExecutor({
          model: modelClient,
          toolHost: childToolHost,
          prefix,
          defaultModel: options.model,
          models: options.models,
          contextCompaction: options.contextCompaction,
          approvalPolicy: options.approvalPolicy,
          sandboxMode: options.sandboxMode,
          modelCapabilities: (model) => modelCapabilitiesForModel(model, modelProfiles),
          skillRuntime,
          skillPluginHost,
          tokenEconomy,
          ...(options.runtime ? { runtime: options.runtime } : {}),
          ...(memoryStore ? { memoryStore } : {}),
          nowIso
        }),
        recordExternalUsage: (threadId, usage) => {
          usageService.record(threadId, usage)
        }
      })
    : undefined
  const capabilities = buildRuntimeCapabilityManifest({
    config: options.capabilities,
    model: modelCapabilitiesForModel(options.model, modelProfiles),
    mcp: {
      configuredServers: Object.keys(options.capabilities?.mcp.servers ?? {}).length,
      connectedServers: mcpProviders.connectedServers,
      toolCount: mcpProviders.toolCount,
      lastError: mcpProviders.diagnostics.find((diagnostic) => diagnostic.lastError)?.lastError,
      search: {
        active: mcpProviders.search.active,
        indexedToolCount: mcpProviders.search.indexedToolCount,
        advertisedToolCount: mcpProviders.search.advertisedToolCount
      }
    },
    web: {
      fetchAvailable: webProviders.fetchAvailable,
      searchAvailable: webProviders.searchAvailable,
      provider: webProviders.provider,
      reason: webProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    skills: {
      configuredRoots: options.capabilities?.skills.roots.length,
      discoveredSkills: skillRuntime.count(),
      reason: skillRuntime.diagnostics().validationErrors[0]?.message
    },
    attachments: {
      available: Boolean(attachmentStore)
    },
    memory: {
      available: Boolean(memoryStore)
    },
    subagents: {
      available: Boolean(delegationRuntime)
    }
  })
  const registry = new CapabilityRegistry([
    ...baseToolProviders,
    {
      id: 'goal',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildGoalLocalTools(threadService)
    },
    {
      id: 'todo',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildTodoLocalTools(threadService)
    },
    ...buildDelegationToolProviders(delegationRuntime),
    ...(() => {
      // Declarative skill tools delegate execution to the matching built-in
      // tool (e.g. a `bash`-template tool runs its declared command via the
      // real bash tool). The skills themselves never execute arbitrary code.
      const builtinBash = createBashLocalTool()
      const skillExecutor: SkillToolExecutor = async (template, args, context) => {
        if (template === 'bash') {
          const command = typeof args.command === 'string' ? args.command : ''
          if (!command) return { output: 'skill bash tool declared no command', isError: true }
          return builtinBash.execute({ action: 'run', command }, context)
        }
        // read/grep/find/ls/edit/write templates could be supported similarly;
        // for v1 only `bash` is wired (the common case, e.g. run_tests).
        return { output: `skill template ${template} is not executable in v1`, isError: true }
      }
      const provider = buildSkillToolProvider(
        skillPluginHost.list(),
        (_skillId, context) => context.activeSkillIds ?? [],
        skillExecutor
      )
      return provider.tools.length ? [provider] : []
    })()
  ])
  const toolHost = new LocalToolHost({ registry, readTracker: true })
  const loop = new TurnOrchestrator({
    threadStore,
    sessionStore,
    approvalGate,
    userInputGate,
    model: modelClient,
    toolHost,
    usage: usageService,
    events,
    turns: turnService,
    inflight,
    steering,
    compactor,
    prefix,
    ids,
    nowIso,
    modelCapabilities: (model) => modelCapabilitiesForModel(model, modelProfiles),
    skillRuntime,
    skillPluginHost,
    tokenEconomy,
    contextCompaction: options.contextCompaction,
    ...(options.runtime?.toolStorm ? { toolStorm: options.runtime.toolStorm } : {}),
    ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {}),
    ...(attachmentStore ? { attachmentStore } : {}),
    ...(memoryStore ? { memoryStore } : {}),
    onPlanWritten: async ({ threadId, planId, relativePath, markdown }) => {
      await threadService.syncTodosFromPlan(threadId, {
        planId,
        relativePath,
        markdown,
        preserveCompleted: true
      })
    }
  })
  const startedAt = options.startedAt ?? nowIso()
  return {
    threadService,
    turnService,
    reviewService,
    usageService,
    eventBus,
    sessionStore,
    events,
    approvalGate,
    userInputGate,
    workspaceInspector,
    toolHost,
    ...(attachmentStore ? { attachmentStore } : {}),
    ...(memoryStore ? { memoryStore } : {}),
    runTurn(threadId, turnId) {
      return loop.runTurn(threadId, turnId)
    },
    runReview(input) {
      return reviewService.runReview(input)
    },
    runtimeToken: options.runtimeToken,
    insecure: options.insecure,
    allocateSeq,
    nowIso,
    info: () => ({
      agentName: options.agentName ?? 'Qiongqi',
      host: options.host,
      port: options.port,
      configPath: options.configPath,
      dataDir: options.dataDir,
      model: options.model,
      endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
      approvalPolicy: options.approvalPolicy,
      sandboxMode: options.sandboxMode,
      tokenEconomyMode: options.tokenEconomyMode,
      insecure: options.insecure,
      startedAt,
      pid: process.pid,
      capabilities
    }),
    toolDiagnostics: async () => ({
      providers: registry.diagnostics(),
      mcpServers: mcpProviders.diagnostics,
      mcpSearch: mcpProviders.search,
      webProviders: webProviders.diagnostics,
      skills: skillRuntime.diagnostics(),
      attachments: attachmentStore
        ? await attachmentStore.diagnostics()
        : { enabled: false, rootDir: '', count: 0, totalBytes: 0 },
      memory: memoryStore
        ? await memoryStore.diagnostics()
        : { enabled: false, rootDir: '', activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] }
    }),
    skills: () => skillRuntime.diagnostics(),
    skillsV2: () => skillPluginHost.diagnostics(),
    shutdown: async () => {
      try {
        await mcpProviders.close()
      } finally {
        await stores.shutdown?.()
      }
    }
  }
}

function tokenEconomyConfigForOptions(
  options: Pick<QiongqiServeRuntimeOptions, 'tokenEconomyMode' | 'tokenEconomy'>
): TokenEconomyConfig {
  return {
    ...(options.tokenEconomy ?? {}),
    enabled: options.tokenEconomy?.enabled ?? options.tokenEconomyMode
  }
}

async function createPersistentStores(input: {
  dataDir: string
  storage?: StorageConfig
  nowIso: () => string
}): Promise<{ threadStore: ThreadStore; sessionStore: SessionStore; shutdown?: () => Promise<void> }> {
  const storage = input.storage ?? DEFAULT_STORAGE_CONFIG
  if (storage.backend === 'file') {
    return {
      sessionStore: new FileSessionStore({ dataDir: input.dataDir }),
      threadStore: new FileThreadStore({ dataDir: input.dataDir })
    }
  }

  const threadStore = new HybridThreadStore({
    dataDir: input.dataDir,
    sqlitePath: storage.sqlitePath ? expandHomePath(storage.sqlitePath) : undefined,
    nowIso: input.nowIso
  })
  await threadStore.ready()
  return {
    threadStore,
    sessionStore: new HybridSessionStore({
      dataDir: input.dataDir,
      index: threadStore
    }),
    shutdown: async () => {
      threadStore.close()
    }
  }
}

export async function seedUsageCarryover(input: {
  threadStore: ThreadStore
  sessionStore: SessionStore
  usageService: UsageService
}): Promise<void> {
  const threadSummaries = await input.threadStore.list()
  await Promise.all(threadSummaries.map(async (thread) => {
    const events = await input.sessionStore.loadEventsSince(thread.id, 0)
    const latestUsage = events.reduce<UsageEvent | null>((latest, event) => {
      if (event.kind !== 'usage') return latest
      if (!latest || event.seq > latest.seq) return event
      return latest
    }, null)
    if (latestUsage) input.usageService.seedThread(thread.id, latestUsage.usage)
  }))
}

export async function startQiongqiServe(
  options: QiongqiServeRuntimeOptions
): Promise<QiongqiServeHandle> {
  const runtime = await createQiongqiServeRuntime(options)
  const router = buildRouter(runtime)
  const server = await startNodeHttpServer({
    router,
    host: options.host,
    port: options.port
  })
  return {
    ...server,
    runtime,
    close: async () => {
      try {
        await server.close()
      } finally {
        await runtime.shutdown?.()
      }
    }
  }
}

/**
 * Locate an optional packager-installed skill bundle.
 *
 * Qiongqi is a general-purpose framework: it ships NO domain-specific
 * skills by default. Industry presets (coding, finance, creative, ...)
 * are delivered as separate packages and must be wired in explicitly
 * via `capabilities.skills.roots` in the config.
 *
 * The only implicit lookup is `<dataDir>/builtin-skills`, which lets a
 * downstream packager drop a curated skill bundle into the data dir
 * without touching the config. Returns undefined when absent so the
 * runtime simply starts with an empty skill registry.
 */
async function resolveBuiltinSkillRoot(dataDir: string): Promise<string | undefined> {
  const packaged = join(dataDir, 'builtin-skills')
  return existsSync(packaged) ? packaged : undefined
}
