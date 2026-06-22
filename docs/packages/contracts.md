# @qiongqi/contracts

> Zod schema + TypeScript 类型，零依赖基础层。
> Layer 0 — 依赖：仅 `zod`。被全 monorepo 18 个包消费。

---

## 中文

### 1. 职责

`@qiongqi/contracts` 是 Qiongqi 整个 monorepo 的**类型 + 合约**基础层。零依赖（除 `zod`）。其 Zod schema 既是 wire 合约（HTTP/SSE 边界校验）又是 TypeScript 类型源（`z.infer`）。

涵盖领域：

- **Thread / Turn / Item** — 会话/回合/条目的完整数据模型
- **RuntimeEvent** — 31 种事件的可辨识联合（每线程单调 `seq`）
- **PipelineStage** — 11 个 pipeline 阶段（setup / pre_start / input_cached / pre_send / ...）
- **AgentCard / PeerTask / PeerArtifact** — A2A 协议（Stage 2 + 4）
- **UsageSnapshot** — 含 cache hit rate / cost / savings 的完整 token 用量
- **CapabilityManifest** — 运行时能力清单（mcp / web / skills / subagents / memory）
- **Policy / Sandbox / Approval** — 安全策略枚举
- **Config schemas** — 运行时配置 + 默认值 + 系统提示词
- **Errors / SecretRedaction** — 错误码 + 密钥脱敏

### 2. 公共 API

| 文件 | 关键导出 |
|------|---------|
| `threads.ts` (258 行) | `ThreadStatus` / `ThreadMode` / `ThreadRelation`（primary / fork / side）/ `ThreadGoalStatus` / `ThreadGoal` / `ThreadTodoItem` / `ThreadTodoList`（superRefine 强制"至多一个 in_progress"）/ `ThreadRecord` / `ThreadSummary` / `CreateThreadRequest` / `ForkThreadRequest` / `SetThreadGoalRequest` / `SetThreadTodosRequest` / `UpdateThreadRequest` / `ListThreadsResponse` / `DeleteThreadResponse`。常量：`MAX_THREAD_GOAL_OBJECTIVE_CHARS=4_000` / `MAX_THREAD_TODO_CONTENT_CHARS=1_000` / `MAX_THREAD_TODOS=200` |
| `events.ts` (254 行) | `RuntimeEventKind`（31 种事件名）/ `PipelineStage`（11 种阶段）/ 8 个细分子 schema（`ItemEvent` / `ThreadLifecycleEvent` / `TurnLifecycleEvent` / `ApprovalEvent` / `UserInputEvent` / `ToolCallReadyEvent` / `ToolCallFinishedEvent` / `ToolCatalogEvent` / `CompactionEvent` / `GoalEvent` / `TodoEvent` / `UsageEvent` / `PipelineStageEvent` / `ErrorEvent` / `HeartbeatEvent`）/ `RuntimeEvent`（zod discriminatedUnion）/ `RuntimeEventBase`（含 `child` 子代理块）|
| `qiongqi-config.ts` (251 行) | `RuntimeTuningConfig` / `StorageConfig` / `TokenEconomyConfig` / `ModelsConfig` / `ModelsProfileConfig` / `CapabilitiesConfig` / `RuntimeConfig` / `DEFAULT_QIONGQI_MODEL`（`'deepseek-v4-pro'`）/ `expandHomePath` / `buildRuntimeCapabilityManifest` / `mergeRuntimeConfig` |
| `todos.ts` (197 行) | `ThreadTodoList` 完整 schema（与 threads.ts 重复 export，GUI 单独消费用）|
| `agent-identity.ts` (184 行) | `AgentIdentity` / `AgentIdentityFile`（zod schema）/ `SkillSummary`（轻量技能摘要，避免 contracts → skills 循环）|
| `turns.ts` (159 行) | `TurnSchema` / `TurnStatus`（queued / running / completed / failed / aborted）/ `TurnReasoningEffort` / `StartTurnRequest` / `StartTurnResponse` / `SteerTurnRequest` / `InterruptTurnRequest` / `CompactRequest` / `CompactResponse` / `TurnRecord` |
| `items.ts` (147 行) | `TurnItemRole` / `TurnItemStatus` / `TurnItemBase` / 10 种 `*TurnItem` 子 schema / `TurnItem`（zod discriminatedUnion by 'kind'）|
| `usage.ts` (129 行) | `UsageSnapshot` / `DailyUsageCounters` / `DailyUsageBucket` / `DailyUsageTotals` / `DailyUsageResponse` / `ThreadUsageResponse` / `ModelUsageResponse` / `emptyUsageSnapshot()`（`cacheHitRate: null` 表达"未知"）|
| `gui-plan.ts` (126 行) | `GuiPlanContextJson` / `GuiPlanOperation`（draft / refine）/ `GuiPlanArtifact` / `extractGuiPlanTodos` / `mergeGuiPlanTodos` / `isGuiPlanRelativePath` |
| `a2a-artifact.ts` (90 行) | `AgentCard` / `PeerTask` / `PeerArtifact` / `PeerRecord` / `ArtifactSchema` + `mapItemsToArtifacts()`（assistant_text → text/markdown，tool_result → application/json，error → text/plain）|
| `review.ts` (89 行) | `ReviewTarget`（git 工作区 / 文件路径 / 范围）/ `ReviewOutput` / `ReviewItem` |
| `qiongqi-system-prompt.ts` (67 行) | `QIONGQI_SYSTEM_PROMPT`（中性默认）/ `QIONGQI_REVIEW_PROMPT`（code review 默认）|
| `memory.ts` (50 行) | `MemoryRecord` / `MemoryScope`（user / workspace / project）/ `MemoryScopeConfig` / `MemoryQuery` |
| `attachments.ts` (50 行) | `AttachmentMetadata` / `AttachmentKind` / `AttachmentPolicy` / `AttachmentTextFallback` / `AttachmentDiagnostics` |
| `model-endpoint-format.ts` (41 行) | `ModelEndpointFormat`（`chat_completions` / `responses` / `messages`）/ `DEFAULT_MODEL_ENDPOINT_FORMAT`（`chat_completions`）|
| `errors.ts` (40 行) | `QiongqiError` / `QiongqiErrorBody` / `RuntimeErrorSeverity` |
| `secret-redaction.ts` (36 行) | `redactSecret` / `maskSecret` |
| `runtime-info.ts` (25 行) | `RuntimeInfo` / `RuntimeTuningConfig`（与 qiongqi-config.ts 重复 export）|
| `policy.ts` (24 行) | `ApprovalPolicy`（on-request / untrusted / never / auto / suggest）/ `SandboxMode`（read-only / workspace-write / danger-full-access / external-sandbox）/ `DEFAULT_APPROVAL_POLICY='auto'` / `DEFAULT_SANDBOX_MODE='danger-full-access'` |
| `workspace.ts` (18 行) | `WorkspaceInfo` / `WorkspaceEntry` / `ToolProfile` / `ToolProviderKind` |
| `approvals.ts` (15 行) | `ApprovalRequest` / `ApprovalResponse` / `ApprovalDecision`（HTTP 边界 schema）|
| `index.ts` (22 行) | barrel re-export |

