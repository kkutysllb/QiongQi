# @qiongqi/http — Composition & Routes

> `createAgent` / `createQiongqiServeRuntime` / `createHttpServer` —— Composition Root；ReviewService；18 个 route handlers。
> Layer 8 — 依赖：所有下层包。

---

## 中文

### 1. 职责

`@qiongqi/http` 的"组合"与"路由"部分：

- **`createQiongqiServeRuntime(options)`** —— **唯一 Composition Root**。按四步装配：`createCore` + `createModelAdapter` + `createToolMatrix` + `createAgent`
- **`createHttpServer({ agent, host, port, accessLog? })`** —— 在 runtime 上挂 HTTP 监听，可注入结构化 access log sink
- **`startQiongqiServe` (deprecated alias)** —— 老式入口，向后兼容
- **`ReviewService`** —— 隔离的 code-review 子服务（独立只读工具 + 独立 turn）
- **18 个 route handlers** —— 所有 HTTP 端点

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `QiongqiServeRuntimeOptions` | type | `runtime-factory.ts` | 30+ 配置字段 |
| `QiongqiServeHandle` | type | `runtime-factory.ts` | `{ host, port, server, runtime, close() }` |
| `CoreRuntime` | type | `runtime-factory.ts` | 存储 + 服务 + EventBus |
| `ModelAdapter` | type | `runtime-factory.ts` | ModelCompatClient + 能力 |
| `ToolMatrix` | type | `runtime-factory.ts` | CapabilityRegistry + LocalToolHost + Skills + Delegation |
| `createCore` | function | `runtime-factory.ts` | 内部：构造 core |
| `createModelAdapter` | function | `runtime-factory.ts` | 内部：构造 model adapter |
| `createToolMatrix` | function | `runtime-factory.ts` | 内部：构造 tool matrix |
| `createAgent` | function (async) | `runtime-factory.ts` | **公共 API**：4 步装配完整 runtime |
| `createQiongqiServeRuntime` | function (async) | `runtime-factory.ts` | `createAgent` 别名（向后兼容）|
| `startQiongqiServe` | function (async) | `runtime-factory.ts` | **@deprecated**：`createAgent` + `createHttpServer` 组合 |
| `createHttpServer` | function (async) | `runtime-factory.ts` | 在 runtime 上挂 HTTP 监听 |
| `seedUsageCarryover` | function | `runtime-factory.ts` | 从 JSONL 历史重建 UsageCounter |
| `ServerRuntime` | type | `routes/server-runtime.ts` | `createAgent` 返回的 runtime 形状 |
| `buildRouter(runtime)` | function | `routes/index.ts` | 组装全部 18 个 route handlers |
| `ReviewService` / `ReviewServiceDeps` | class / type | `review-service.ts` | 隔离 review 子服务 |

#### 18 个 route handlers（`routes/*.ts`）

| 文件 | 端点 |
|------|------|
| `health.ts` | `GET /health` + `GET /ready` |
| `agent-card.ts` | `GET /.well-known/agent-card.json` |
| `a2a.ts` | `POST /a2a` + Stage 4 端点 |
| `runtime-info.ts` | `GET /v1/runtime/info` + `/tools` + `/metrics` |
| `skills.ts` | `GET /v1/skills` |
| `attachments.ts` | `POST/GET /v1/attachments` |
| `memory.ts` | `GET/POST/PATCH/DELETE /v1/memory` |
| `workspace.ts` | `GET /v1/workspace/status` |
| `threads.ts` | 完整 threads CRUD + fork + goal/todos |
| `turns.ts` | `POST /v1/threads/:id/turns` + steer + interrupt + compact |
| `events.ts` | `GET /v1/threads/:id/events`（SSE）|
| `review.ts` | `POST /v1/threads/:id/review` |
| `approvals.ts` | `POST /v1/approvals/:id` |
| `user-inputs.ts` | `POST /v1/user-inputs/:id` |
| `sessions.ts` | `POST /v1/sessions/:id/resume-thread` |
| `usage.ts` | `GET /v1/usage`（按 day/thread/model 分组）|
| `runtime-error.ts` | 错误响应工厂 |
| `server-runtime.ts` | `ServerRuntime` 类型定义 |

### 3. 关键不变量

- **Composition Root 是唯一组装点**：`createAgent` 是 Engine 的 single source of truth。
- **四步装配顺序**（`runtime-factory.ts`）：
  1. `createCore()` —— 存储 + EventBus + Thread/Turn/Usage 服务
  2. `createModelAdapter()` —— `ModelCompatClient` + 能力
  3. `createToolMatrix()` —— CapabilityRegistry + LocalToolHost + Skills + Delegation + Memory + Web + MCP
  4. `createAgent()` —— `TurnOrchestrator`（或 `EventedTurnOrchestrator` if `orchestrationMode='evented'`）组装
