# Qiongqi 架构总览

> 本文描述 Qiongqi 多 Agent 框架的整体架构、分层设计和核心数据流。
>
> English version: [`architecture-overview.en.md`](./architecture-overview.en.md)

---

## 1. 设计理念

Qiongqi 是一个**领域中立的独立多 Agent 框架**，核心理念：

- **骨架不变，血肉万变** — 引擎层（Loop、Ports、Adapters）与领域层（Skills、Presets）严格分离
- **Cache-first 编排** — 不可变前缀 + 边界受限的 TTL/LRU 缓存，最大化 prompt cache 命中率
- **去中心化** — 不设中央调度寡头，每个 Agent 端到端独立闭环
- **可组合** — 通过 monorepo 多包结构，按需组装能力矩阵

---

## 2. Monorepo 包结构（16 个包）

```
┌─────────────────────────────────────────────────────────┐
│                    preset-coding                         │
│        （编码预设：系统提示词 + 默认工具 + 技能）            │
├─────────────────────────────────────────────────────────┤
│  cli ← http ← delegation ← {skills, memory, attachments} │
│                    ↓                                     │
│         {adapter-model, adapter-tools, adapter-storage}  │
│                    ↓                                     │
│              {loop, services}                            │
│                    ↓                                     │
│              cache ← ports ← domain ← contracts          │
└─────────────────────────────────────────────────────────┘
```

依赖方向严格单向：`contracts ← domain ← ports ← {cache, loop, services} ← adapters ← {skills, memory, attachments, delegation} ← http ← cli ← preset-coding`

---

## 3. 分层架构

### 3.1 合约层（`@qiongqi/contracts`）

零依赖基础层，定义所有 HTTP/SSE 接口的 Zod schema 和 TypeScript 类型：

- Thread / Turn / Item 数据结构
- 事件类型（`RuntimeEvent`）
- 能力声明（`RuntimeCapabilityManifest`）
- 审批 / 用户输入 / 工具调用合约
- 使用量快照（`UsageSnapshot`）

### 3.2 领域层（`@qiongqi/domain`）

纯领域实体和值对象，不含 I/O 逻辑：

- `Thread` — 会话线程
- `Turn` — 单次推理回合
- `Item` — 消息/工具调用/工具结果等条目
- `Event` — 运行时事件
- `Approval` — 审批请求
- `Usage` — token 使用量聚合

### 3.3 端口层（`@qiongqi/ports`）

定义所有外部依赖的抽象接口（Hexagonal Architecture 的 port）：

- `ModelClient` — 模型推理客户端
- `ToolHost` — 工具执行宿主
- `ThreadStore` / `SessionStore` — 持久化存储
- `EventBus` — 事件总线
- `ApprovalGate` / `UserInputGate` — 人机交互门控
- `WorkspaceInspector` — 工作区信息查询

### 3.4 基础设施层

| 包 | 职责 |
|---|------|
| `@qiongqi/cache` | LRU/TTL 缓存、不可变前缀、工具指纹、遥测指标 |
| `@qiongqi/loop` | TurnOrchestrator、PromptBuilder、ContinuationPolicy、ToolCallCoordinator |
| `@qiongqi/services` | ThreadService、TurnService、UsageService、RuntimeEventRecorder |

### 3.5 适配器层

| 包 | 职责 |
|---|------|
| `@qiongqi/adapter-model` | ModelCompatClient（OpenAI 兼容 API 客户端） |
| `@qiongqi/adapter-tools` | 内置工具（bash/read/edit/grep/find/ls/write）+ MCP provider + 本地工具宿主 |
| `@qiongqi/adapter-storage` | 文件/混合/SQLite 存储实现、内存适配器（EventBus/Stores/Gates） |

### 3.6 能力扩展层

| 包 | 职责 |
|---|------|
| `@qiongqi/skills` | Skill 运行时、PluginHost、技能工具桥接、Marketplace 客户端 |
| `@qiongqi/memory` | 跨会话记忆存储、上下文注入 |
| `@qiongqi/attachments` | 附件管理、图片二进制剥离 |
| `@qiongqi/delegation` | 子代理委派运行时、并发控制 |

