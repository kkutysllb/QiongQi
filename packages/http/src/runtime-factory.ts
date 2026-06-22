import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
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
import {
  AgentCardSchema,
  type AgentCard,
  type SkillSummary
} from '@qiongqi/contracts'
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
import { PeerRegistry, FilePeerStore } from '@qiongqi/delegation'
import { HttpPeerTransport } from './http-peer-transport.js'

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
  /**
   * Stage 2: explicit AgentCard override. When omitted, the runtime
   * builds a card automatically from `host`/`port`/`model`/
   * `agentName`/capabilities and persists a stable id under
   * `<dataDir>/agent-identity.json`. Pass an explicit card only when
   * you need to override the auto-derived fields (e.g. behind a proxy
   * with a different public URL).
   */
  agentCard?: AgentCard
}

export type QiongqiServeHandle = NodeHttpServerHandle & {
  runtime: ServerRuntime
}

// ---------------------------------------------------------------------------
// createCore — infrastructure layer (stores, event bus, services)
// ---------------------------------------------------------------------------

/**
 * Infrastructure layer assembled without any model or tool knowledge.
 *
 * Returned by {@link createCore}. Contains the stores (thread/session),
 * event bus, approval & user-input gates, usage tracker, and the
 * Thread/Turn/Review services. Embedders that want full control can
 * construct a `CoreRuntime` manually (or mock it) and pass it to
 * {@link createToolMatrix} + {@link assembleRuntime} directly.
 */
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

/**
 * Build the infrastructure layer: persistent stores, event bus, and
 * the Thread/Turn/Usage services.
 *
 * This is the lowest of the three composition sub-components. It has
 * no dependency on the model client or the tool matrix, so embedders
 * can use it standalone for testing, for headless turn execution, or
 * to swap the model/tool layers without touching storage.
 *
 * The function is idempotent with respect to the data directory — it
 * creates the directory if missing and rehydrates usage carryover
 * from existing events.
 *
 * @param options.dataDir - Directory for persistent state. Created if
 *   missing.
 * @param options.storage - Optional storage backend override
 *   (`'file'` or `'hybrid'`). Defaults to file-based JSONL.
 * @param options.contextCompaction - Passed through to the
 *   {@link ContextCompactor} so compaction thresholds match the
 *   model layer.
 * @param options.models - Per-model overrides used by the compactor
 *   to derive context windows.
 */
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

/**
 * Model layer: the HTTP client and capability profiles derived from
 * the user-supplied configuration.
 *
 * Returned by {@link createModelAdapter}. The `modelCapabilities`
 * function lets downstream code ask “does this model support vision /
 * tool calls / streaming?” without re-parsing the config.
 */
export interface ModelAdapter {
  client: ModelCompatClient
  profiles: ReturnType<typeof modelContextProfilesFromConfig>
  modelCapabilities: (model: string) => ReturnType<typeof modelCapabilitiesForModel>
}

/**
 * Construct the model client and capability profiles.
 *
 * Creates a {@link ModelCompatClient} wired to the supplied
 * `baseUrl` / `apiKey` / `endpointFormat`, plus the context-window
 * and capability profiles derived from the `models` config.
 *
 * This sub-component is synchronous (no I/O) so embedders can call it
 * in hot paths or tests without awaiting.
 */
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

/**
 * Tool layer: registry, local tool host, MCP/web providers, skill
 * runtime, delegation runtime, and optional attachment/memory stores.
 *
 * Returned by {@link createToolMatrix}. Embedders that only need a
 * subset (e.g. no delegation, no skills) can construct a `ToolMatrix`
 * manually and pass it to {@link assembleRuntime}.
 */
export interface ToolMatrix {
  registry: CapabilityRegistry
  toolHost: LocalToolHost
  mcpProviders: Awaited<ReturnType<typeof buildMcpToolProviders>>
  webProviders: ReturnType<typeof buildWebToolProviders>
  skillRuntime: SkillRuntime
  skillPluginHost: SkillPluginHost
  delegationRuntime: DelegationRuntime | undefined
  /** Stage 2: peer registry shared with delegation runtime. */
  peerRegistry: PeerRegistry
  attachmentStore: FileAttachmentStore | undefined
  memoryStore: FileMemoryStore | undefined
}

