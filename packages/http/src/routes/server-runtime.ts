import type { ThreadService } from '@qiongqi/services'
import type { TurnService } from '@qiongqi/services'
import type { UsageService } from '@qiongqi/services'
import type { ReviewService } from '../review-service.js'
import type { EventBus } from '@qiongqi/ports'
import type { SessionStore } from '@qiongqi/ports'
import type { ApprovalGate } from '@qiongqi/ports'
import type { UserInputGate } from '@qiongqi/ports'
import type { WorkspaceInspector } from '@qiongqi/ports'
import type { ToolHost, ToolProviderPolicy } from '@qiongqi/ports'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { RuntimeInfoResponse } from '@qiongqi/contracts'
import type { McpServerDiagnostic } from '@qiongqi/adapter-tools'
import type { McpSearchRuntimeDiagnostic } from '@qiongqi/adapter-tools'
import type { WebProviderDiagnostic } from '@qiongqi/adapter-tools'
import type { SkillRuntimeDiagnostics } from '@qiongqi/skills'
import type { SkillPluginDiagnostics } from '@qiongqi/skills'
import type { AttachmentDiagnostics } from '@qiongqi/contracts'
import type { AttachmentStore } from '@qiongqi/attachments'
import type { MemoryDiagnostics } from '@qiongqi/contracts'
import type { MemoryStore } from '@qiongqi/memory'
import type { ReviewTarget } from '@qiongqi/contracts'

export type RuntimeToolDiagnostics = {
  providers: ToolProviderPolicy[]
  mcpServers: McpServerDiagnostic[]
  mcpSearch?: McpSearchRuntimeDiagnostic
  webProviders: WebProviderDiagnostic[]
  skills: SkillRuntimeDiagnostics
  attachments: AttachmentDiagnostics
  memory: MemoryDiagnostics
}

/**
 * Dependencies that the HTTP router needs. Bundled into a single
 * type so callers can compose the runtime from the in-memory or
 * file-backed adapters without leaking concrete types into routes.
 */
export type ServerRuntime = {
  threadService: ThreadService
  turnService: TurnService
  usageService: UsageService
  reviewService?: ReviewService
  eventBus: EventBus
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  workspaceInspector: WorkspaceInspector
  toolHost?: ToolHost
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> | void
  runReview?(input: {
    threadId: string
    turnId: string
    reviewItemId: string
    target: ReviewTarget
    model?: string
  }): Promise<'completed' | 'failed' | 'aborted'> | void
  runtimeToken: string
  insecure: boolean
  allocateSeq: (threadId: string) => number
  nowIso: () => string
  info(): RuntimeInfoResponse
  toolDiagnostics?(): RuntimeToolDiagnostics | Promise<RuntimeToolDiagnostics>
  skills?(): SkillRuntimeDiagnostics | Promise<SkillRuntimeDiagnostics>
  /**
   * v1 plugin diagnostics: same surface as `skills()` plus per-skill
   * `commands`, `contributions`, `permissions`, `category`, and `source`.
   * Renderer surfaces (SkillsView, contribution registry, slash menu) read
   * this to render plugin-declared UI/commands.
   */
  skillsV2?(): SkillPluginDiagnostics | Promise<SkillPluginDiagnostics>
  shutdown?(): Promise<void>
}
