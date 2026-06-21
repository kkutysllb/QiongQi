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
import { ModelCompatClient } from '@qiongqi/adapter-model'
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

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

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
  /**
   * Explicit skill root directories for the plugin host. When omitted,
   * the runtime checks `<dataDir>/builtin-skills` as a convenience for
   * downstream packagers that drop a curated skill bundle there.
   *
   * Stage 1.3 decoupling: previously the runtime hard-coded
   * `cwd/qiongqi/skills`; this parameter lets embedders pass skill
   * roots explicitly without relying on process layout.
   */
  skillRoots?: string[]
}

export type QiongqiServeHandle = NodeHttpServerHandle & {
  runtime: ServerRuntime
}

// ---------------------------------------------------------------------------
// createCore — infrastructure layer (stores, event bus, services)
// ---------------------------------------------------------------------------

/** Infrastructure assembled without model or tool knowledge. */
export interface CoreRuntime {
  sessionStore: SessionStore
  threadStore: ThreadStore
  eventBus: InMemoryEventBus
  approvalGate: InMemoryApprovalGate
  userInputGate: InMemoryUserInputGate
  workspaceInspector: LocalWorkspaceInspector
  usageService: UsageService
  inflight: InflightTracker
  steering: SteeringQueue
  compactor: ContextCompactor
  ids: RandomIdGenerator
  nowIso: () => string
  allocateSeq: (threadId: string) => number
  events: RuntimeEventRecorder
  turnService: TurnService
  threadService: ThreadService
  storesShutdown?: () => Promise<void>
}

export async function createCore(
  options: Pick<QiongqiServeRuntimeOptions, 'dataDir' | 'storage' | 'contextCompaction' | 'models'>
): Promise<CoreRuntime> {
  await mkdir(options.dataDir, { recursive: true })
  const eventBus = new InMemoryEventBus()
  const stores = await createPersistentStores({
    dataDir: options.dataDir,
    storage: options.storage,
    nowIso: () => new Date().toISOString()
  })
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
  const ids = new RandomIdGenerator()
  const nowIso = () => new Date().toISOString()
  const allocateSeq = (threadId: string) => eventBus.allocateSeq(threadId)
  const events = new RuntimeEventRecorder({ eventBus, sessionStore: stores.sessionStore, allocateSeq, nowIso })
  const turnService = new TurnService({
    threadStore: stores.threadStore,
    sessionStore: stores.sessionStore,
    events,
    inflight,
    steering,
    compactor,
    ids,
    nowIso
  })
  const threadService = new ThreadService({
    threadStore: stores.threadStore,
    sessionStore: stores.sessionStore,
    events,
    ids,
    nowIso
  })
  await seedUsageCarryover({
    threadStore: stores.threadStore,
    sessionStore: stores.sessionStore,
    usageService
  })
  return {
    sessionStore: stores.sessionStore,
    threadStore: stores.threadStore,
    eventBus,
    approvalGate,
    userInputGate,
    workspaceInspector,
    usageService,
    inflight,
    steering,
    compactor,
    ids,
    nowIso,
    allocateSeq,
    events,
    turnService,
    threadService,
    storesShutdown: stores.shutdown
  }
}

// ---------------------------------------------------------------------------
// createModelAdapter — model client + capability profiles
// ---------------------------------------------------------------------------

export interface ModelAdapter {
  client: ModelCompatClient
  profiles: ReturnType<typeof modelContextProfilesFromConfig>
  modelCapabilities: (model: string) => ReturnType<typeof modelCapabilitiesForModel>
}