/**
 * Build the tool layer: registry, local tool host, MCP/web providers,
 * skill runtime, delegation runtime, and optional attachment/memory
 * stores.
 *
 * This sub-component depends on both {@link CoreRuntime} (for event
 * recording, usage tracking) and {@link ModelAdapter} (for delegation
 * to child agents). It is async because MCP servers may need to
 * handshake before their tools are available.
 *
 * @param options.capabilities - The capability manifest controlling
 *   which tool providers are enabled (MCP, web, memory, attachments,
 *   subagents, skills).
 * @param options.skillRoots - Explicit skill directories. See
 *   {@link QiongqiServeRuntimeOptions.skillRoots}.
 * @param core - The {@link CoreRuntime} from {@link createCore}.
 * @param model - The {@link ModelAdapter} from {@link createModelAdapter}.
 */
export async function createToolMatrix(
  options: Pick<
    QiongqiServeRuntimeOptions,
    'dataDir' | 'capabilities' | 'approvalPolicy' | 'sandboxMode' | 'model' | 'models' | 'contextCompaction' | 'runtime' | 'skillRoots' | 'tokenEconomyMode' | 'tokenEconomy'
  >,
  core: CoreRuntime,
  model: ModelAdapter,
  /**
   * Stage 2: peer registry injected from the caller. When supplied,
   * the delegation runtime registers child agents here so they become
   * addressable via `invokePeer`. Created by {@link createAgent} and
   * forwarded down — keeps the registry lifetime tied to the agent,
   * not the tool matrix.
   */
  peerRegistry?: PeerRegistry
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
        ...(peerRegistry ? {
          peerRegistry,
          agentsDir: join(options.dataDir, 'agents')
        } : {}),
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
  // Stage 2: always give ToolMatrix a peer registry. When the caller
  // didn't supply one (e.g. tests, legacy paths), create a standalone
  // one so the interface is always satisfied.
  const effectivePeerRegistry = peerRegistry ?? new PeerRegistry()
  return {
    registry,
    toolHost,
    mcpProviders,
    webProviders,
    skillRuntime,
    skillPluginHost,
    delegationRuntime,
    peerRegistry: effectivePeerRegistry,
    attachmentStore,
    memoryStore
  }
}

// ---------------------------------------------------------------------------
// createAgent — full runtime assembly (composition root)
// ---------------------------------------------------------------------------

/**
 * Assemble a full Qiongqi serve runtime from core, model adapter, and
 * tool matrix sub-components.
 *
 * This is the top-level composition root — the only place that wires
 * concrete adapters to ports. Returns a {@link ServerRuntime} which
 * can then be mounted via {@link createHttpServer} or used directly
 * for programmatic turn execution.
 *
 * # Quick start
 *
 * ```ts
 * import { createAgent, createHttpServer } from '@qiongqi/http'
 *
 * // 1. Build the agent (no network I/O yet)
 * const agent = await createAgent({
 *   host: '127.0.0.1',
 *   port: 8899,
 *   dataDir: '~/.qiongqi/data',
 *   runtimeToken: process.env.QIONGQI_TOKEN!,
 *   apiKey: process.env.DEEPSEEK_API_KEY!,
 *   baseUrl: 'https://api.deepseek.com',
 *   model: 'deepseek-chat',
 *   approvalPolicy: 'on-request',
 *   sandboxMode: 'workspace',
 *   tokenEconomyMode: true,
 *   insecure: false
 * })
 *
 * // 2. (Optional) override the system prompt
 * // agent.info().model === 'deepseek-chat'
 *
 * // 3. Mount the HTTP server
 * const server = await createHttpServer({
 *   agent,
 *   host: '127.0.0.1',
 *   port: 8899
 * })
 * ```
 *
 * # Composition sub-components
 *
 * Stage 1.3 splits the original 500-line monolith into:
 *   - {@link createCore} — stores, event bus, Thread/Turn/Usage services
 *   - {@link createModelAdapter} — model client + capability profiles
 *   - {@link createToolMatrix} — tool registry, skills, delegation runtime
 *   - {@link createAgent} — this function — full orchestration loop
 *
 * Embedders that only need a subset (e.g. just the stores + model
 * without the tool matrix) can call the sub-components directly and
 * assemble their own runtime shape.
 *
 * @param options - Flat configuration object. See
 *   {@link QiongqiServeRuntimeOptions} for every field.
 * @returns A ready-to-use {@link ServerRuntime}. Call
 *   {@link createHttpServer} to mount it on a TCP port, or invoke
 *   `agent.runTurn()` / `agent.runReview()` programmatically.
 */
