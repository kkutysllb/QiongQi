# Qiongqi 各包说明

> 本文详细说明每个 `@qiongqi/*` 包的职责、核心导出和用法。
>
> English version: [`packages.en.md`](./packages.en.md)

---

## @qiongqi/contracts

**职责**：零依赖基础层，定义所有 HTTP/SSE 接口的 Zod schema 和 TypeScript 类型。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `approvals` | 审批请求/决策 schema |
| `attachments` | 附件上传/下载合约 |
| `capabilities` | 运行时能力清单（`RuntimeCapabilityManifest`） |
| `events` | 运行时事件类型（`RuntimeEvent`） |
| `items` | 消息/工具调用/工具结果条目 |
| `memory` | 记忆条目 schema |
| `policy` | 审批策略枚举 |
| `review` | 代码审查合约 |
| `threads` | 线程 schema（创建/更新/列表） |
| `turns` | 回合 schema（启动/状态） |
| `usage` | token 使用量快照（`UsageSnapshot`） |
| `qiongqi-config` | 运行时配置 schema |
| `qiongqi-system-prompt` | 默认系统提示词 |
| `secret-redaction` | 密钥脱敏工具 |

```typescript
import { ThreadSchema, TurnSchema, UsageSnapshotSchema } from '@qiongqi/contracts'
```

---

## @qiongqi/domain

**职责**：纯领域实体和值对象，不含 I/O 逻辑。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `thread` | `createThreadRecord()` — 线程记录工厂 |
| `turn` | 回合状态机 |
| `item` | 条目类型守卫和构造器（`makeToolResultItem`, `makeApprovalItem`） |
| `event` | 事件类型和 seq 管理 |
| `approval` | `createApprovalRequest()` |
| `usage` | token 聚合逻辑 |
| `runtime-event-reducer` | 事件归约器（事件 → 状态快照） |
| `model-history-repair` | 模型历史修复（畸形消息修正） |

```typescript
import { createThreadRecord, makeToolResultItem } from '@qiongqi/domain'
```

---

## @qiongqi/ports

**职责**：Hexagonal Architecture 的 port 定义，所有外部依赖的抽象接口。

**核心导出**：

| 模块 | 接口 | 用途 |
|------|------|------|
| `model-client` | `ModelClient` | 模型推理客户端 |
| `tool-host` | `ToolHost`, `ToolHostContext` | 工具执行宿主 |
| `thread-store` | `ThreadStore` | 线程持久化 |
| `session-store` | `SessionStore` | 会话事件日志 |
| `event-bus` | `EventBus` | 事件总线（发布/订阅/回放） |
| `approval-gate` | `ApprovalGate` | 审批门控 |
| `user-input-gate` | `UserInputGate` | 用户输入门控 |
| `workspace-inspector` | `WorkspaceInspector` | 工作区信息查询 |
| `web-provider` | `WebProvider` | Web 搜索/抓取接口 |
| `clock` | `Clock` | 时间抽象（测试可注入） |
| `id-generator` | `IdGenerator` | ID 生成器 |

```typescript
import type { ModelClient, ToolHost, ThreadStore } from '@qiongqi/ports'
```

---

## @qiongqi/cache

**职责**：缓存基础设施、不可变前缀、工具指纹、遥测指标。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `immutable-prefix` | `createImmutablePrefix()` — prompt cache 前缀管理 |
| `lru-cache` | `LRUCache` — 基础 LRU 缓存 |
| `ttl-lru-cache` | `TTLCache` — TTL + LRU 双策略缓存 |
| `prefix-volatility` | 前缀波动性分析（哪些 token 不稳定） |
| `tool-catalog-fingerprint` | 工具目录指纹（检测 schema 变化） |
| `cache-telemetry` | 缓存命中率指标 |
| `usage-counter` | token 使用计数器 |

---

## @qiongqi/loop

**职责**：Agent Loop 核心 — 回合编排、prompt 构建、续行决策、工具协调。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `turn-orchestrator` | `TurnOrchestrator` — 回合编排器（中央循环） |
| `prompt-builder` | `PromptBuilder` — prompt 组装（系统/上下文/工具/历史） |
| `model-step-runner` | `ModelStepRunner` — 模型推理步骤执行器 |
| `continuation-policy` | `ContinuationPolicy` — 停止/继续/失败/计划决策 |
| `tool-call-coordinator` | `ToolCallCoordinator` — 工具调用分发与并发控制 |
| `context-compactor` | `ContextCompactor` — 上下文压缩（软/硬阈值） |
| `token-economy` | token 经济（工具描述/结果压缩） |
| `tool-storm-breaker` | 工具风暴抑制（防止同回合重复调用） |
| `inflight-tracker` | `InflightTracker` — inflight 工具调用跟踪 |
| `steering-queue` | `SteeringQueue` — 运行时转向消息队列 |
| `auto-model-router` | 自动模型路由（根据任务选择模型） |

---

## @qiongqi/services

**职责**：应用服务层 — 线程/回合/用量的业务逻辑封装。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `thread-service` | `ThreadService` — 线程 CRUD + Fork/Side |
| `turn-service` | `TurnService` — 回合启动/状态管理 |
| `usage-service` | `UsageService` — token 用量聚合与查询 |
| `runtime-event-recorder` | `RuntimeEventRecorder` — 运行时事件记录器 |

---

## @qiongqi/adapter-model

