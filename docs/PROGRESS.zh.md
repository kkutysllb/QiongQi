# Qiongqi 改造进度

> 本文件根据 **四阶段架构改造计划** 追踪所有任务的完成状态。
> 每次完成里程碑或重要变更后必须同步更新。
>
> English version: [`PROGRESS.en.md`](./PROGRESS.en.md)

**最后更新**：2026-06-22
**当前阶段**：阶段 1–3 已完成 ✅，阶段 4 基本完成（跨厂商验证待外部 Agent）

---

## 总体验证基线

| 指标 | 当前值 | 目标 |
|------|--------|------|
| 全量测试 | 433/433 ✅ | 全绿 |
| 包构建 | 18/18 ✅ | 全绿 |
| 端到端（serve + curl） | ✅ | 通过 |

---

## 阶段 1：SDK 抽离 + monorepo 拆包

### 1.1 初始化 monorepo 骨架 ✅

- [x] `pnpm-workspace.yaml` 配置 `packages: ['packages/*']`（旧 `qiongqi/` 已清理删除）
- [x] 根 `package.json` 添加 vitest devDeps 和测试脚本
- [x] 根级 `vitest.config.ts` 配置 `@qiongqi/*` alias 映射
- [x] 各包 `tsconfig.json` + `tsconfig.build.json` 配置 paths 映射
- [x] `scripts/flatten-dist.mjs` 后处理脚本（拍平嵌套 dist 输出）

### 1.2 包划分（18 个包）✅

175 个源文件 + 5 个 CLI 文件迁移完成，全部 import 重写为 `@qiongqi/*` 格式。

| 包名 | 职责 | 构建 | 状态 |
|------|------|------|------|
| `@qiongqi/contracts` | Zod schema + 类型（零依赖基础层） | ✅ | 完成 |
| `@qiongqi/domain` | Thread/Turn/Item/Event 实体 | ✅ | 完成 |
| `@qiongqi/ports` | ModelClient/ToolHost/Stores 接口 | ✅ | 完成 |
| `@qiongqi/cache` | LRU/TTL/ImmutablePrefix | ✅ | 完成 |
| `@qiongqi/loop` | TurnOrchestrator/PromptBuilder/Policy + EventedOrch | ✅ | 完成 |
| `@qiongqi/services` | Thread/Turn/Usage/Review 服务 | ✅ | 完成 |
| `@qiongqi/adapter-model` | ModelCompatClient | ✅ | 完成 |
| `@qiongqi/adapter-tools` | bash/read/edit/grep + MCP provider | ✅ | 完成 |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite 存储 | ✅ | 完成 |
| `@qiongqi/skills` | SkillRuntime + PluginHost | ✅ | 完成 |
| `@qiongqi/memory` | MemoryStore + provider | ✅ | 完成 |
| `@qiongqi/attachments` | AttachmentStore | ✅ | 完成 |
| `@qiongqi/adapter-fs` | 纯 FS I/O 工具 | ✅ | 完成 |
| `@qiongqi/tool-infra` | 工具执行基础设施 | ✅ | 完成 |
| `@qiongqi/delegation` | DelegationRuntime + PeerRegistry + SkillRegistry + TaskThreadMap | ✅ | 完成 |
| `@qiongqi/http` | HTTP/SSE server + routes | ✅ | 完成 |
| `@qiongqi/cli` | qiongqi 命令行入口 | ✅ | 完成 |
| `@qiongqi/preset-coding` | 编码预设（系统提示词 + 默认配置） | ✅ | 完成 |

**关键技术决策**：
- `shared`/`prompt`/`config` → 合并入 `contracts`
- `telemetry` → 合并入 `cache`
- `review` → 合并入 `loop`
- `review-service.ts` 从 `services` 移到 `http`（打破 loop↔services 值循环）
- `defaultLocalTools` 改为延迟函数 `getDefaultLocalTools()`（打破 adapter-tools 循环初始化）