export async function createAgent(
  options: QiongqiServeRuntimeOptions
): Promise<ServerRuntime> {
  const core = await createCore(options)
  const model = createModelAdapter(options)
  // Stage 2: create the PeerRegistry that will be shared between
  // the HTTP routes (agent-card discovery), delegation runtime
  // (child agents), and external callers (A2A).
  const peerStore = new FilePeerStore(join(options.dataDir, 'peers'))
  const peerRegistry = new PeerRegistry({
    remoteTransport: new HttpPeerTransport({
      getToken: () => options.runtimeToken || undefined
    }),
    onChange: async (record, action) => {
      if (action === 'register' && record.kind === 'remote') {
        const cards = await peerStore.load()
        const existing = new Map(cards.map((c) => [c.id, c]))
        existing.set(record.card.id, record.card)
        await peerStore.save([...existing.values()])
      } else if (action === 'unregister' && record.kind === 'remote') {
        const cards = (await peerStore.load()).filter((c) => c.id !== record.card.id)
        await peerStore.save(cards)
      }
    }
  })
  // Restore previously persisted remote peers on startup.
  for (const card of await peerStore.load()) {
    await peerRegistry.registerRemote(card).catch(() => {
      // Peers that fail to re-register on startup are silently skipped —
      // the operator can re-discover them later.
    })
  }
  const tools = await createToolMatrix(options, core, model, peerRegistry)
  return await assembleRuntime({ options, core, model, tools })
}

/**
 * Backward-compatible alias for {@link createAgent}.
 *
 * @deprecated since stage 1.4 — prefer `createAgent`. The old name is
 *   retained so existing call sites (CLI, presets, tests) can migrate
 *   incrementally.
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

async function assembleRuntime(input: {
  options: QiongqiServeRuntimeOptions
  core: CoreRuntime
  model: ModelAdapter
  tools: ToolMatrix
}): Promise<ServerRuntime> {
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

  // Stage 2: build or accept the AgentCard. When the caller supplied
  // an explicit card we trust it verbatim (after re-validation).
  // Otherwise we derive one from host/port/model/agentName and
  // persist a stable id under <dataDir>/agent-identity.json so the
  // same dataDir yields the same card id across restarts.
  const skillSummaries: SkillSummary[] = tools.skillRuntime.diagnostics().skills.map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version ?? '0.0.0',
    ...(s.description ? { description: s.description } : {}),
    category: 'workflow' as const
  }))
  const endpointFormat = options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT
  const agentCard = options.agentCard ?? await buildAgentCard({
    dataDir: options.dataDir,
    host: options.host,
    port: options.port,
    agentName: options.agentName ?? 'Qiongqi',
    model: options.model,
    endpointFormats: [endpointFormat],
    capabilities,
    skills: skillSummaries
  })

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
    /** Stage 2: published at /.well-known/agent-card.json */
    agentCard,
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

/**
 * Options for {@link createHttpServer}.
 */
export type CreateHttpServerOptions = {
  /**
   * The already-assembled runtime to mount. Obtain it from
   * {@link createAgent}, a preset like `createCodingAgent`, or by
   * composing {@link createCore}/{@link createModelAdapter}/
   * {@link createToolMatrix} directly.
   */
  agent: ServerRuntime
  /** Bind host. Defaults to `'127.0.0.1'`. */
  host?: string
  /** Bind port. `0` lets the OS pick an ephemeral port. */
  port: number
}

