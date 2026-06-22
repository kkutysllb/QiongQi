# @qiongqi/ports

> Hexagonal 端口层：所有外部依赖的抽象接口。Engine 永不依赖具体实现。
> Layer 2 — 依赖：`@qiongqi/contracts`、`@qiongqi/domain`。被 Layer 4-9 全部包消费。

---

## 中文

### 1. 职责

`@qiongqi/ports` 是 Qiongqi 严格六边形架构（Ports & Adapters）的**端口层**。它定义了 Engine 与外部世界交互的所有抽象：

- **模型推理**（`ModelClient`）
- **工具执行宿主**（`ToolHost`）
- **持久化**（`ThreadStore` / `SessionStore`）
- **事件分发**（`EventBus`）
- **人机门控**（`ApprovalGate` / `UserInputGate`）
- **工作区 / 时间 / ID / Web** 等小型工具接口

**关键设计**：

- Engine 与 Services 通过这些接口与外部交互，**永不**直接依赖具体实现
- 测试用 `InMemory*` 系列注入；生产用 `File*` / `Hybrid*` 注入（见 `@qiongqi/adapter-storage`）
- 文件夹本身不依赖任何 `@qiongqi/*` 包的下层（除 `domain` 用于 `ApprovalRequest` 等实体）

### 2. 公共 API

#### 模型与流

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ModelClient` | interface | `model-client.ts` | `provider` + `model` + `stream(request)` 端口 |
| `ModelRequest` | type | `model-client.ts` | 单次请求：prefix（immutable）+ history（mutable）+ tools + 各种可选控制 |
| `ModelStreamChunk` | type | `model-client.ts` | 7 种 chunk 的可辨识联合：`assistant_text_delta` / `assistant_reasoning_delta` / `tool_call_delta` / `tool_call_complete` / `usage` / `completed` / `error` |
| `ModelInputAttachment` / `ModelTextAttachmentFallback` | type | `model-client.ts` | 视觉/文本双通道附件 |
| `ModelToolSpec` | type | `model-client.ts` | 工具 schema，含 `toolKind` 标记 |

#### 工具宿主

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ToolHost` | interface | `tool-host.ts` | 工具执行宿主：`id` + `listTools(context)` + `execute(call, context, onUpdate)` + 可选 `clearReadTracker` |
| `ToolHostContext` | type | `tool-host.ts` | 工具调用的依赖包：threadId/turnId/workspace/mode/guiPlan/model/skills/.../approvalPolicy/abortSignal/awaitApproval/awaitUserInput |
| `ToolCallLike` | type | `tool-host.ts` | 工具调用：callId + toolName + providerId? + toolKind? + arguments |
| `ToolExecutionUpdate` / `ToolHostResult` | type | `tool-host.ts` | 增量更新 + 终态结果 |
| `ToolProviderKind` / `ToolProviderPolicy` | type | `tool-host.ts` | 工具来源（`built-in` / `mcp` / `web` / `skill` / `memory` / `gui` / `delegation`）+ 启用状态 |
| `GuiPlanContext` | type | `tool-host.ts` | GUI 计划上下文（`operation` / `workspaceRoot` / `relativePath` / `planId`）|

#### 持久化

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ThreadStore` | interface | `thread-store.ts` | 线程 CRUD（`list` / `get` / `upsert` / `delete`）|
| `ThreadStoreListOptions` | type | `thread-store.ts` | 列表查询选项（`limit` / `search` / `includeArchived` / `archivedOnly` / `includeSide`）|
| `SessionStore` | interface | `session-store.ts` | 三流（events / items / session 投影）+ `highestSeq` / `resetMemory` |
| `EventBus` | interface | `event-bus.ts` | `publish` + `subscribe` + `snapshotSince` + `highestSeq` + `reset` |
| `RuntimeEventSubscriber` | type | `event-bus.ts` | 订阅者类型别名 |

#### 人机门控

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ApprovalGate` | interface | `approval-gate.ts` | 阻塞 `request(approval) → 'allow' \| 'deny'` + 外部 `decide(id, decision)` |
| `UserInputGate` | interface | `user-input-gate.ts` | 结构化 GUI 输入请求：`request` 阻塞 + 外部 `resolve` |
| `UserInputRequest` / `UserInputResolution` / `UserInputQuestion` / `UserInputAnswer` / `UserInputOption` | type | `user-input-gate.ts` | 用户输入完整数据模型 |