### 1.3 关键改造点 ✅

- [x] 系统提示词参数化（`QiongqiServeRuntimeOptions.systemPrompt` + fallback 到 `QIONGQI_SYSTEM_PROMPT`）
- [x] 模型客户端重命名（`DeepseekCompatModelClient` → `ModelCompatClient`，保留旧名别名向后兼容）
- [x] Skills 路径解耦（新增 `skillRoots?: string[]` 参数，移除硬编码 `cwd/qiongqi/skills`）
- [x] Composition Root 拆分：
  - `createCore()` — 存储、事件总线、Thread/Turn/Usage 服务
  - `createModelAdapter()` — ModelCompatClient + 能力配置
  - `createToolMatrix()` — 工具注册表、技能、委派运行时
  - `createAgent()` — 编排循环（TurnOrchestrator 组装）
  - `createQiongqiServeRuntime()` 保留为向后兼容别名
- [x] PricingProvider 抽象层（去 DeepSeek 硬编码）：
  - 新增 `packages/adapter-model/src/pricing/` 子目录
  - `types.ts`：`PricingProvider` 接口 + `CostEstimate` / `PricingInput` 类型
  - `deepseek-pricing.ts`：`DeepseekPricingProvider` 实现（DeepSeek 官方定价表，非 DeepSeek host 返回 null）
  - `composite-pricing.ts`：`CompositePricingProvider` 组合器（按注册顺序返回首个非 null 估算）
  - `index.ts`：barrel exports + `defaultPricingProvider` 单例
  - `ModelCompatClient` 通过构造参数 `pricingProvider` 注入，默认使用 Composite
  - `mapUsage()` 改用注入的 provider 估算成本/节省
  - 新增 Provider 可实现 `PricingProvider` 并注册到 Composite，无需修改客户端
- [x] 模型客户端文件重命名：
  - `deepseek-compat-model-client.ts` → `model-compat-client.ts`
  - `DeepseekCompatConfig` → `ModelCompatConfig`（保留旧名为别名）
  - `deepseek-pricing.ts` 逻辑迁移到 `pricing/deepseek-pricing.ts`（原文件已删除）

### 1.4 新 API 形状 ✅

- [x] `createHttpServer` 公共 API 实现（拆分 agent 构建 vs HTTP 挂载）：
  - 新增 `createHttpServer(options: { agent, host?, port })`
  - `startQiongqiServe` 重构为 `createAgent` + `createHttpServer` 的组合（向后兼容）
  - `createQiongqiServeRuntime` / `startQiongqiServe` 标记为 `@deprecated`
- [x] JSDoc 文档补全：
  - `createAgent` — 完整 Quick start 示例 + @param/@returns + 子组件引用
  - `createCore` / `createModelAdapter` / `createToolMatrix` — 职责说明 + @param
  - `CoreRuntime` / `ModelAdapter` / `ToolMatrix` 接口 JSDoc
  - `CreateHttpServerOptions` + `createHttpServer` 示例与使用场景
- [x] 修复 `RuntimeInfoResponse` schema 回归（1.3 加入的 `agentName` 字段未同步到 contracts 的 zod schema）

### 1.5 CLI 入口重写 ✅

- [x] CLI 默认走 `createCodingAgent`（preset-coding 组装）：
  - `cli/package.json` 新增 `@qiongqi/preset-coding` 依赖
  - `ServeOptionsSchema` 新增 `preset` 字段（默认 `'coding'`）
  - `SERVE_PRESETS = ['coding', 'generic']` 枚举导出
  - `parseServeOptions` 解析 `--preset` 选项 + `QIONGQI_PRESET` 环境变量
  - `resolveRuntimeFactory(preset)` 统一工厂选择（serve/run/chat/exec 共用）
  - `serve-entry.ts` 改用 `createAgent`/`createCodingAgent` + `createHttpServer` 组合
  - 向后兼容：所有现有参数、环境变量、输出格式、QIONGQI_READY 握手不变
  - 端到端验证：默认 `agentName=Qiongqi Coding`，`--preset generic` → `agentName=Qiongqi`