### 3. 关键不变量

- **零运行时依赖**：除 `zod` 外，**不**导入任何 `@qiongqi/*` 兄弟包。这保证 Engine 层、Service 层、Adapter 层都可以无环依赖。
- **Zod schema 即类型**：每个 schema 都通过 `z.infer<typeof X>` 暴露同名 `type X`。修改 schema 即修改类型。
- **`discriminatedUnion('kind', [...])`**：`TurnItem` 与 `RuntimeEvent` 都是可辨识联合；上层用 `switch (item.kind)` 配合 TypeScript 严格检查。
- **`superRefine` 强制业务不变量**：
  - `ThreadTodoListSchema.superRefine` 强制"至多一个 `in_progress`"（`threads.ts:81-90`）
  - `SetThreadTodosRequest.superRefine` 同样规则
  - `SetThreadGoalRequest.refine` 强制"必须至少修改一个字段"
  - `UpdateThreadRequest.refine` 强制"必须至少修改一个字段"
- **`RuntimeEventBase.child` 携带子代理上下文**：可选 `child` 块使 A2A / delegation 事件在主线程事件流中能定位到子 run（`events.ts:68-75`）。
- **`UsageSnapshot.cacheHitRate: number | null`**：`null` 明确表示"未知"（cacheHit+cacheMiss=0），**不**是 0；这是 `@qiongqi/cache` 的 `UsageCounter` 与 `addUsage` 共同遵守的契约（`usage.ts:11-30`）。
- **`Policy` 默认值**：`DEFAULT_APPROVAL_POLICY='auto'`（让 provider 自己决定）/ `DEFAULT_SANDBOX_MODE='danger-full-access'`（不限制）。
- **`ModelEndpointFormat` 三种**：对应 `adapter-model` 的 `ModelCompatClient` 的三种 endpoint 格式。
- **SecretRedaction 是工具函数**：不依赖 ports，可在任意层调用。
- **`MAX_THREAD_*` 常量是上限**：goal 4000 字符、todo content 1000 字符、todo list 200 项 —— 这些是给 GUI / Provider 看的硬上限。
- **`QIONGQI_SYSTEM_PROMPT` 是中性默认**：preset-coding 用 `CODING_SYSTEM_PROMPT` 覆盖；`QIONGQI_REVIEW_PROMPT` 是 Review service 的默认。