#### 工具接口

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `WorkspaceInspector` | interface | `workspace-inspector.ts` | `status(workspace) → WorkspaceStatus`（git 信息或 null）|
| `Clock` / `systemClock` | interface / const | `clock.ts` | 时间抽象（`now` / `nowIso` / `nowMs`）+ 默认 `Date.now` 实现 |
| `IdGenerator` | interface | `id-generator.ts` | `next(prefix) → string` |
| `RandomIdGenerator` / `SequentialIdGenerator` | class | `id-generator.ts` | 两种内置实现（随机 / 顺序）|
| `WebProvider` | interface | `web-provider.ts` | 可选 `fetch?` + `search?` |
| `UnavailableWebProvider` / `DeterministicWebProvider` | class | `web-provider.ts` | 默认 "不可用" + 测试用 Map 驱动实现 |
| `WebSource` / `WebFetchRequest` / `WebFetchResult` / `WebSearchRequest` / `WebSearchResult` | type | `web-provider.ts` | Web 抓取/搜索完整数据模型 |
| `sourceIdFor` | function | `web-provider.ts` | 字符串 → `web_<kind>_<hash>` id 助手 |

### 3. 关键不变量

- **`prefix` vs `history` 严格分离**：`ModelRequest.prefix` 是 immutable prefix 数组（byte-stable），`history` 是动态历史。Engine 消费方应**只**把 prefix 单独发送给 provider 以命中 prompt cache（`model-client.ts:39-40`）。
- **`modeInstruction` 在 prefix 内但非 byte-stable**：`modeInstruction` 是可选的"模式级"系统指令（Plan 模式等），源码注释："emitted as a second system message immediately after the byte-stable `systemPrompt` so the cached prefix stays unchanged while the mode note still rides at the front of the request."（`model-client.ts:27-33`）
- **`contextInstructions` 严格在 prefix 外**：`contextInstructions` 是动态 per-turn 指令（活跃技能指引、内存注入等），源码注释明确"intentionally outside the immutable prefix"（`model-client.ts:34-38`）。
- **`requiredToolName` 是 GUI 兜底**：当 GUI 开启 Plan 模式时，Engine 通过 `requiredToolName: 'create_plan'` 强制 provider 给出工具调用；如只给纯文本，continuation policy 会合成 tool_call（`model-client.ts:46-49`）。
- **ToolHost 列表按 context 过滤**：源码注释："Tool hosts MAY scope the list by mode/GUI plan context (e.g. only expose `create_plan` during plan turns)"（`tool-host.ts:117-123`）。
- **`abortSignal` 是每个工具的硬约束**：每个 `ToolHostContext` 都携带 `abortSignal`；abort 必须在 `awaitUserInput` 路径上传播（reject with `'cancelled while awaiting user input'`）。
- **`awaitApproval` 阻塞返回 `'allow' \| 'deny'`**：ToolHost 通过该回调阻塞等待外部审批决策（`tool-host.ts:84-85`）。
- **EventBus 同步 in-memory**：`publish` 是同步调用；`subscribe` 立即收到（`event-bus.ts:8-15`）；SSE 重连通过 `snapshotSince(seq)` 补偿。
- **SessionStore 三流独立**：`appendEvent` / `appendItem` / `loadSession` 分别走不同路径，文件实现时通常一个 JSONL events + 一个 session.json（`session-store.ts:13-31`）。
- **`highestSeq` 返回 0 当无事件**：未录制过任何事件的线程返回 `0`（`session-store.ts:28`）——这是 SSE 重连 seq 比较的基线。
- **`resetMemory` 不动磁盘**：仅清空 in-memory 状态；磁盘数据保留（`session-store.ts:30`）。
- **RandomIdGenerator 用 `Math.random`**：默认实现基于 `Math.random`（`id-generator.ts:11`）；测试场景应注入确定性随机源。
- **sourceIdFor 用 djb2 风格哈希**：`sourceIdFor` 是 32-bit rolling hash，碰撞概率低（`web-provider.ts:99-105`）。