- [x] `baseUrl` / `apiKey` 改为必填：
  - `ServeOptionsSchema` 中 `apiKey`/`baseUrl` 从 `.default(...)` 改为 `.min(1)`
  - 移除旧的 `https://api.deepseek.com/beta` 默认值
  - `DEFAULT_SERVE_OPTIONS` 排除 `baseUrl`/`apiKey`（无默认值）
  - `parseServeOptionsSafe` 在缺失时给出友好提示（指明 CLI flag / 环境变量 / config 文件三选一）
  - `resolveApiKey`/`resolveBaseUrl` 辅助函数统一来源解析
  - 端到端验证：缺失时退出码 78 + 友好提示；提供后正常启动

### 1.6 测试迁移 ✅

- [x] 53 个测试文件迁移到根 `tests/` 目录
- [x] 所有 import 重写为 `@qiongqi/*` 格式
- [x] `vitest.config.ts` 别名映射（`qiongqi/**` 排除规则已在清理后移除）
- [x] 测试 helper（loop-test-harness, http-server-test-harness）迁移
- [x] `defaultLocalTools` → `getDefaultLocalTools()` 更新
- [x] mock 路径修复（`vi.mock` 路径更新）
- [x] 全量测试 433/433 通过

### 1.7 端到端验证 ✅

- [x] `pnpm -r run build` 全包通过
- [x] `npx vitest run` 全量测试通过
- [x] `qiongqi serve` 启动成功
- [x] `GET /health` 返回 `{"status":"ok"}`
- [x] `POST /v1/threads` 创建线程成功
- [x] `GET /v1/threads` 列表持久化正常
- [x] Auth 中间件工作正常

### 1.7.1 旧单体目录清理 ✅

- [x] `qiongqi/skills/` → 根目录 `skills/`（11 个预设技能）
- [x] `qiongqi/DESIGN.md` → `docs/design-philosophy.zh.md`
- [x] `qiongqi/config.example.json` → 根目录 `config.example.json`
- [x] `qiongqi/scripts/transcript-diff.mjs` → 根目录 `scripts/`
- [x] `pnpm-workspace.yaml` 移除 `'qiongqi'` 条目
- [x] 整个 `qiongqi/` 目录删除（272 个文件，含 181 个冗余源文件 + 42 个冗余测试 + dist/ + node_modules/）
- [x] `tests/builtin-skills.test.ts` 路径修复（`qiongqi/skills` → `skills`）
- [x] 清理后全量测试 433/433 通过 + 端到端验证通过

### 1.8 交付物 ✅

- [x] 18 个独立 npm 包，各自 `package.json` + `tsconfig.json` + `tsconfig.build.json`：
  - 所有包补全顶层 `types: ./dist/index.d.ts`（兼容旧 TS / 工具）
  - 所有包 `exports` 包含 `types` + `import` 双子字段
  - 所有包 `.d.ts` 类型声明文件正确生成（11~71 行不等）
  - `cli` 包新增 `bin: { qiongqi: ./dist/serve-entry.js }` 入口
- [x] `createAgent` / `createHttpServer` 公共 API 文档（JSDoc）见 1.4
- [x] preset-coding 包验证：外部消费模拟测试通过（`createCodingAgent` / `CODING_SYSTEM_PROMPT` / `CODING_PINNED_CONSTRAINTS` 导出正常）
- [x] 全量测试 + 端到端验证通过：
  - 18 包构建全绿 + 433/433 测试全绿 + tsc 0 错误
  - bin 入口启动成功（`agentName=Qiongqi Coding`）
  - Health check / Runtime info / Thread CRUD 全通过

### 1.8.1 adapter-tools 拆分遗留死代码清理 ✅