**职责**：模型客户端适配器（OpenAI 兼容 API）。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `deepseek-compat-model-client` | `DeepSeekCompatModelClient` — OpenAI 兼容客户端（计划重命名为 `ModelCompatClient`） |
| `deepseek-pricing` | DeepSeek 模型定价表 |
| `model-error-probe` | 模型错误探测（分类重试策略） |
| `tool-argument-repair` | 工具参数修复（JSON 畸形修正） |

---

## @qiongqi/adapter-storage

**职责**：存储适配器实现 + 内存适配器。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `file-thread-store` | `FileThreadStore` — JSON 文件线程存储 |
| `file-session-store` | `FileSessionStore` — JSONL 追加式事件日志 |
| `hybrid-thread-store` | `HybridThreadStore` — SQLite 索引 + JSONL |
| `hybrid-session-store` | `HybridSessionStore` — SQLite + JSONL 混合 |
| `in-memory-thread-store` | `InMemoryThreadStore` — 内存实现（测试用） |
| `in-memory-session-store` | `InMemorySessionStore` — 内存实现 |
| `in-memory-event-bus` | `InMemoryEventBus` — 内存事件总线 |
| `in-memory-approval-gate` | `InMemoryApprovalGate` — 内存审批门 |
| `in-memory-user-input-gate` | `InMemoryUserInputGate` — 内存用户输入门 |
| `local-workspace-inspector` | `LocalWorkspaceInspector` — 本地工作区检查器 |
| `atomic-write` | `atomicWriteFile()` — 原子写入 |

---

## @qiongqi/adapter-tools

**职责**：内置工具实现 + MCP provider + 本地工具宿主。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `local-tool-host` | `LocalToolHost` — 工具执行宿主实现 |
| `capability-registry` | `CapabilityRegistry` — 工具能力注册表 |
| `builtin-tools` | `buildBuiltinLocalTools()`, `createTool()` — 工具工厂 |
| `bash` | bash 工具实现 |
| `read` / `edit` / `write` / `grep` / `find` / `ls` | 文件操作工具 |
| `builtin-bash-tool` | `createBashLocalTool()` |
| `builtin-tool-utils` | `shellConfig()`, `resolveExecutable()`, `normalizeToolPath()` 等 |
| `mcp-tool-provider` | MCP 工具 provider（stdio/streamable-http/SSE） |
| `mcp-tool-search` | BM25 工具搜索 |
| `web-tool-provider` | Web 搜索/抓取工具 |
| `delegation-tool-provider` | 子代理委派工具 |
| `memory-tool-provider` | 记忆工具 |
| `goal-tools` / `todo-tools` | 目标/任务管理工具 |
| `create-plan-tool` | 计划物化工具 |

---

## @qiongqi/skills

**职责**：Skill 运行时、插件宿主、技能工具桥接。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `skill-runtime` | `SkillRuntime` — 技能运行时核心 |
| `plugin-host` | `SkillPluginHost` — 技能插件宿主 |
| `skill-tool-provider` | `buildSkillToolProvider()` — 技能工具桥接 |
| `skill-mcp-bridge` | `collectSkillMcpServers()` — 技能 MCP 服务器收集 |
| `skill-command-registry` | `collectCommands()` — 命令注册表 |
| `manifest` | `SkillManifestV1`, `migrateLegacyManifest()` |
| `marketplace` | `MarketplaceClient`, `parseMarketplaceManifest()` |

---

## @qiongqi/memory

**职责**：跨会话记忆存储与上下文注入。

```typescript
import { MemoryStore } from '@qiongqi/memory'
```

---

## @qiongqi/attachments

**职责**：附件管理、图片二进制剥离。

```typescript
import { AttachmentStore } from '@qiongqi/attachments'
```

---

## @qiongqi/delegation

**职责**：子代理委派运行时、并发控制。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `delegation-runtime` | `DelegationRuntime` — 委派运行时 |
| `child-agent-executor` | `ChildAgentExecutor` — 子代理执行器 |

---

## @qiongqi/http

**职责**：HTTP/SSE 服务器、路由、鉴权、运行时工厂。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `runtime-factory` | `startQiongqiServe()` — 运行时工厂（Composition Root） |
| `http-server` | HTTP 服务器核心 |
| `node-http-server` | Node.js HTTP 服务器适配 |
| `router` | `Router` — 路由器 |
| `routes` | `buildRouter()` — 完整路由构建 |
| `auth` | Bearer token 鉴权中间件 |
| `sse` | SSE 流式响应 |
| `review-service` | `ReviewService` — 代码审查服务 |

---

## @qiongqi/cli

**职责**：`qiongqi` 命令行入口。

**核心导出**：

| 模块 | 内容 |
|------|------|
| `serve` | `qiongqi serve` — 启动 HTTP 服务器 |
| `agent-cli` | `qiongqi run` / `chat` / `exec` — 交互式 Agent |
| `cli-options` | CLI 参数解析 |

```bash
qiongqi serve --data-dir ~/.qiongqi/data --api-key $KEY --port 8899
```

---

## @qiongqi/preset-coding

**职责**：编码预设 — 组装软件工程 Agent（系统提示词 + 默认工具 + 技能挂载）。

```typescript
// 阶段 1.4 完成后的目标 API（当前部分实现）
import { createCodingAgent } from '@qiongqi/preset-coding'

const agent = await createCodingAgent({
  dataDir: './data',
  apiKey: process.env.API_KEY,
})
```

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [架构总览](./architecture-overview.zh.md) | 分层设计和核心数据流 |
| [包依赖图](./package-dependencies.zh.md) | 16 个包的精确依赖关系 |