/**
 * Mount a {@link ServerRuntime} on a Node.js HTTP server.
 *
 * This is the transport counterpart to {@link createAgent}: the agent
 * owns the runtime (turn loop, tools, stores), this function owns the
 * TCP listener. Splitting the two lets embedders:
 *
 * - Start the agent once, then restart only the HTTP layer on a
 *   different port (e.g. for hot-reload of TLS certs).
 * - Run an agent headlessly (no HTTP at all) by calling
 *   `agent.runTurn()` directly.
 * - Plug the same agent into a custom transport (WebSocket, IPC,
 *   etc.) without the HTTP machinery.
 *
 * @example
 * ```ts
 * const agent = await createAgent({ ... })
 * const handle = await createHttpServer({ agent, host: '127.0.0.1', port: 8899 })
 * // ... serve traffic ...
 * await handle.close()   // closes HTTP + calls agent.shutdown()
 * ```
 *
 * @returns A {@link QiongqiServeHandle} that owns both the HTTP
 *   server and the runtime lifecycle. `handle.close()` will stop the
 *   listener and invoke `agent.shutdown()`.
 */
export async function createHttpServer(
  options: CreateHttpServerOptions
): Promise<QiongqiServeHandle> {
  const router = buildRouter(options.agent)
  const server = await startNodeHttpServer({
    router,
    host: options.host ?? '127.0.0.1',
    port: options.port
  })
  return {
    ...server,
    runtime: options.agent,
    close: async () => {
      try {
        await server.close()
      } finally {
        await options.agent.shutdown?.()
      }
    }
  }
}

/**
 * Original one-shot entry point: build the runtime AND start the HTTP
 * server in a single call.
 *
 * @deprecated since stage 1.4 — prefer the split `createAgent` +
 *   {@link createHttpServer} pair. This function is retained for CLI
 *   backward compatibility and delegates to the split pair internally.
 */
export async function startQiongqiServe(
  options: QiongqiServeRuntimeOptions
): Promise<QiongqiServeHandle> {
  const runtime = await createAgent(options)
  return createHttpServer({
    agent: runtime,
    host: options.host,
    port: options.port
  })
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

// ---------------------------------------------------------------------------
// Stage 2: AgentCard assembly
// ---------------------------------------------------------------------------

/**
 * Derive a stable {@link AgentCard} for this agent instance.
 *
 * The card id is persisted at `<dataDir>/agent-identity.json` so the
 * same dataDir yields the same id across restarts. The first launch
 * generates a new id (`qiongqi:<uuid>`); subsequent launches reload
 * it so peers can re-establish trust without re-discovery.
 */
async function buildAgentCard(input: {
  dataDir: string
  host: string
  port: number
  agentName: string
  model: string
  endpointFormats: AgentCard['model']['endpointFormats']
  capabilities: AgentCard['capabilities']
  skills: SkillSummary[]
}): Promise<AgentCard> {
  const id = await resolveStableAgentId(input.dataDir)
  const baseUrl = `http://${input.host}:${input.port}`
  const card = AgentCardSchema.parse({
    id,
    url: baseUrl,
    name: input.agentName,
    version: '0.1.0',
    skills: input.skills,
    capabilities: input.capabilities,
    model: {
      // provider is derived from the baseUrl host so consumers know
      // which API family the agent speaks without an extra field.
      provider: deriveProviderFromHost(input.host),
      defaultModel: input.model,
      endpointFormats: input.endpointFormats
    }
  })
  return card
}

/**
 * Read or create a stable agent id for the given dataDir.
 *
 * Persistence: `<dataDir>/agent-identity.json` with shape
 * `{ id: 'qiongqi:<uuid>', createdAt: '<iso>' }`.
 */
async function resolveStableAgentId(dataDir: string): Promise<string> {
  const identityPath = join(dataDir, 'agent-identity.json')
  try {
    const text = await readFile(identityPath, 'utf8')
    const parsed = JSON.parse(text) as { id?: unknown }
    if (typeof parsed.id === 'string' && parsed.id.length > 0) {
      return parsed.id
    }
  } catch {
    // file doesn't exist or is corrupt — fall through to creation
  }
  const id = `qiongqi:${randomUUID()}`
  try {
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      identityPath,
      JSON.stringify({ id, createdAt: new Date().toISOString() }, null, 2),
      'utf8'
    )
  } catch {
    // Best-effort persistence — id is still returned in-memory.
  }
  return id
}

/**
 * Best-effort provider label derived from the bind host. This is only
 * a hint for discovery UIs; the authoritative model info lives in the
 * runtime capability manifest.
 */
function deriveProviderFromHost(host: string): string {
  // The host is the *bind* address, not the upstream provider, so we
  // can't infer the real provider from it. Use a neutral label and
  // let the capability manifest carry the details.
  return `qiongqi@${host}`
}