- [x] 清理 commit 90e2530（adapter-tools 拆分）时遗留的 5 个源文件副本：
  - `packages/adapter-tools/src/edit-diff.ts`（已迁至 `adapter-fs`）
  - `packages/adapter-tools/src/truncate.ts`（已迁至 `adapter-fs`）
  - `packages/adapter-tools/src/file-mutation-queue.ts`（已迁至 `tool-infra`）
  - `packages/adapter-tools/src/output-accumulator.ts`（已迁至 `tool-infra`）
  - `packages/adapter-tools/src/tool-rate-limit.ts`（已迁至 `tool-infra`）
- [x] 仓库内 grep 验证 0 内部引用；`adapter-tools/src/index.ts` 已通过 `export * from '@qiongqi/adapter-fs'` 与 `export * from '@qiongqi/tool-infra'` 重导出，barrel 兼容
- [x] 验证基线保持：18 包构建全绿 + 433/433 测试全绿 + tsc 0 错误

---

## 阶段 2：AgentCard + AgentIdentity ✅

- [x] `AgentCardSchema` 合约定义（`packages/contracts/src/agent-identity.ts`）：
  - `SkillSummarySchema` — 轻量技能摘要（避免 contracts → skills 循环依赖）
  - `AgentCardSchema` — 代理人身份证（id/url/name/version/skills/capabilities/model/endpoints）
  - `PeerRecordSchema` — 本地/远程 peer 记录
  - `PeerTaskSchema` / `PeerArtifactSchema` — A2A 任务与结果类型
- [x] `PeerRegistry` 实现（`packages/delegation/src/peer-registry.ts`）：
  - `LocalPeerHandle` 接口 — 进程内本地 peer 调用
  - `RemotePeerTransport` 接口 — 远程 HTTP peer 传输（由 http 包实现，依赖反转）
  - `PeerRegistry` — 统一 `invokePeer(cardId, task)` 入口
  - `FilePeerStore` — 远程 peer 持久化到 `peers.json`
- [x] `SkillRegistry`（`packages/delegation/src/skill-registry.ts`）：通用技能注册表，技能发现/注册/解绑/查询
- [x] `TaskThreadMap`（`packages/delegation/src/task-thread-map.ts`）：Orchestrator 任务→子Agent线程映射，支持持久化恢复
- [x] `GET /.well-known/agent-card.json` 端点：
  - 无需认证（RFC 8615 discovery 约定）
  - 自动构建或接受显式传入的 AgentCard
  - 稳定 id 持久化到 `<dataDir>/agent-identity.json`
- [x] DelegationRuntime 改造：
  - 可选 `peerRegistry` 注入 — 子代理运行时自动注册到 PeerRegistry
  - `runChild()` 在 peerRegistry 存在时改为 `invokePeer(childCardId, task)` 分发
  - LocalPeerHandle 的 invoke 绑定到真实的 child-agent-executor
  - 子代理 AgentCard 落盘到 `<dataDir>/agents/<id>/card.json`
  - 无 peerRegistry 时行为完全不变（向后兼容）
- [x] A2A 协议实现：
  - `POST /a2a` 端点（认证）— 接收 PeerTask，创建临时 thread 并执行 turn，返回 PeerArtifact
  - `HttpPeerTransport` — `RemotePeerTransport` 的 HTTP 实现（token 解析回调）
  - `createAgent` 注入 `HttpPeerTransport` + `PeerRegistry` 到 runtime
- [x] 跨实例 A2A 闭环验证：
  - AgentCard 发现：两实例各有独立 `qiongqi:<uuid>` id
  - AgentCard 端点返回完整 card（id/url/name/version/model/endpoints/capabilities）
  - `POST /a2a` 任务提交：A→B / B→A 互调端点接收任务、创建 thread、执行 turn、返回 PeerArtifact
  - id 持久化重启不丢失
  - 全量 433/433 测试 + tsc 0 错误

---

## 阶段 3：TurnOrchestrator 事件化 ✅