export function createModelAdapter(
  options: Pick<
    QiongqiServeRuntimeOptions,
    'baseUrl' | 'apiKey' | 'endpointFormat' | 'model' | 'contextCompaction' | 'models'
  >
): ModelAdapter {
  const client = new ModelCompatClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
    model: options.model
  })
  const profiles = modelContextProfilesFromConfig({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  return {
    client,
    profiles,
    modelCapabilities: (model: string) => modelCapabilitiesForModel(model, profiles)
  }
}

// ---------------------------------------------------------------------------
// createToolMatrix — tool providers, registry, delegation, skills
// ---------------------------------------------------------------------------

export interface ToolMatrix {
  registry: CapabilityRegistry
  toolHost: LocalToolHost
  mcpProviders: Awaited<ReturnType<typeof buildMcpToolProviders>>
  webProviders: ReturnType<typeof buildWebToolProviders>
  skillRuntime: SkillRuntime
  skillPluginHost: SkillPluginHost
  delegationRuntime: DelegationRuntime | undefined
  attachmentStore: FileAttachmentStore | undefined
  memoryStore: FileMemoryStore | undefined
}

export async function createToolMatrix(
  options: Pick<
    QiongqiServeRuntimeOptions,
    'dataDir' | 'capabilities' | 'approvalPolicy' | 'sandboxMode' | 'model' | 'models' | 'contextCompaction' | 'runtime' | 'skillRoots' | 'tokenEconomyMode' | 'tokenEconomy'
  >,
  core: CoreRuntime,
  model: ModelAdapter
): Promise<ToolMatrix> {
  const nowIso = core.nowIso
  const skillRuntime = await SkillRuntime.create(options.capabilities?.skills)
  const skillPluginHost = await SkillPluginHost.create(options.capabilities?.skills, {
    builtinRoot: await resolveBuiltinSkillRoot(options.dataDir, options.skillRoots)
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
  const tokenEconomy = tokenEconomyConfigForOptions(options)
  const delegationRuntime = options.capabilities?.subagents.enabled
    ? new DelegationRuntime({
        config: options.capabilities.subagents,
        store: new FileDelegationStore(join(options.dataDir, 'child-runs')),
        events: core.events,
        nowIso,
        executor: createChildAgentExecutor({
          model: model.client,
          toolHost: childToolHost,
          prefix: createImmutablePrefix({ systemPrompt: QIONGQI_SYSTEM_PROMPT }),
          defaultModel: options.model,
          models: options.models,
          contextCompaction: options.contextCompaction,
          approvalPolicy: options.approvalPolicy,
          sandboxMode: options.sandboxMode,
          modelCapabilities: model.modelCapabilities,
          skillRuntime,
          skillPluginHost,
          tokenEconomy,
          ...(options.runtime ? { runtime: options.runtime } : {}),
          ...(memoryStore ? { memoryStore } : {}),
          nowIso
        }),
        recordExternalUsage: (threadId, usage) => {
          core.usageService.record(threadId, usage)
        }
      })
    : undefined
  const registry = new CapabilityRegistry([
    ...baseToolProviders,
    {
      id: 'goal',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildGoalLocalTools(core.threadService)
    },
    {
      id: 'todo',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildTodoLocalTools(core.threadService)
    },
    ...buildDelegationToolProviders(delegationRuntime),
    ...(() => {
      const builtinBash = createBashLocalTool()
      const skillExecutor: SkillToolExecutor = async (template, args, context) => {
        if (template === 'bash') {
          const command = typeof args.command === 'string' ? args.command : ''
          if (!command) return { output: 'skill bash tool declared no command', isError: true }
          return builtinBash.execute({ action: 'run', command }, context)
        }
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
  return {
    registry,
    toolHost,
    mcpProviders,
    webProviders,
    skillRuntime,
    skillPluginHost,
    delegationRuntime,
    attachmentStore,
    memoryStore
  }
}

// ---------------------------------------------------------------------------
// createAgent — full runtime assembly (composition root)
// ---------------------------------------------------------------------------

/**
 * Assemble a full Qiongqi serve runtime from core, model adapter, and
 * tool matrix sub-components. This is the top-level composition root
 * — the only place that wires concrete adapters to ports.
 *
 * Stage 1.3 splits the original 500-line monolith into:
 *   - {@link createCore} (stores, events, services)
 *   - {@link createModelAdapter} (model client + profiles)
 *   - {@link createToolMatrix} (tools, skills, delegation)
 *   - {@link createAgent} (this function — orchestration loop)
 */
export async function createAgent(
  options: QiongqiServeRuntimeOptions
): Promise<ServerRuntime> {
  const core = await createCore(options)
  const model = createModelAdapter(options)
  const tools = await createToolMatrix(options, core, model)
  return assembleRuntime({ options, core, model, tools })
}

/**
 * Original entry point — delegates to {@link createAgent}.
 * Kept for backward compatibility with existing import sites.
 */
export async function createQiongqiServeRuntime(
  options: QiongqiServeRuntimeOptions
): Promise<ServerRuntime> {
  return createAgent(options)
}

// ---------------------------------------------------------------------------
// Internal assembly helpers
// ---------------------------------------------------------------------------

function tokenEconomyConfigForOptions(
  options: Pick<QiongqiServeRuntimeOptions, 'tokenEconomyMode' | 'tokenEconomy'>
): TokenEconomyConfig {
  return {
    ...(options.tokenEconomy ?? {}),
    enabled: options.tokenEconomy?.enabled ?? options.tokenEconomyMode
  }
}

function assembleRuntime(input: {
  options: QiongqiServeRuntimeOptions
  core: CoreRuntime
  model: ModelAdapter
  tools: ToolMatrix
}): ServerRuntime {
  const { options, core, model, tools } = input
  const prefix = createImmutablePrefix({
    systemPrompt: options.systemPrompt ?? QIONGQI_SYSTEM_PROMPT,
    pinnedConstraints: options.pinnedConstraints ?? [
      'system: preserve user intent across compaction',
      'system: keep the HTTP/SSE contract stable for the GUI',
      'system: keep the stable Qiongqi prefix byte-stable for prompt-cache reuse'
    ]
  })
  const tokenEconomy = tokenEconomyConfigForOptions(options)
  const reviewService = new ReviewService({
    threadStore: core.threadStore,
    turns: core.turnService,
    model: model.client,
    defaultModel: options.model,
    nowIso: core.nowIso,
    modelCapabilities: model.modelCapabilities,
    ...(options.models ? { models: options.models } : {}),
    ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
    ...(tokenEconomy ? { tokenEconomy } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {})
  })
  const loop = new TurnOrchestrator({
    threadStore: core.threadStore,
    sessionStore: core.sessionStore,
    approvalGate: core.approvalGate,
    userInputGate: core.userInputGate,
    model: model.client,
    toolHost: tools.toolHost,
    usage: core.usageService,
    events: core.events,
    turns: core.turnService,
    inflight: core.inflight,
    steering: core.steering,
    compactor: core.compactor,
    prefix,
    ids: core.ids,
    nowIso: core.nowIso,
    modelCapabilities: model.modelCapabilities,
    skillRuntime: tools.skillRuntime,
    skillPluginHost: tools.skillPluginHost,
    tokenEconomy,
    contextCompaction: options.contextCompaction,
    ...(options.runtime?.toolStorm ? { toolStorm: options.runtime.toolStorm } : {}),
    ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {}),
    ...(tools.attachmentStore ? { attachmentStore: tools.attachmentStore } : {}),
    ...(tools.memoryStore ? { memoryStore: tools.memoryStore } : {}),
    onPlanWritten: async ({ threadId, planId, relativePath, markdown }) => {
      await core.threadService.syncTodosFromPlan(threadId, {
        planId,
        relativePath,
        markdown,
        preserveCompleted: true
      })
    }
  })
  const capabilities = buildRuntimeCapabilityManifest({
    config: options.capabilities,
    model: model.modelCapabilities(options.model),
    mcp: {
      configuredServers: Object.keys(options.capabilities?.mcp.servers ?? {}).length,
      connectedServers: tools.mcpProviders.connectedServers,
      toolCount: tools.mcpProviders.toolCount,
      lastError: tools.mcpProviders.diagnostics.find((d) => d.lastError)?.lastError,
      search: {
        active: tools.mcpProviders.search.active,
        indexedToolCount: tools.mcpProviders.search.indexedToolCount,
        advertisedToolCount: tools.mcpProviders.search.advertisedToolCount
      }
    },
    web: {
      fetchAvailable: tools.webProviders.fetchAvailable,
      searchAvailable: tools.webProviders.searchAvailable,
      provider: tools.webProviders.provider,
      reason: tools.webProviders.diagnostics.find((d) => d.reason)?.reason
    },
    skills: {
      configuredRoots: options.capabilities?.skills.roots.length,
      discoveredSkills: tools.skillRuntime.count(),
      reason: tools.skillRuntime.diagnostics().validationErrors[0]?.message
    },
    attachments: { available: Boolean(tools.attachmentStore) },
    memory: { available: Boolean(tools.memoryStore) },
    subagents: { available: Boolean(tools.delegationRuntime) }
  })
  const startedAt = options.startedAt ?? core.nowIso()
  return {
    threadService: core.threadService,
    turnService: core.turnService,
    reviewService,
    usageService: core.usageService,
    eventBus: core.eventBus,
    sessionStore: core.sessionStore,
    events: core.events,
    approvalGate: core.approvalGate,
    userInputGate: core.userInputGate,
    workspaceInspector: core.workspaceInspector,
    toolHost: tools.toolHost,
    ...(tools.attachmentStore ? { attachmentStore: tools.attachmentStore } : {}),
    ...(tools.memoryStore ? { memoryStore: tools.memoryStore } : {}),
    runTurn(threadId, turnId) {
      return loop.runTurn(threadId, turnId)
    },
    runReview(input: Parameters<ReviewService['runReview']>[0]) {
      return reviewService.runReview(input)
    },
    runtimeToken: options.runtimeToken,
    insecure: options.insecure,
    allocateSeq: core.allocateSeq,
    nowIso: core.nowIso,
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
      providers: tools.registry.diagnostics(),
      mcpServers: tools.mcpProviders.diagnostics,
      mcpSearch: tools.mcpProviders.search,
      webProviders: tools.webProviders.diagnostics,
      skills: tools.skillRuntime.diagnostics(),
      attachments: tools.attachmentStore
        ? await tools.attachmentStore.diagnostics()
        : { enabled: false, rootDir: '', count: 0, totalBytes: 0 },
      memory: tools.memoryStore
        ? await tools.memoryStore.diagnostics()
        : { enabled: false, rootDir: '', activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] }
    }),
    skills: () => tools.skillRuntime.diagnostics(),
    skillsV2: () => tools.skillPluginHost.diagnostics(),
    shutdown: async () => {
      try {
        await tools.mcpProviders.close()
      } finally {
        await core.storesShutdown?.()
      }
    }
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
 * Stage 1.3 decoupling: callers can now pass explicit `skillRoots`
 * via options. When not provided, the runtime falls back to checking
 * `<dataDir>/builtin-skills` as a convenience for downstream
 * packagers. Returns undefined when neither is available so the
 * runtime simply starts with an empty skill registry.
 */
async function resolveBuiltinSkillRoot(
  dataDir: string,
  skillRoots?: string[]
): Promise<string | undefined> {
  if (skillRoots && skillRoots.length > 0) {
    const first = skillRoots.find((root) => existsSync(root))
    if (first) return first
  }
  const packaged = join(dataDir, 'builtin-skills')
  return existsSync(packaged) ? packaged : undefined
}