### 4. 行为规约

来自 `tests/ports.test.ts` 的 `it()` 行为描述：

#### ModelClient

- `streams the full assistant text delta + completed chunk sequence for a chat completion`
- `propagates the abort signal to the model request`
- `forwards tools verbatim into the model request payload`
- `routes tool_call_delta into a final tool_call_complete chunk with canonicalized arguments`

#### ToolHost

- `lists tools scoped to the turn context and merges overrides from the registry`
- `threads the approval policy + gui plan context into every call`
- `awaits the approval decision before returning the tool result`
- `clears the read tracker when the host requests it`

#### SessionStore / EventBus / Stores

- `assigns monotonically increasing seq numbers per thread`
- `recovers from JSONL corruption by skipping malformed lines and continuing the read`
- `preserves order across append + load` (Round-trip)

#### ApprovalGate / UserInputGate

- `blocks on request until decide/resolve is called externally`
- `expires pending approvals when the turn is aborted`
- `resolves user input with `cancelled` status when the turn is aborted`

#### Clock / IdGenerator

- `systemClock.now / nowIso / nowMs return monotonic non-decreasing values`
- `RandomIdGenerator produces unique ids with the given prefix`
- `SequentialIdGenerator produces deterministic ids with the given prefix`

### 5. 使用示例

```typescript
import type {
  ModelClient,
  ModelRequest,
  ModelStreamChunk,
  ToolHost,
  ToolHostContext,
  ToolCallLike,
  EventBus,
  ApprovalGate,
} from '@qiongqi/ports'

// 1. ModelClient 消费方（典型为 PromptBuilder 内部）
async function streamFirstText(client: ModelClient, request: ModelRequest): Promise<string> {
  let text = ''
  for await (const chunk of client.stream(request)) {
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'completed') break
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  return text
}

// 2. ToolHost 消费方（典型为 ToolCallCoordinator 内部）
async function execute(host: ToolHost, call: ToolCallLike, ctx: ToolHostContext) {
  const result = await host.execute(call, ctx)
  return result.item
}

// 3. EventBus 订阅
const unsubscribe = bus.subscribe('thread_1', (event) => {
  console.log(event.kind, event.seq)
})
// 之后：bus.publish({ ... } as RuntimeEvent)
// 重连补偿：const events = bus.snapshotSince('thread_1', sinceSeq)

// 4. ApprovalGate 等待
const decision = await gate.request(approval) // blocks until external decide()
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#2-架构总览`](../architecture.zh.md#2-架构总览)（§2.2 Turn 数据流）
- 具体实现：`@qiongqi/adapter-storage` 提供所有 `InMemory*` / `File*` / `Hybrid*` 适配；`@qiongqi/adapter-model` 提供 `ModelClient` 适配；`@qiongqi/adapter-tools` 提供 `LocalToolHost`
- 源文件：[`model-client.ts`](../../packages/ports/src/model-client.ts)、[`tool-host.ts`](../../packages/ports/src/tool-host.ts)、[`session-store.ts`](../../packages/ports/src/session-store.ts)、[`thread-store.ts`](../../packages/thread-store.ts)、[`event-bus.ts`](../../packages/ports/src/event-bus.ts)
- 测试：[`../../tests/ports.test.ts`](../../tests/ports.test.ts)

---