- [x] 事件化类型体系（`packages/loop/src/turn-event-types.ts`）：
  - `TurnStateV1` — 可序列化 turn 状态（version/threadId/turnId/stepIndex/events/items/status）
  - `TurnStepEvent` — 步级事件联合类型（step:start/prompt:built/model:ran/decision/tools:dispatched 等）
  - `TurnStateSerializer` — 状态持久化接口（save/load/delete/list）
  - `OrchestrationMode = 'classic' | 'evented'` — 双模式枚举
- [x] `FileTurnStateStore`（`packages/loop/src/turn-state-store.ts`）：
  - 基于文件的 `TurnStateSerializer` 实现
  - 落盘到 `<dataDir>/<threadId>/turns/<turnId>/state.json`
- [x] `EventedTurnOrchestrator`（`packages/loop/src/evented-turn-orchestrator.ts`）：
  - 拥有独立的 PromptBuilder/ModelStepRunner/ToolCallCoordinator 实例
  - 实现自己的事件驱动 loop，每步调用共享的 `runOrchestratorStep`
  - 每步前后持久化 `TurnStateV1`，支持崩溃恢复
  - `assembleRuntime` 根据 `orchestrationMode` 条件选择 orchestrator
- [x] `runOrchestratorStep` 共享函数（`packages/loop/src/turn-orchestrator.ts`）：
  - 从 `TurnOrchestrator.runStep` 提取为纯函数
  - 经典和事件化 orchestrator 共用同一套 step 逻辑
- [x] `QiongqiServeRuntimeOptions.orchestrationMode` 灰度选项
  - `classic` 默认，`evented` 走 EventedTurnOrchestrator + FileTurnStateStore
- [x] 全量测试 433/433 通过（classic 模式）
- [x] `TurnEventBus` + `runStepViaEventBus`（`packages/loop/src/turn-event-bus.ts`）：
  - 轻量级进程内事件总线，支持按 `TurnStepEvent.kind` 注册订阅者
  - `runStepViaEventBus` — 事件驱动的 step 执行函数（替代顺序调用）
  - step 边界已发布 `step:start` / `step:end`，订阅者可观察事件化回合边界
  - `EventedTurnOrchestrator` 支持 `TurnEventBus` 注入，双模式运行
- [x] 端到端恢复验证（kill -9 + 重启恢复）：
  - evented 模式 + 真实模型执行 turn 正常
  - 模拟崩溃：保存 state.json（stepIndex=1），重启后从断点恢复
  - turn 完成后 state 自动清理
  - 全量 433/433 测试 + tsc 0 错误
- [x] `scripts/verify-evented-a2a.mjs` 本地双实例验证：
  - 启动本地 fake model + 两个 evented Qiongqi HTTP runtime
  - 覆盖 AgentCard 发现、A2A task lifecycle、artifacts、SSE subscribe
  - 验证 evented turn state 在 A2A turn 完成后清理

---

## 阶段 4：A2A 协议端点 🔄

> 注：Qiongqi 内部两实例 A2A 互调验证已在阶段 2 完成（AgentCard 发现 → POST /a2a → PeerArtifact）；
> 跨厂商互操作验证暂无外部 Agent 作为基准。

- [x] `A2ATaskRecord` 数据模型（`packages/http/src/a2a-task-model.ts`）
  - 任务状态：submitted → working → completed/failed/cancelled
- [x] `FileA2ATaskStore`（`packages/http/src/a2a-task-store.ts`）
  - 持久化到 `<dataDir>/a2a-tasks/<id>.json`
- [x] A2A 端点升级：
  - `POST /a2a/tasks` — 创建任务、启动后台 turn、快速返回 202 + task
  - `GET /a2a/tasks/{id}` — 查询任务状态
  - 旧 `POST /a2a` 保持同步兼容，返回旧 PeerArtifact 语义