### 3.7 应用层

| 包 | 职责 |
|---|------|
| `@qiongqi/http` | HTTP/SSE 服务器、路由、鉴权、运行时工厂 |
| `@qiongqi/cli` | `qiongqi` 命令行入口（serve / run / chat / exec） |
| `@qiongqi/preset-coding` | 编码预设（系统提示词 + 默认工具集 + 技能挂载） |

---

## 4. 核心数据流

### 4.1 一个回合（Turn）的完整流程

```
HTTP POST /v1/threads/{id}/turns/start
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ TurnService │ ──→ │   Turn       │ ──→ │  PromptBuilder  │
│   .start()  │     │ Orchestrator │     │ (cache prefix)  │
└─────────────┘     └──────┬───────┘     └────────┬────────┘
                           │                      │
                           ▼                      ▼
                    ┌──────────────┐     ┌─────────────────┐
                    │ ModelStep    │ ←── │  ModelClient    │
                    │ Runner       │     │  (adapter-model)│
                    └──────┬───────┘     └─────────────────┘
                           │
                    ┌──────▼───────┐
                    │ Continuation │
                    │ Policy       │
                    └──────┬───────┘
                           │ (has tool calls?)
                    ┌──────▼───────┐
                    │ ToolCall     │ ──→ ToolHost (adapter-tools)
                    │ Coordinator  │ ──→ MCP / Skills / Delegation
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Context      │ ←── Cache (immutable prefix)
                    │ Compactor    │
                    └──────────────┘
                           │
                    (loop until stop)
                           │
                    ┌──────▼───────┐
                    │ SSE Stream   │ ──→ Client
                    └──────────────┘
```

### 4.2 存储架构

```
ThreadStore (元数据)          SessionStore (事件日志)
    │                              │
    ├── InMemoryThreadStore        ├── InMemorySessionStore
    ├── FileThreadStore            ├── FileSessionStore (JSONL)
    └── HybridThreadStore          └── HybridSessionStore
         (SQLite index +                  (SQLite index +
          JSONL fallback)                  JSONL fallback)
```

---

## 5. 构建系统

### 5.1 TypeScript 配置策略

每个包有两份 tsconfig：

- `tsconfig.json` — 开发/类型检查，包含 `paths` 映射指向其他包的 `src/`
- `tsconfig.build.json` — 构建，输出到 `dist/`，构建后由 `scripts/flatten-dist.mjs` 拍平嵌套结构

### 5.2 测试配置

- 根级 `vitest.config.ts` 统一管理所有包的 alias 映射
- 测试文件集中在根 `tests/` 目录
- 排除 `qiongqi/**` 旧目录避免重复运行

### 5.3 分层测试脚本

```bash
pnpm test:unit        # 快速单元测试（无 I/O）
pnpm test:integration # 集成测试（含存储/HTTP）
pnpm test:fast        # 快速子集（CI 用）
```

---

## 6. 四阶段改造路线

| 阶段 | 目标 | 状态 |
|------|------|------|
| **阶段 1** | SDK 抽离 + monorepo 拆包 | 进行中（1.1-1.2 已完成） |
| **阶段 2** | AgentCard + AgentIdentity | 未开始 |
| **阶段 3** | TurnOrchestrator 事件化 | 未开始 |
| **阶段 4** | A2A 协议端点 | 未开始 |

详细进度见 [`PROGRESS.zh.md`](./PROGRESS.zh.md)。

---

## 7. 相关文档

| 文档 | 内容 |
|------|------|
| [包依赖图](./package-dependencies.zh.md) | 16 个包的精确依赖关系 |
| [各包说明](./packages.zh.md) | 每个包的详细 API 和用法 |
| [改造进度](./PROGRESS.zh.md) | 四阶段计划的完成状态 |