### 4. 行为规约

来自 `tests/contracts.test.ts` 的 `it()` 行为描述：

#### Thread

- `ThreadSchema accepts the canonical record shape and rejects missing fields`
- `ThreadTodoListSchema rejects multiple in_progress items`
- `ForkThreadRequest defaults relation to 'fork'`
- `SetThreadGoalRequest requires at least one field change`
- `UpdateThreadRequest requires at least one field change`
- `ThreadSummarySchema omits the turns array`

#### Items

- `TurnItem rejects items with an unknown kind`
- `TurnItem validates role, status, and toolKind against the canonical enums`
- `UserTurnItem trims attachmentIds and rejects empty strings`

#### Events

- `RuntimeEvent discriminatedUnion accepts all 31 kinds and rejects unknown ones`
- `RuntimeEventBase.child validates parentThreadId + parentTurnId + childId + childStatus + childSeq when present`
- `PipelineStage covers all 11 stages: setup / pre_start / post_start / input_received / input_cached / input_routed / input_compressed / input_remembered / pre_send / post_send / response_received`

#### Usage

- `UsageSnapshotSchema accepts zero-token snapshots and rejects negative numbers`
- `emptyUsageSnapshot returns cacheHitRate: null (not 0)`
- `DailyUsageResponseSchema validates the from/to timezone boundaries`

#### A2A

- `AgentCardSchema rejects missing id or url fields`
- `PeerTaskSchema requires prompt and accepts optional workspace/model/label`
- `mapItemsToArtifacts emits text/markdown for assistant_text and application/json for tool_result`

#### Config

- `RuntimeConfigSchema accepts a full config with all sub-sections`
- `expandHomePath replaces a leading '~' with the OS home directory`
- `buildRuntimeCapabilityManifest reports each capability section with status/enabled/available/reason`

#### GUI Plan

- `isGuiPlanRelativePath rejects absolute paths and parent traversals`
- `extractGuiPlanTodos / mergeGuiPlanTodos are stable on round-trip`

### 5. 使用示例

```typescript
import {
  ThreadSchema,
  TurnItem,
  UsageSnapshotSchema,
  emptyUsageSnapshot,
  QIONGQI_SYSTEM_PROMPT,
  AgentCard,
  expandHomePath,
  RuntimeConfigSchema,
} from '@qiongqi/contracts'

// 1. Zod 解析 + 类型推断
const thread = ThreadSchema.parse({
  id: 'thread_1',
  title: 'My thread',
  workspace: '/work',
  model: 'deepseek-v4-pro',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  turns: [],
})

// 2. TurnItem discriminatedUnion
const item: TurnItem = {
  kind: 'tool_call',
  id: 'item_tool_1',
  turnId: 'turn_1',
  threadId: 'thread_1',
  role: 'tool',
  status: 'pending',
  createdAt: new Date().toISOString(),
  toolName: 'bash',
  callId: 'call_1',
  toolKind: 'command_execution',
  arguments: { command: 'ls' },
}

// 3. Usage 默认空 snapshot（cacheHitRate: null）
const empty = emptyUsageSnapshot()
// { promptTokens: 0, completionTokens: 0, ..., cacheHitRate: null, turns: 0 }

// 4. 配置扩展
const dataDir = expandHomePath('~/.qiongqi/data') // /Users/<user>/.qiongqi/data

// 5. AgentCard（A2A 协议）
const card: AgentCard = AgentCard.parse({
  id: 'qiongqi:abc123',
  url: 'http://127.0.0.1:8899',
  name: 'Qiongqi Coding',
  version: '1.0.0',
  skills: [],
  capabilities: { /* ... */ },
  model: 'deepseek-v4-pro',
  endpoints: { tasks: '/a2a/tasks' },
})
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 0 零依赖基础层）
- 消费方：**全部 18 个包**通过 `@qiongqi/contracts` 引用数据模型
- 配置文件示例：[`../../config.example.json`](../../config.example.json) — `qiongqi-config.ts` 的运行时实例
- 源文件：[所有 `*.ts`](../../packages/contracts/src/)
- 测试：[`../../tests/contracts.test.ts`](../../tests/contracts.test.ts)（29 个用例，覆盖 Zod schema + 类型边界 + 业务不变量）