- [x] `ServerRuntime.a2aTaskStore` 注入
- [x] `POST /a2a/tasks/{id}/cancel` — 取消待处理/运行中任务，并通过 runtime hook 中断关联 turn；后台完成不会覆盖 cancelled 终态
- [x] `GET /a2a/tasks/{id}/artifacts` — 从任务关联 thread 获取 turn items
- [x] `GET /a2a/tasks/{id}/subscribe` — SSE 事件流（已完成立即推送，进行中轮询+eventBus 订阅）
- [x] `ArtifactSchema` + `mapItemsToArtifacts()` — A2A Artifact ↔ TurnItem 桥接（`packages/contracts/src/a2a-artifact.ts`）
  - assistant_text→text/markdown, tool_result→application/json, error→text/plain
  - a2aCreateTask 响应含 `artifacts` 数组
- [x] `HttpPeerTransport` 兼容旧 `PeerArtifact` 响应与 Stage 4 `{ task, artifact, artifacts }` 响应
- [ ] `A2APeerAdapter` — 已由 HttpPeerTransport 覆盖
- [ ] 跨厂商互操作验证（移入 P2：需要真实外部 peer/厂商对端）
- [x] 端到端跨实例协作验证（本地 fake model 双实例；外部 peer 仍需真实对端）

## P1：生产运行面 🔄

- [x] `GET /ready` 就绪检查：
  - 无需鉴权，区别于 `/health` 的 liveness
  - 暴露 storage degraded 状态，hybrid SQLite fallback 可见
- [x] `GET /v1/runtime/metrics` 运行指标：
  - Bearer 鉴权
  - 默认 JSON，支持 `?format=prometheus` / `Accept: text/plain` 导出 Prometheus text
  - 汇总 token/cache usage、A2A task 状态计数、storage diagnostics
- [x] `HybridThreadStore.diagnostics()`：
  - 暴露 `backend=hybrid`、SQLite path、SQLite 可用性与 fallback reason
  - runtime factory 注入 `ServerRuntime.storageDiagnostics`
- [x] 结构化日志 / request id：
  - `dispatchRequest` 自动生成或复用 `x-request-id`，并回写响应头
  - `startNodeHttpServer` / `createHttpServer` 支持 `accessLog` sink，输出无敏感 header 的结构化 access log
- [x] Prometheus exporter：
  - `/v1/runtime/metrics?format=prometheus` 导出 `qiongqi_usage_*`、`qiongqi_cache_hit_rate`、`qiongqi_a2a_tasks_total`、`qiongqi_storage_degraded`
- [x] CI 与生产部署说明：
  - GitHub Actions 覆盖 SQLite native binding build+verify、typecheck、fast tests、build、flatten、evented A2A
  - `docs/deployment.zh.md` 记录探针、Prometheus scrape、hybrid storage gate、结构化日志与 A2A 验证
  - 提供 `Dockerfile`、`docker-compose.yml`、Kubernetes manifest 与 Prometheus alert rules
- [x] Trace id / OpenTelemetry-compatible propagation:
  - 支持 W3C `traceparent` 透传
  - access log 输出 `traceparent`、`traceId`、`spanId`，可接入 OTel collector/logger

## P2：跨实例互操作与可观测性深化

- [ ] 真实外部 A2A peer / 跨厂商互操作验证：
  - 复用 `pnpm run verify:evented-a2a -- --external-peer`
  - 需要 `QIONGQI_A2A_PEER_URL` / `QIONGQI_A2A_PEER_TOKEN` 指向真实对端
- [ ] 完整 OpenTelemetry SDK exporter：
  - 在已具备 `traceparent` 传播基础上补 span lifecycle/exporter

| `@qiongqi/adapter-fs` | 文件系统基础能力（read/write/edit/grep/find/ls/bash） | ✅ | 新增 |
| `@qiongqi/tool-infra` | 工具执行基础设施（hooks/rate-limit/mutation-queue） | ✅ | 新增 |