- **`seedUsageCarryover` 必跑**：从 `sessionStore.loadEventsSince(threadId, 0)` 重建 `UsageCounter`，否则首次启动的 usage 数字为 0。
- **`ServerRuntime.info()` 必跑**：用于 `QIONGQI_READY` 握手返回启动元信息。
- **`createAgent` 与 preset 正交**：`createCodingAgent` / `createQiongqiServeRuntime` 是不同 `agentName` / `systemPrompt` / `pinnedConstraints` 注入；不引入新基类。
- **A2A POST `/a2a` 同步执行一个 turn**：返回 `task + artifact`；不长期订阅（Stage 4 SSE subscribe 单独）。
- **ReviewService 独立**：`buildReadOnlyBuiltinLocalTools` + 独立 event bus / session store / thread store —— 不污染主线程状态。
- **18 个 routes 顺序注册**：`buildRouter` 按文件顺序注册（agent-card 在 v1 之前）；先匹配的胜出。
- **`/health` 不需鉴权**：`a2a.ts` 和 `health.ts` 是仅有的无 auth 端点。

### 4. 行为规约

来自 `tests/http-server.test.ts`（37 个用例）：

- `GET /health returns 200 with status: ok (no auth)`
- `GET /v1/runtime/info returns defaults when no overrides`
- `GET /v1/runtime/info requires auth`
- `GET /v1/runtime/tools returns provider details with secrets redacted`
- `GET /v1/threads creates, lists with search/filter/limit, archives, deletes`
- `GET /v1/threads/:id hydrates with latest session items`
- `POST /v1/threads/:id/turns starts a turn (202 accepted)`
- `GET /v1/threads/:id/events replays from Last-Event-ID with monotonic seq`
- `POST /v1/threads/:id/review runs ReviewService`
- `POST /v1/approvals/:id resolves the approval`
- `POST /v1/user-inputs/:id resolves user input`
- `POST /v1/threads/:id/fork creates a forked thread with lineage metadata`
- `POST /v1/sessions/:id/resume-thread persists into a new thread`
- `GET /v1/usage returns daily/thread/model aggregations`
- `GET /v1/threads/../events returns SSE with id + event + data + heartbeat`
- `GET /a2a/tasks/:id/subscribe returns SSE with terminal event + done`
- `POST /a2a/tasks creates a task and runs one turn synchronously`
- `POST /a2a/tasks/:id/cancel transitions the task to cancelled`
- `Unknown routes return 404 with code: 'not_found'`

### 5. 使用示例

```typescript
import {
  createAgent, createHttpServer, startQiongqiServe,
  QIONGQI_READY_PREFIX,
} from '@qiongqi/http'

// 1. 现代 API（推荐）
const agent = await createAgent({
  dataDir: '/work/.qiongqi/data',
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseUrl: 'https://api.deepseek.com/beta',
  model: 'deepseek-v4-pro',
  approvalPolicy: 'auto',
  sandboxMode: 'workspace-write',
  insecure: false,
  // ... 其他配置
})

const handle = await createHttpServer({
  agent,
  host: '127.0.0.1',
  port: 8899,
  accessLog: (entry) => console.log(JSON.stringify(entry))
})

// 2. 旧 API（向后兼容）
const handle2 = await startQiongqiServe({
  dataDir: '/work/.qiongqi/data',
  apiKey: process.env.DEEPSEEK_API_KEY!,
  // ...
})

// 3. 启动握手
const info = handle.runtime.info()
console.log(`${QIONGQI_READY_PREFIX}${JSON.stringify({
  service: 'qiongqi',
  mode: 'serve',
  host: handle.host,
  port: handle.port,
  dataDir: info.dataDir,
  model: info.model,
  startedAt: info.startedAt,
})}`)

// 4. Review
const reviewStatus = await handle.runtime.runReview({
  threadId: 'thread_1',
  turnId: 'turn_1',
  reviewItemId: 'item_review_1',
  target: { kind: 'git', base: 'origin/main', head: 'HEAD' },
})
// 'completed' | 'failed' | 'aborted'
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#4-关键架构决策`](../architecture.zh.md#4-关键架构决策)（§4.1 Composition Root）
- 消费方：`@qiongqi/cli/serve-entry.ts` 调用 `createCodingAgent` + `createHttpServer`
- 源文件：[`runtime-factory.ts`](../../packages/http/src/runtime-factory.ts)、[`review-service.ts`](../../packages/http/src/review-service.ts)、[`routes/*.ts`](../../packages/http/src/routes/)
- 测试：[`../../tests/http-server.test.ts`](../../tests/http-server.test.ts)（37 个用例，覆盖所有 routes）
