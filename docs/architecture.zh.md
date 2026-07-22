# Qiongqi 架构

> 穷奇非凶，乃破局之锐。骨架不变，血肉万变。
>
> 文档定位：融合**设计哲学**与**技术架构**的统一文档，是 `README`（入门）和 `PROGRESS`（变更日志）之间的承重层。
>
> **版本说明**：本文档为 18 个 npm 包、阶段 1-3 已完成、阶段 4 基本完成（2026-06-22 基线）的真实状态。
>
> English version: [`architecture.en.md`](./architecture.en.md)

---

## 0. 阅读路径

**谁该读**：Qiongqi 的新贡献者、需要扩展框架能力的开发者、希望理解 Agent 引擎内部机制的研究者。

**按什么顺序读**：

1. **想理解"为什么"** —— §1 设计哲学
2. **想理解"长什么样"** —— §2 架构总览
3. **想理解"包怎么分"** —— §3 包结构
4. **想理解"为什么这么设计"** —— §4 关键架构决策
5. **想"添加新能力"** —— §6 扩展指南
6. **想看"我们走到哪一步"** —— §5 路线图 + 链接到 `PROGRESS.zh.md`

**本文档不涵盖**：
- 详细的变更历史与里程碑（见 `PROGRESS.zh.md`）
- 单包源代码导读（见各包 `src/` + JSDoc 注释）
- 配置文件 schema（见 `config.example.json` + `packages/contracts/src/qiongqi-config.ts`）

---

## 1. 设计哲学

Qiongqi 取意于《山海经》《神异经》《左传》中的"穷奇"——一头"状如虎、有翼、知人言语、敢毁信废忠"的凶兽。我们不把它当作反派，而是把它当作**对中央集权与僵化秩序的反叛原型**。

> 穷奇"毁信废忠，崇饰恶言"——《左传·文公十八年》
> 穷奇"状如虎，有翼，食人"——《山海经·海内北经》
> 穷奇"知人言语，闻人斗辄食直者，闻人忠信辄食其鼻"——《神异经》

它的三句古文，分别映射到引擎的三重主张。

### 1.1 三头凶兽，三重主张

#### 主张 ① —— 打破中央集权的叛逆者

> "毁信废忠"——拒绝忠于单一秩序。

传统 Agent 框架往往依赖一个中央调度器（orchestrator / master agent），所有其他 Agent 都是它的附庸。Qiongqi **拒绝这种寡头模式**：

- 回合编排、工具协调、上下文压缩——每个环节都是可替换的 port/adapter 合约
- 引擎本身（loop + services）只提供"议事规则"，不替业务做决策
- 多 Agent 通过 EventBus / Store / Gate 这套解耦骨架自协商，而非被中央指令驱动
- 子代理以独立 `AgentCard` 身份存在，可被其他实例跨进程寻址

#### 主张 ② —— 独当一面的"虎翼"

> "状如虎，有翼"——单兵闭环作战。

每个 Agent 都是端到端独立的执行单元：

- 单 Agent 可从 prompt 到工具调用到结果返回**闭环完成**，脱离协作网络也能工作
- 每个 thread 拥有独立 `messages.jsonl` + `events.jsonl` + `session.json` 三件套
- 内置工具集（`read` / `bash` / `edit` / `write` / `grep` / `find` / `ls`）+ 内置技能（11 个 `skills/` 目录）构成完整的"感知-决策-执行"闭环
- `LocalToolHost` 不依赖远端调度——在任意 workspace 内可立即作战

#### 主张 ③ —— 懂"人话"的自协商组织

> "知人言语"——听懂彼此的语言，动态评估局势。

多 Agent 之间通过标准化接口自协商，引擎不参与业务决策：

- 引擎与技能体系**完全解耦**——`CapabilityRegistry` 以 provider 形式热插拔 `Skill` / `MCP` / `Web` / `Memory` / `Delegation` 等任意能力源
- 同一套引擎，今天挂载金融技能包就是风控团队，明天挂载 AIGC 技能包就是创意工作室
- **引擎是骨架，技能是血肉**——`preset-coding` 是骨架 + 编码血肉的现成示例，但骨架本身不限于编码

### 1.2 主张 ↔ 架构映射（自评）

| 主张 | 当前实现 | 吻合度 |
| --- | --- | --- |
| ① 去中心化：拒绝中央调度器 | `TurnOrchestrator` 仍是单进程内显式编排（Engine 集中负责 step 推进）；子代理通过 `DelegationRuntime` + `PeerRegistry` 受控派生；`EventedTurnOrchestrator` 已在 Stage 3 引入事件总线（`TurnEventBus`），但单进程内 | ⚠️ **部分吻合**。子代理有自决权、根回合仍由中心协调；跨进程寻址已通过 A2A 协议（Stage 2 + Stage 4）落地 |
| ② 端到端独立：单兵闭环 | 每个 thread 独立事件日志；`buildDefaultLocalTools` 提供完整工具集；`LocalToolHost` 不依赖远端调度；CLI `qiongqi run/chat/exec` 子命令可独立调用 | ✅ **高度吻合** |
| ③ 引擎与技能解耦 | `CapabilityRegistry` / `SkillRuntime` / `SkillPluginHost` / `MCP tool provider` / `Web tool provider` / `Memory tool provider` / `Delegation tool provider` 全部以 provider 热插拔；`skill-mcp-bridge` 把 skill 自身声明的 MCP 服务合并进注册表 | ✅ **完全吻合** |

> 主张 ① 的"⚠️ 部分吻合"是诚实标注——Engine 内部仍是显式 step 推进。`EventedTurnOrchestrator` 把 step 拆为"订阅者协作"是为未来真正的 peer-style 编排打基础，详见 §4.4。

### 1.3 骨架不变，血肉万变

这是 Qiongqi 的**核心运营目标**——**提高每一 token 的 ROI**：

- **避免重复工具 schema**：工具目录指纹（`buildToolCatalogFingerprint`）检测变化，避免 prompt cache 失效
- **避免失控工具输出**：工具风暴抑制（`ToolStormBreaker`）+ 工具参数修复（`tool-argument-repair`）
- **避免畸形历史**：`repairModelHistoryItems` + `healLoadedHistoryItems` 两阶段修复
- **避免无效重试**：续行策略（`ContinuationPolicy`）的 `failed` / `failed_with_error` 区分
- **避免可命中却错过的稳定前缀**：`ImmutablePrefix` + 漂移检测 + prefix verification 三层保护

为支撑这一目标，架构遵守三条硬约束：

1. **引擎层（Loop、Ports、Adapters）与领域层（Skills、Presets）严格分离**——任何业务能力只能作为"血肉"挂载，不能侵入骨架
2. **依赖方向严格单向**——`contracts ← domain ← ports ← {cache, loop, services} ← adapters ← {skills, memory, attachments, delegation} ← http ← cli`，任何循环都必须在 `import type` 层打破
3. **可组合**——通过 monorepo 多包结构按需组装能力矩阵，不强制使用全部 18 个包

---

## 2. 架构总览

### 2.1 分层视图

```
┌─────────────────────────────────────────────────────────┐
│                preset-coding  (领域预设)                  │
│        "骨架 + 编码血肉"：系统提示 + 默认工具 + 技能       │
├─────────────────────────────────────────────────────────┤
│  cli ← http ← delegation ← {skills, memory, attachments} │
│   └─(配置/启动)─   └─(路由/A2A)─   └─(子代理)─   └─(能力)─┤
│                    ↓                                     │
│         {adapter-model, adapter-tools, adapter-storage,  │
│          adapter-fs, tool-infra}                         │
│                    ↓                                     │
│              {loop, services}                            │
│           ↕ (type-only 双向引用)                         │
│                    ↓                                     │
│              cache ← ports ← domain ← contracts          │
└─────────────────────────────────────────────────────────┘
```

依赖方向：每层只依赖下方层；同一层内允许 type-only 循环（如 `loop ↔ services`）。

### 2.2 核心数据流：一个 Turn 的完整生命周期

```
HTTP POST /v1/threads/{id}/turns
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ TurnService │ ──→ │   Turn       │ ──→ │  PromptBuilder  │
│   .start()  │     │ Orchestrator │     │ (immutable      │
└─────────────┘     │  (classic /  │     │  prefix +       │
                    │  evented)    │     │  drift detect)  │
                    └──────┬───────┘     └────────┬────────┘
                           │                      │
                           ▼                      ▼
                    ┌──────────────┐     ┌─────────────────┐
                    │ ModelStep    │ ←── │  ModelClient    │
                    │ Runner       │     │ (adapter-model) │
                    └──────┬───────┘     └─────────────────┘
                           │
                    ┌──────▼───────┐
                    │ Continuation │
                    │ Policy       │  ←─ 纯函数：stop/continue/failed/
                    └──────┬───────┘        materialize_plan/dispatch
                           │ (has tool calls?)
                    ┌──────▼───────┐
                    │ ToolCall     │ ──→ LocalToolHost (adapter-tools)
                    │ Coordinator  │ ──→ MCP / Skills / Delegation
                    │ + Storm      │     / Web / Memory providers
                    │   Breaker    │ ──→ adapter-fs + tool-infra
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Context      │ ←─ soft/hard/aggressive 三档
                    │ Compactor    │     heuristic / model 摘要
                    └──────┬───────┘     + skill pin 保留
                           │
                    (loop until stop)
                           │
                    ┌──────▼───────┐
                    │ RuntimeEvent │ ──→ EventBus.publish() → SSE
                    │  Recorder    │ ──→ SessionStore.appendEvent()
                    └──────────────┘     (回放用, monotonic seq)
```

**关键不变量**：

- `RuntimeEventRecorder` 是**唯一事件生产者**——所有组件产出 draft，recorder 负责分配 `seq`、打 `timestamp`、fan-out、落盘
- `TurnService` 是**唯一 thread/turn/item 状态变更点**——其他组件通过 `applyItem` / `updateItem` / `finishTurn` 写入
- `PromptBuilder.build()` 每次重新组装 prefix，但 `ImmutablePrefix` 通过 SHA-256 指纹保证 `systemPrompt + tools + pinnedConstraints + fewShots` 的 byte-stable

### 2.2.1 Post-P1 运行治理层

Qiongqi 会替换 kk_OClaw 的 `coding_core`，不会借用 LangGraph/LangChain/Python core 作为内部编排合同。kk_OClaw 只作为产品运行面经验来源：其中可复用的安全、预算、路径、记忆、终态治理模式已按 Qiongqi 原生包边界重实现。

- `@qiongqi/tool-infra`：`applyToolResultBudget` 将超大工具结果外置到 outputs，并给模型 head/tail 预览；`auditShellCommand` 在 bash 执行前 block/warn/allow 分类并脱敏 secrets。
- `@qiongqi/attachments` + `@qiongqi/http`：`VirtualPathResolver` 提供 `/mnt/qiongqi/{workspace,uploads,outputs,artifacts}` 虚拟挂载；HTTP artifact route 只读 thread-local uploads/outputs/artifacts。
- `@qiongqi/delegation` + `@qiongqi/http`：terminal-state helper 与 `FileA2ATaskStore` 防止 completed/failed/cancelled/aborted 被 late racing update 覆盖。
- `@qiongqi/memory`：检索升级为中英文 lexical ranking、技术 token 精确匹配、scope filtering、confidence/recency tie-break。

### 2.3 存储与状态架构

```
ThreadStore (元数据)          SessionStore (事件日志)
    │                              │
    ├── InMemoryThreadStore        ├── InMemorySessionStore
    ├── FileThreadStore            ├── FileSessionStore (JSONL)
    └── HybridThreadStore          └── HybridSessionStore
         (SQLite index +                  (SQLite index +
          JSONL fallback)                  JSONL fallback)
                                          ↑
                                   RuntimeEventRecorder
                                   (appendEvent + seq 分配)

FileTurnStateStore (Stage 3 崩溃恢复)
  └── <dataDir>/<threadId>/turns/<turnId>/state.json
        TurnStateV1 = {version, threadId, turnId, stepIndex,
                       events: TurnStepEvent[], items, status}
        用途: kill -9 后 EventedTurnOrchestrator 从 stepIndex 恢复

FileA2ATaskStore (Stage 4 A2A 任务)
  └── <dataDir>/a2a-tasks/<id>.json
        A2ATaskRecord = {id, status: submitted/working/completed/...,
                         threadId, prompt, artifact, artifacts[]}
```

**存储选型原则**：

- **生产环境**：`hybrid`（SQLite 索引 + JSONL 全量日志，Codex-style）— 兼顾索引性能与全量可读
- **调试 / 单机**：`file`（纯 JSONL）— 可直接 `cat` / `jq` 查看
- **测试**：`in-memory`（InMemoryThreadStore / InMemorySessionStore / InMemoryEventBus）— 速度优先
- **崩溃恢复**：Stage 3 引入 `FileTurnStateStore`，仅 `EventedTurnOrchestrator` 启用
- **A2A 任务**：Stage 4 独立存储，任务级生命周期不与 thread 耦合

---

## 3. 包结构（18 个包）

### 3.1 包列表（一句话职责）

| # | 包 | 职责 |
|---|----|------|
| 1 | `@qiongqi/contracts` | Zod schema + TypeScript 类型（零依赖基础层）|
| 2 | `@qiongqi/domain` | Thread / Turn / Item / Event 实体与工厂函数 |
| 3 | `@qiongqi/ports` | ModelClient / ToolHost / Stores / EventBus / Gates 接口（Hexagonal ports）|
| 4 | `@qiongqi/cache` | LRU / TTL 缓存、ImmutablePrefix、工具指纹、遥测 |
| 5 | `@qiongqi/attachments` | AttachmentStore（附件元数据 + 二进制剥离）|
| 6 | `@qiongqi/adapter-fs` | 纯 FS I/O 工具（edit-diff / truncate / fs-types，无 Agent 概念）|
| 7 | `@qiongqi/tool-infra` | 工具执行基础设施（FileMutationQueue / OutputAccumulator / ToolRateLimit）|
| 8 | `@qiongqi/adapter-model` | OpenAI 兼容模型客户端（chat_completions / responses / messages）|
| 9 | `@qiongqi/adapter-storage` | File / Hybrid / SQLite 存储 + 全部 in-memory 适配器 |
| 10 | `@qiongqi/adapter-tools` | 内置工具（bash / read / edit / grep / find / ls / write）+ MCP provider + 本地工具宿主 |
| 11 | `@qiongqi/skills` | SkillRuntime + SkillPluginHost + skill-tool-provider + marketplace |
| 12 | `@qiongqi/memory` | 跨会话 MemoryStore + 上下文注入 |
| 13 | `@qiongqi/loop` | TurnOrchestrator / EventedTurnOrchestrator / PromptBuilder / ContinuationPolicy / ToolCallCoordinator / ContextCompactor / TurnEventBus |
| 14 | `@qiongqi/services` | ThreadService / TurnService / UsageService / RuntimeEventRecorder |
| 15 | `@qiongqi/delegation` | DelegationRuntime / ChildAgentExecutor / PeerRegistry / SkillRegistry / TaskThreadMap |
| 16 | `@qiongqi/http` | HTTP/SSE 服务器、Router、Composition Root (`createAgent` / `createHttpServer`)、A2A endpoints |
| 17 | `@qiongqi/cli` | `qiongqi` 命令行入口（`serve` / `run` / `chat` / `exec`）|
| 18 | `@qiongqi/preset-coding` | 编码预设（系统提示 + 工具矩阵 + 技能挂载）|

### 3.2 依赖层级（Layer 0–10）

```
Layer 0  (零依赖):     contracts
Layer 1:               domain
Layer 2:               ports
Layer 3:               cache, attachments, adapter-fs
Layer 4:               services, loop  ← (互相 type-only 引用，无值循环)
                        tool-infra (依赖 adapter-fs)
Layer 5:               adapter-model, adapter-storage, adapter-tools
Layer 6:               skills, memory
Layer 7:               delegation
Layer 8:               http
Layer 9:               cli
Layer 10:              preset-coding
```

依赖方向严格单向——任何下层 → 上层的引用都视为错误（type-only 引用是唯一例外）。

### 3.3 各包说明（按层级分组）

#### Layer 0 — 零依赖基础层

> 📦 详细技术文档：[`./packages/contracts.md`](./packages/contracts.md) · [`./packages/domain.md`](./packages/domain.md) · [`./packages/ports.md`](./packages/ports.md) · [`./packages/cache.md`](./packages/cache.md) · [`./packages/attachments.md`](./packages/attachments.md)

**`@qiongqi/contracts`** — 零依赖。所有 HTTP/SSE 接口、事件、条目、能力清单、配置、密钥脱敏的 Zod schema 与 TypeScript 类型。

| 模块 | 内容 |
|------|------|
| `approvals` / `attachments` / `capabilities` / `events` / `items` / `memory` / `policy` / `review` / `threads` / `turns` / `usage` | 各类合约 schema |
| `qiongqi-config` | 运行时配置 schema |
| `qiongqi-system-prompt` | 默认系统提示词 |
| `secret-redaction` | 密钥脱敏工具 |

```typescript
import { ThreadSchema, TurnSchema, UsageSnapshotSchema } from '@qiongqi/contracts'
```

#### Layer 1 — 纯领域层

> 📦 详细技术文档：[`./packages/domain.md`](./packages/domain.md)

**`@qiongqi/domain`** — 纯领域实体与值对象，**不含 I/O**。

| 模块 | 内容 |
|------|------|
| `thread` | `createThreadRecord()` 工厂 |
| `turn` | 回合状态机 + `appendTurnItem` / `replaceTurnItem` |
| `item` | 10 种 typed factory（`makeUserItem` / `makeToolResultItem` / `makeApprovalItem` 等）|
| `event` | 事件类型 + `compareEventSeq` |
| `approval` / `usage` | 审批/用量的纯函数 |
| `runtime-event-reducer` | 事件归约器（事件流 → 状态快照，SSE 重放基础）|
| `model-history-repair` | 模型历史修复（畸形消息修正）|

```typescript
import { createThreadRecord, makeToolResultItem } from '@qiongqi/domain'
```

#### Layer 2 — 端口层（Hexagonal）

> 📦 详细技术文档：[`./packages/ports.md`](./packages/ports.md)

**`@qiongqi/ports`** — 所有外部依赖的抽象接口。Engine 永不依赖具体实现。

| 接口 | 用途 |
|------|------|
| `ModelClient` | `stream(request) → AsyncIterable<ModelStreamChunk>`（7 种 chunk 类型）|
| `ToolHost` | 工具执行宿主 + `ToolHostContext` 依赖包 |
| `ThreadStore` / `SessionStore` | 持久化（事件 + 条目 + session 投影）|
| `EventBus` | 同步 in-memory 事件总线（`publish` / `subscribe` / `snapshotSince`）|
| `ApprovalGate` / `UserInputGate` | 人机交互门控（阻塞式 `request` + 外部 `decide`）|
| `WorkspaceInspector` | 工作区 git status 查询 |
| `WebProvider` / `Clock` / `IdGenerator` | 工具接口 + 时间 + ID 抽象（测试可注入）|

```typescript
import type { ModelClient, ToolHost, ThreadStore } from '@qiongqi/ports'
```

#### Layer 3 — 基础设施层

> 📦 详细技术文档：[`./packages/cache.md`](./packages/cache.md) · [`./packages/attachments.md`](./packages/attachments.md) · [`./packages/adapter-fs.md`](./packages/adapter-fs.md) · [`./packages/tool-infra.md`](./packages/tool-infra.md)

**`@qiongqi/cache`** — 缓存基础设施、不可变前缀、工具指纹、遥测。

| 模块 | 内容 |
|------|------|
| `immutable-prefix` | `createImmutablePrefix()` — SHA-256 指纹 + `revision` 计数；`verifyImmutablePrefix()` dev 模式校验 |
| `lru-cache` / `ttl-lru-cache` | 基础 LRU + TTL 双策略缓存 |
| `prefix-volatility` | 前缀波动性分析（UUID / ISO 8601 / hex 哈希检测）|
| `tool-catalog-fingerprint` | 工具目录指纹（检测 schema 变化、破坏性 vs 加性漂移）|
| `cache-telemetry` | 缓存命中率指标 |
| `usage-counter` | token 使用计数器（含 cache hit rate 重算）|

**`@qiongqi/attachments`** — 附件管理。

```typescript
import { AttachmentStore } from '@qiongqi/attachments'
```

**`@qiongqi/adapter-fs`**（阶段 1.8 新增）— **纯 FS I/O 工具，无 Agent 概念**。从 `adapter-tools` 拆出。

| 模块 | 内容 |
|------|------|
| `edit-diff` | fuzzy match + unified patch 生成 |
| `truncate` | `truncateHead` / `truncateTail` + `formatSize` |
| `fs-types` | `FsStats` / `ShellConfig` / `TruncateMode` / `TextSlice` |

**`@qiongqi/tool-infra`**（阶段 1.8 新增）— **工具执行的通用基础设施**。依赖 `adapter-fs`。

| 模块 | 内容 |
|------|------|
| `file-mutation-queue` | 跨进程文件锁（基于 `tmpdir`）|
| `output-accumulator` | UTF-8 / UTF-16LE 检测 + Han 字符检测的输出截断累积器 |
| `tool-rate-limit` | `parseRateLimitedToolResult` 限流结果解析 |

#### Layer 4 — 引擎层

> 📦 详细技术文档：[`./packages/services-event-recorder.md`](./packages/services-event-recorder.md) · [`./packages/services-thread-turn.md`](./packages/services-thread-turn.md) · [`./packages/services-usage.md`](./packages/services-usage.md) · [`./packages/loop-orchestrator.md`](./packages/loop-orchestrator.md) · [`./packages/loop-prompt-and-context.md`](./packages/loop-prompt-and-context.md) · [`./packages/loop-tool-coordination.md`](./packages/loop-tool-coordination.md)

**`@qiongqi/loop`** — Agent Loop 核心——回合编排、prompt 构建、续行决策、工具协调。

| 模块 | 内容 |
|------|------|
| `turn-orchestrator` | `TurnOrchestrator` — 经典编排器（中央循环）|
| `prompt-builder` | `PromptBuilder` — prompt 组装（system / context / tools / history / attachments）|
| `model-step-runner` | `ModelStepRunner` — 模型推理步骤执行器（消费 `AsyncIterable<ModelStreamChunk>`）|
| `continuation-policy` | 纯决策函数：`stop` / `continue` / `failed` / `failed_with_error` / `materialize_plan` / `dispatch` |
| `tool-call-coordinator` | `ToolCallCoordinator` — 工具调用分发（含 storm breaker + parallel-safe batching）|
| `context-compactor` | `ContextCompactor` — soft / hard / aggressive 三档压缩，heuristic + model 双模式 |
| `token-economy` | token 经济（工具描述/结果压缩）|
| `tool-storm-breaker` | 工具风暴抑制（8 窗口阈值 3，turn 级重置）|
| `evented-turn-orchestrator` | `EventedTurnOrchestrator`（Stage 3）— 事件驱动编排器 + 崩溃恢复 |
| `turn-event-bus` | `TurnEventBus`（Stage 3）— 进程内事件总线，按 `TurnStepEvent.kind` 订阅 |
| `turn-state-store` | `FileTurnStateStore`（Stage 3）— 崩溃恢复持久化（`<dataDir>/<threadId>/turns/<turnId>/state.json`）|
| `turn-event-types` | `TurnStateV1` / `TurnStepEvent` / `TurnStateSerializer`（Stage 3）|
| `inflight-tracker` / `steering-queue` / `auto-model-router` | inflight 跟踪 / 转向消息队列 / 自动模型路由 |

**`@qiongqi/services`** — 应用服务层——线程/回合/用量的业务逻辑封装。

| 模块 | 内容 |
|------|------|
| `thread-service` | `ThreadService` — 线程 CRUD + Fork / Side + Goal / Todo 管理 |
| `turn-service` | `TurnService` — 回合启动 / 状态 / 中断 / 转向 / 压缩 / 完成 |
| `usage-service` | `UsageService` — token 用量聚合与查询 |
| `runtime-event-recorder` | `RuntimeEventRecorder` — 唯一事件生产者（分配 seq + Zod 校验 + fan-out + 落盘）|

> **注意**：`loop` 与 `services` 互相依赖，但通过 `import type` 打破值循环。详见 §4.2。

#### Layer 5 — 适配器层

> 📦 详细技术文档：[`./packages/adapter-storage.md`](./packages/adapter-storage.md) · [`./packages/adapter-model-client.md`](./packages/adapter-model-client.md) · [`./packages/adapter-model-pricing.md`](./packages/adapter-model-pricing.md) · [`./packages/adapter-tools-registry.md`](./packages/adapter-tools-registry.md) · [`./packages/adapter-tools-builtin.md`](./packages/adapter-tools-builtin.md) · [`./packages/adapter-tools-providers.md`](./packages/adapter-tools-providers.md)

**`@qiongqi/adapter-model`** — 模型客户端适配器（OpenAI 兼容 API）。

| 模块 | 内容 |
|------|------|
| `model-compat-client` | `ModelCompatClient`（阶段 1.3 从 `DeepseekCompatModelClient` 重命名）— 三种 endpoint 格式：`chat_completions` / `responses` / `messages` |
| `pricing/` | `PricingProvider` 抽象层（`DeepseekPricingProvider` + `CompositePricingProvider`）|
| `model-error-probe` | 模型错误探测（分类重试策略）|
| `tool-argument-repair` | 工具参数修复（JSON 畸形修正）|

**`@qiongqi/adapter-storage`** — 存储适配器实现 + 内存适配器。

| 模块 | 内容 |
|------|------|
| `file-thread-store` / `file-session-store` | JSON 文件 / JSONL 追加式事件日志 |
| `hybrid-thread-store` / `hybrid-session-store` | SQLite 索引 + JSONL 混合（Codex-style）|
| `in-memory-*` | `InMemoryThreadStore` / `InMemorySessionStore` / `InMemoryEventBus` / `InMemoryApprovalGate` / `InMemoryUserInputGate`（测试用）|
| `local-workspace-inspector` | 本地工作区检查器 |
| `atomic-write` | `atomicWriteFile()`（含 win32 fallback）|

**`@qiongqi/adapter-tools`** — 内置工具 + MCP provider + 本地工具宿主。**`adapter-fs` + `tool-infra` 通过 barrel re-export 保持向后兼容**。

| 模块 | 内容 |
|------|------|
| `local-tool-host` | `LocalToolHost` — 工具执行宿主实现 |
| `capability-registry` | `CapabilityRegistry` — 工具能力注册表 |
| `builtin-tools` | `buildBuiltinLocalTools()` / `getDefaultLocalTools()`（**延迟函数**，打破初始化循环）|
| `bash` / `read` / `edit` / `write` / `grep` / `find` / `ls` | 内置文件操作工具 |
| `builtin-bash-tool` | `createBashLocalTool()` + `startBashSession` |
| `builtin-tool-utils` | `shellConfig()` / `resolveExecutable()` / `normalizeToolPath()` / `resolveWorkspacePath()` / `withToolBoundary()` |
| `mcp-tool-provider` | MCP 工具 provider（stdio / streamable-http / SSE 传输）|
| `mcp-tool-search` | BM25 工具搜索（含中文分词）|
| `web-tool-provider` | Web 搜索/抓取工具（域名策略 + sourceId）|
| `delegation-tool-provider` | 子代理委派工具 |
| `memory-tool-provider` | 记忆工具 |
| `goal-tools` / `todo-tools` / `create-plan-tool` | 目标/任务/计划管理工具 |

#### Layer 6 — 能力扩展层

> 📦 详细技术文档：[`./packages/skills.md`](./packages/skills.md) · [`./packages/memory.md`](./packages/memory.md)

**`@qiongqi/skills`** — Skill 运行时、插件宿主、技能工具桥接。

| 模块 | 内容 |
|------|------|
| `skill-runtime` | `SkillRuntime`（v1 旧 runtime）|
| `plugin-host` | `SkillPluginHost`（v2 新 runtime，manifest migration）|
| `skill-tool-provider` | `buildSkillToolProvider()` |
| `skill-mcp-bridge` | `collectSkillMcpServers()` |
| `skill-command-registry` | `collectCommands()` |
| `manifest` | `SkillManifestV1` + `migrateLegacyManifest()` |
| `marketplace` | `MarketplaceClient` + `parseMarketplaceManifest()` |

**`@qiongqi/memory`** — 跨会话记忆存储与上下文注入。

```typescript
import { MemoryStore } from '@qiongqi/memory'
```

#### Layer 7 — 委派与多 Agent 层

> 📦 详细技术文档：[`./packages/delegation-runtime.md`](./packages/delegation-runtime.md) · [`./packages/delegation-registry.md`](./packages/delegation-registry.md)

**`@qiongqi/delegation`** — 子代理委派运行时、并发控制、peer 寻址。

| 模块 | 内容 |
|------|------|
| `delegation-runtime` | `DelegationRuntime` — 委派运行时 |
| `child-agent-executor` | `ChildAgentExecutor` — 子代理执行器 |
| `peer-registry` | `PeerRegistry` + `FilePeerStore`（Stage 2）— Agent peer 注册表 |
| `skill-registry` | `SkillRegistry`（Stage 2）— 通用技能注册表 |
| `task-thread-map` | `TaskThreadMap`（Stage 2）— 任务→子 Agent 线程映射 |

#### Layer 8 — HTTP 服务层

> 📦 详细技术文档：[`./packages/http-transport.md`](./packages/http-transport.md) · [`./packages/http-composition-and-routes.md`](./packages/http-composition-and-routes.md)

**`@qiongqi/http`** — HTTP/SSE 服务器、路由、鉴权、Composition Root。

| 模块 | 内容 |
|------|------|
| `runtime-factory` | `createAgent()` / `createHttpServer()`（阶段 1.4 公共 API）— **Composition Root** |
| `http-server` / `node-http-server` | HTTP 服务器核心 + Node.js 适配 |
| `router` / `routes` | `Router` + `buildRouter()`（完整路由表见 §3.4）|
| `auth` | Bearer token 鉴权中间件 |
| `sse` | SSE 流式响应（含 15s heartbeat）|
| `review-service` | `ReviewService` — 代码审查服务（**从 `services` 迁移而来**，打破值循环）|
| `http-peer-transport` | `HttpPeerTransport`（Stage 2）— A2A HTTP 传输 |
| `a2a-task-model` | `A2ATaskRecord`（Stage 4）— A2A 任务数据模型 |
| `a2a-task-store` | `FileA2ATaskStore`（Stage 4）— A2A 任务持久化 |

#### Layer 9 — CLI 层

> 📦 详细技术文档：[`./packages/cli.md`](./packages/cli.md)

**`@qiongqi/cli`** — `qiongqi` 命令行入口。

| 子命令 | 功能 |
|--------|------|
| `qiongqi serve [options]` | 启动 HTTP/SSE 运行时（默认命令）|
| `qiongqi run [options] <prompt>` | 单次 agent turn，stdout 流式输出 |
| `qiongqi chat [options]` | TTY 交互式（`/exit` / `/quit` 退出）|
| `qiongqi exec [options] <tool>` | 直接调用工具（`--list-tools` / `--args <json>`）|

```bash
qiongqi serve --data-dir ~/.qiongqi/data --base-url "$QIONGQI_BASE_URL" --api-key "$QIONGQI_API_KEY" --port 8899
```

#### Layer 10 — 领域预设层

> 📦 详细技术文档：[`./packages/preset-coding.md`](./packages/preset-coding.md)

**`@qiongqi/preset-coding`** — 编码预设。组装软件工程 Agent：系统提示 + 默认工具 + 技能挂载。

```typescript
import { createCodingAgent, CODING_SYSTEM_PROMPT, CODING_PINNED_CONSTRAINTS } from '@qiongqi/preset-coding'

const agent = await createCodingAgent({
  dataDir: './data',
  apiKey: process.env.QIONGQI_API_KEY!,
  baseUrl: process.env.QIONGQI_BASE_URL!,
  model: 'provider-model-name',
})
```

`CODING_PINNED_CONSTRAINTS` 是 byte-stable 约束，刻意保证 prompt cache 命中率：

- `system: preserve user intent across compaction`
- `system: keep the HTTP/SSE contract stable for clients`
- `system: keep the stable coding-preset prefix byte-stable for prompt-cache reuse`
- `system: never claim a change is verified without running the relevant tests or build`

### 3.4 HTTP 路由表（50 个端点）

| 路径前缀 | 主要端点 | 鉴权 |
|---------|---------|------|
| `/health` | 探活 | 无 |
| `/ready` | 就绪/降级检查（storage degraded 可见） | 无 |
| `/.well-known/agent-card.json` | A2A 发现（Stage 2）| 无（RFC 8615）|
| `/a2a/tasks` | POST 异步创建任务（Stage 4）| Bearer |
| `/a2a/tasks/:id` | GET 查询状态 | Bearer |
| `/a2a/tasks/:id/cancel` | POST 取消 | Bearer |
| `/a2a/tasks/:id/artifacts` | GET turn items | Bearer |
| `/a2a/tasks/:id/subscribe` | SSE 进度流 | Bearer |
| `/a2a` | 向后兼容 alias | Bearer |
| `/v1/runtime/info` / `/v1/runtime/tools` / `/v1/runtime/metrics` | 运行时诊断与指标 | Bearer |
| `/v1/runtime/evented-v2/runs/:runId/timeline` / `/v1/runtime/evented-v2/metrics` | evented_v2 多 Agent timeline 与聚合指标 | Bearer |
| `/v1/skills` | 技能清单（v1 + v2 合并）| Bearer |
| `/v1/attachments` | POST 上传 / GET 列表 / GET 诊断 | Bearer |
| `/v1/memory` | 记忆 CRUD | Bearer |
| `/v1/workspace/status` | Git/workspace 检查 | Bearer |
| `/v1/threads` | 线程 CRUD + Fork + Goal + Todo | Bearer |
| `/v1/threads/:id/turns` | 启动 / steer / interrupt / compact | Bearer |
| `/v1/threads/:id/events` | SSE 事件流（支持 `Last-Event-ID` 重放）| Bearer |
| `/v1/threads/:id/review` | 启动 review | Bearer |
| `/v1/approvals/:id` / `/v1/user-inputs/:id` | 门控决策 | Bearer |
| `/v1/sessions/:id/resume-thread` | 会话恢复 | Bearer |
| `/v1/usage` | 用量聚合（runtime / thread / day / model）| Bearer |

SSE 格式：`id: <seq>\nevent: <kind>\ndata: <JSON>\n\n`，15s heartbeat 事件。

---

## 4. 关键架构决策

### 4.1 Composition Root：createAgent / createHttpServer

`createAgent()` 是**唯一的 Composition Root**——它接收 30+ 配置项，按四步组装运行时：

1. `createCore()` — 存储、EventBus、Thread / Turn / Usage 服务
2. `createModelAdapter()` — `ModelCompatClient` + 能力配置
3. `createToolMatrix()` — 工具注册表、技能、委派运行时
4. `createAgent()` — 编排循环（TurnOrchestrator 组装）

`createHttpServer({ agent, host, port, accessLog?, telemetry? })` 在 agent 上挂 HTTP 监听，返回 `QiongqiServeHandle`。`accessLog` 可接入 JSON logger / APM collector，收到的结构化条目只包含 request id、trace id、method、path、status、duration，不包含 authorization 等敏感 header。若请求带 W3C `traceparent`，运行时会透传响应头，并输出 `traceparent` / `traceId` / `spanId`。`telemetry` 可由 `createOpenTelemetryRuntime` 创建，支持 OTLP HTTP、console、memory 测试 exporter 与关闭模式；`qiongqi serve` 可通过 `serve.observability.openTelemetry` 或 `QIONGQI_OTEL_*` 环境变量启用完整 HTTP server span lifecycle/export。

**设计取舍**：

- **无 DI 容器 / 反射 / 装饰器**——纯构造函数 DI，依赖关系在代码中显式
- **Preset 是配置，不是继承**——`createCodingAgent` 是 `createQiongqiServeRuntime` 的特化（注入 systemPrompt + agentName + pinnedConstraints），不引入新基类
- **向后兼容**——`createQiongqiServeRuntime` / `startQiongqiServe` 标记 `@deprecated` 仍可调用，CLI 入口不变

### 4.2 循环依赖打破策略

Qiongqi 严格遵守"依赖方向单向"硬约束，但实现中出现了 2 个真实循环，都被显式解决：

#### 循环 1：`loop ↔ services`

**原因**：`loop` 需要 `TurnService` / `UsageService` / `RuntimeEventRecorder` 写状态；`services` 又需要 `ContextCompactor` / `InflightTracker` / `SteeringQueue` 提供能力。

**解决方案**：
- `services/src/turn-service.ts` 用 `import type` 引用 `loop` 的类型
- `loop/src/*.ts` 用 `import type` 引用 `services` 的类型
- **`review-service.ts` 从 `services` 移到 `http`**——它是"会自己起 Turn 的子服务"，依赖图上属于 `http` 层，物理上避免值引用

#### 循环 2：`adapter-tools` 模块初始化循环

**原因**：`local-tool-host.ts` 在模块级 `import` 了 `buildBuiltinLocalTools()`，而 `builtin-tools.ts` 又 import `builtin-bash-tool.ts`，后者再 import `local-tool-host.ts`。

**解决方案**：
- `defaultLocalTools` 从模块级**常量**改为**延迟函数** `getDefaultLocalTools()`
- 只有第一次 `getDefaultLocalTools()` 被实际调用时，才执行 `buildBuiltinLocalTools()`，模块初始化阶段不再形成环

### 4.3 PricingProvider 抽象层

阶段 1.3 的关键解耦。**目标**：让模型客户端不再硬编码 DeepSeek 定价表，新增厂商只需注册一个 `PricingProvider` 即可。

- `PricingProvider` 接口（`packages/adapter-model/src/pricing/types.ts`）：`estimate(input) → CostEstimate | null`
- `DeepseekPricingProvider` 实现 DeepSeek 官方定价表，非 DeepSeek host 返回 `null`
- `CompositePricingProvider` 按注册顺序返回首个非 null 估算
- `ModelCompatClient` 通过构造参数 `pricingProvider` 注入，默认使用 `defaultPricingProvider`（Composite 单例）
- `mapUsage()` 改用注入的 provider 估算成本/节省

**新增厂商定价**：实现 `PricingProvider` 并注册到 `Composite`，无需修改客户端。

### 4.4 OrchestrationMode：classic / evented_v2 / kernel_v3

`evented_v2` 是声明式多 Agent 编排层，负责 Agent graph、handoff、mailbox、run 内持久化 outbox 与跨 Agent trace。
`kernel_v3` 是底层确定性执行核，负责 checkpoint、effect commit、lease 与 replay。
`classic` 仅作为单 Agent fallback，不扩展多 Agent 编排。

`evented` 是 legacy 兼容入口，会归一化到 `evented_v2`。显式选择 `evented_v2` 时会挂载 `EventedV2MultiAgentRuntime`；生产默认仍是 `kernel_v3`，完整多 Agent 生产流量路由仍是后续工作。

| 模式 | 编排器 | 崩溃恢复 | 适用场景 |
|------|-------|---------|---------|
| `kernel_v3` | durable kernel loop（checkpoint + idempotent effect commit）| 有 | 默认生产执行核 |
| `evented_v2` | `EventedTurnOrchestrator` + `LoopRunner`；额外挂载 `EventedV2MultiAgentRuntime` + `EventedV2OutboxReconciler` + `EventedV2RemoteAgentScheduler`（durable run / mailbox / handoff / outbox flush / remote worker polling shell）| 有（`LoopRun` / `TurnStateV2` + multi-agent `run.events` / `outbox` / `trace()` / `timeline()` / `metrics()`）| 多 Agent graph foundation、handoff、跨 Agent trace |
| `classic` | `TurnOrchestrator`（显式 step 推进）| 无 | 单 Agent fallback |
| `evented` | legacy 兼容别名，归一化到 `evented_v2` | 同 `evented_v2` | 旧配置兼容 |

**分层策略**：`kernel_v3` 是默认生产执行核，负责可重放的确定性执行、checkpoint、effect commit 与 lease；`evented_v2` 当前仍使用 legacy `EventedTurnOrchestrator` 驱动 turn loop，并额外挂载 `EventedV2MultiAgentRuntime` 作为多 Agent foundation/wiring。`classic` 路径继续使用 `runOrchestratorStep`；`LoopRunner` / `EventedTurnOrchestrator` 保留为 legacy evented loop 兼容层，解释 `LoopPlan.phases`（build-prompt → run-model → decide → evaluate → dispatch-tools），发布 `prompt:built` / `model:ran` / `decision` / `tools:dispatched` / `step:retry` 等 rich events，并把事件写入 `LoopRun.events`。`runStepViaEventBus` 仅作为兼容 API 保留。

**第二阶段 run 级事务进展**：`EventedV2MultiAgentRuntime.handoff()` 会在 `MultiAgentRunStore.update()` 的同一 run 事务里写入 handoff 事件和 `mailbox_enqueue` outbox intent；agent / remote agent completion 会在同一 run 事务里写入 `mailbox_complete` outbox intent。run 提交后再投递 mailbox 或完成 mailbox 终态，成功后把对应 outbox 标记为 `published`。若进程在 run 提交后、mailbox 投递/完成前后崩溃，新的 runtime 实例可调用 `flushPendingOutbox(runId)` 重放单个 run 的 pending intent，也可通过 `MultiAgentRunStore.listWithPendingOutbox()` + `flushAllPendingOutbox()` 发现并批量恢复；`EventedV2OutboxReconciler` 提供可周期运行、可停止、可观测的批量 flush 外壳，并可通过 `runtime.eventedV2OutboxReconciler.enabled` 在 `evented_v2` server runtime 中自动启动。`MailboxStore.enqueue` 对同一 message 保持幂等，且不会把 `delivered` / `completed` 状态降级回 `queued`；`MailboxStore.complete` 对同一 terminal 状态重放幂等，同时继续使用 claim fence 防止迟到 worker 覆盖不同终态。

**P0 已完成范围**：`EventedV2AgentWorker` 已能从 mailbox claim agent task、运行注入的 agent handler、提交 agent 结果并 complete mailbox；`EventedV2MultiAgentRuntime.completeAgentTask()` 会按声明式 edge 推进 graph；内部解释器覆盖 `agent` / `terminate` / `join` / `retry`，`wait` / `tool` / `judge` 作为外部执行节点先挂起，再由 `completeExternalNode()` 以声明式 condition 恢复推进；server factory 已按配置装配 reconciler 的 start/stop/isRunning 生命周期。至此 evented_v2 已具备通用多 Agent 编排的 P0 运行骨架。

**P1-B 观测管理面进展**：`@qiongqi/loop` 提供 `buildEventedV2RunTimeline(run)` 与 `buildEventedV2RunMetrics(runs)` 通用投影；`EventedV2MultiAgentRuntime.timeline(runId)` / `metrics()` 暴露只读 API；`MultiAgentRunStore.listAll()` 下沉为 store-native 全量 run 枚举能力。HTTP 管理面新增 `GET /v1/runtime/evented-v2/runs/:runId/timeline` 与 `GET /v1/runtime/evented-v2/metrics`，未启用 `evented_v2` runtime 时返回 `capability_unavailable`；Prometheus `/v1/runtime/metrics?format=prometheus` 会在配置了 multi-agent runtime 时追加 `qiongqi_evented_v2_runs_total{status=...}`、`qiongqi_evented_v2_outbox_pending`、`qiongqi_evented_v2_agent_runs_total{status=...}`，并在远程 scheduler / worker registry 挂载时追加 `qiongqi_evented_v2_remote_scheduler_*` 与 `qiongqi_evented_v2_workers_*` 运行、flush、message、error、online/expired 计数。

**P1-C 声明式配置面进展**：`RuntimeTuningConfigSchema` 现在接受 `runtime.eventedV2AgentGraph`，其结构复用 `AgentGraphSchema`。`createAgent()` 在 `orchestrationMode=evented_v2` 时会优先加载该声明式 graph，并通过 `validateAgentGraph()` 拒绝未知节点、重复 edge condition 等非法图；未配置时继续回退到默认 manager-specialist graph。这样 evented_v2 已能从通用配置加载 `agent` / `handoff` / `wait` / `tool` / `judge` / `join` / `retry` / `terminate` 节点拓扑。

**P2-A 远程 Agent 执行基础进展**：`RuntimeTuningConfigSchema` 现在接受 `runtime.eventedV2AgentPeers`，语义是 `agentId -> AgentCard.id`；`runtime.eventedV2RemoteAgent.timeoutMs` 可配置远程调用超时，`leaseTtlMs` 可开启 mailbox claim lease，`heartbeatTtlMs` 可配置 worker registry 心跳过期窗口，`scheduler.enabled` / `scheduler.intervalMs` 可启动周期性远程 agent polling，`compensation.statusConditions` 可把 peer outcome 映射为声明式 graph condition。当 `orchestrationMode=evented_v2` 且存在 peer binding 时，server runtime 会挂载 `EventedV2RemoteAgentWorker`，它从通用 mailbox claim 指定 agent 的任务，转换为 `PeerTask`，通过共享的 `PeerRegistry.invokePeer()` 调用本地或远程 peer，再把 `PeerArtifact.status` 映射成 graph condition（默认 `completed` / `failed` / `aborted`，也可配置为 `remote_failed` 等补偿边）提交给 `EventedV2MultiAgentRuntime.completeAgentTask()`。agent completion 会把 mailbox 终态完成写成 run 内 `mailbox_complete` outbox，因此 remote failed / aborted / compensation condition 已可在 run 推进后通过 reconciler 事务化恢复 mailbox 终态。`EventedV2RemoteAgentScheduler` 会按 peer binding 的 agent 列表轮询 worker、隔离单 agent 错误、汇总 processed message，并随 server runtime shutdown 停止；`snapshot()` 会暴露 workerId、running/stopped、health、flush/message/error 计数与 heartbeat 时间，且每次 flush 后会向通用 `EventedV2WorkerRegistryStore` 写入 remote agent worker heartbeat。内存/file store 均已实现该 registry，HTTP runtime metrics 和 Prometheus 会投影 worker total/online/expired 与 role 维度计数。`PeerArtifact.artifacts` 会作为 `agentRuns[].peerArtifact` 进入 run timeline；远程 failed / aborted 会同步写入 agent run 与 mailbox 终态。mailbox claim lease 会用 holder / TTL / fence 防止多个 worker 同时完成同一消息，并允许过期 delivered 消息被其他 worker 接管。这一步复用现有 A2A/PeerRegistry 能力，没有把 HTTP transport 或产品私有协议塞进 `@qiongqi/loop`。

**真实 backlog**：

- **P1-A：跨实例 lease / CAS 深化（已落地基础）** —— `MultiAgentRunStore` 已支持可选 run lease、fencing token、`loadVersion()` 与 `expectedVersion` CAS；内存/file store 均实现 epoch fencing 与 stale fence 拒绝；`EventedV2MultiAgentRuntime` 在 store 支持 lease 时会自动以 acquire -> fenced update -> release 包裹 handoff、agent completion、external node completion 与 outbox flush。后续还需补长事务 heartbeat/renew、lease 指标与 store-native batch transaction。
- **P1：观测与回放深化** —— run timeline、agent-run 状态投影、HTTP 管理 API、核心 Prometheus 指标、remote scheduler supervisor snapshot/metrics 已落地；还需要 reconciler lease/flush 指标、失败原因标准化、历史 run 回放/重建查询与分页/过滤。
- **P1：声明式配置面深化** —— 通用 AgentGraph 配置加载已落地；还需要独立 manifest 文件加载、agent binding 执行策略、能力约束校验与 graph-level rollout 策略。
- **P2：分布式与远程 agent** —— `evented_v2` 远程执行基础已接入 mailbox + PeerRegistry + graph condition 推进，并已覆盖 artifact 回传、外部取消、超时转 aborted、mailbox claim lease/fence、server 内 remote scheduler lifecycle、scheduler supervisor metrics、store-backed worker heartbeat registry、声明式 peer outcome 补偿 condition 映射、mailbox completion outbox 恢复，以及不启动 HTTP server 的 `qiongqi worker --once` / daemon CLI 入口；`qiongqi worker --shard-index/--shard-count` 会在创建 runtime 前按稳定排序切分 `eventedV2AgentPeers`，让多个 worker 实例共享同一配置但处理不同 agent 子集；`qiongqi worker --plan --pool-size N` 可输出部署用 shard 拓扑而不创建 runtime。后续还需进程池 supervisor、自动 worker 数量管理与生产部署编排。
- **P2：生产灰度** —— `kernel_v3` 仍是默认生产执行核；evented_v2 需要 shadow / canary / fallback 指标闭环后才能承载默认多 Agent 流量。

### 4.5 AgentCard / PeerRegistry / A2A 协议

阶段 2 + 阶段 4 的多 Agent 基础设施：

- **`AgentCard`**（`@qiongqi/contracts`）— Agent 身份证（id / url / name / version / skills / capabilities / model / endpoints）
- **`PeerRegistry`**（`@qiongqi/delegation`）— 本地/远程 peer 统一入口；`LocalPeerHandle`（进程内） + `RemotePeerTransport`（接口，由 `http/HttpPeerTransport` 实现）
- **`FilePeerStore`** — 远程 peer 持久化到 `<dataDir>/peers.json`
- **`GET /.well-known/agent-card.json`** — A2A 发现（无 auth，RFC 8615）
- **`HttpPeerTransport`** — `RemotePeerTransport` 的 HTTP 实现，token 解析回调；兼容旧 `PeerArtifact` 响应与 Stage 4 `{ task, artifact, artifacts }` 响应
- **A2A 任务端点**（阶段 4）— `POST /a2a/tasks` 创建任务并启动后台 turn，返回 202 + task；`GET /a2a/tasks/:id` 查询；`/cancel` 通过 runtime hook 中断关联 turn；`/artifacts` / `/subscribe` SSE

**跨实例 A2A 闭环**：Agent A 可通过兼容端点 `POST /a2a` 获取同步 `PeerArtifact`，也可通过 `POST /a2a/tasks` 提交异步任务并查询/订阅生命周期；A 通过 B 的 AgentCard 发现能力。

### 4.6 Cache-First 三层契约

为什么 Qiongqi 把 cache 提到第一公民？

1. **`ImmutablePrefix`**（`@qiongqi/cache/immutable-prefix.ts`）拥有 `systemPrompt + tools + pinnedConstraints + fewShots`，SHA-256 指纹 + `revision` 计数；`setTools` / `setSystemPrompt` 等 mutator 全部走 `mutate()` 重新 canonicalize + 重新 fingerprint；`verifyImmutablePrefix()` 在 dev 模式下校验漂移
2. **`PromptBuilder.build()`** 把 `prefix.fewShots` 单独作为 `ModelRequest.prefix` 发送；每回合动态内容（skill 指令、memory 注入、mode instruction、drift 提示）放进 `contextInstructions`，附加在 prefix 之后
3. **工具目录漂移检测**：`buildToolCatalogFingerprint` 按 `(threadId, workspace, mode, model, activeSkillIds, allowedToolNames)` 取指纹。**破坏性漂移** → 自动 stop，"加性漂移" → 仅发 `tool_catalog_changed` 事件

**实战效果**：preset-coding 的 `CODING_PINNED_CONSTRAINTS` 是 4 条 byte-stable 约束，确保同一 workspace 内多回合的 prompt cache 命中率达到业界最高水位。

---

## 5. 路线图与现状

四阶段改造计划，**截至 2026-06-22**：

| 阶段 | 目标 | 状态 | 关键产物 |
|------|------|------|---------|
| **阶段 1** | SDK 抽离 + monorepo 拆包 | ✅ **完成** | 18 个包 + pnpm workspace + vitest 别名 + Composition Root 拆分 + PricingProvider 抽象 + CLI 必填校验 |
| **阶段 2** | AgentCard + AgentIdentity | ✅ **完成** | AgentCard / PeerRegistry / SkillRegistry / TaskThreadMap + `GET /.well-known/agent-card.json` + `POST /a2a` + HttpPeerTransport + 跨实例 A2A 闭环验证 |
| **阶段 3** | TurnOrchestrator 事件化 | ✅ **完成** | LoopPlan / LoopRunner / LoopRun(TurnStateV2) / FileTurnStateStore / EventedTurnOrchestrator / TurnEventBus + kill -9 端到端崩溃恢复验证 |
| **阶段 4** | A2A 协议端点 | 🔄 **基本完成** | A2ATaskRecord / FileA2ATaskStore + 异步 `POST /a2a/tasks` + 同步兼容 `POST /a2a` + `GET /a2a/tasks/:id` + 可中断 `cancel` + `artifacts` + SSE `subscribe` + ArtifactSchema 桥接。**待外部 Agent 做跨厂商互操作验证** |

**当前验证基线**（与 `PROGRESS.zh.md` 同步）：
- 全量测试：484/484 ✅
- 快速测试：455/455 ✅
- 包构建：18/18 ✅
- 端到端（本地 evented A2A）：✅

详细历史见 [`PROGRESS.zh.md`](./PROGRESS.zh.md) / [`PROGRESS.en.md`](./PROGRESS.en.md)。

---

## 6. 扩展指南

### 6.1 添加一个新 Adapter

假设要添加 `MyDatabase` 存储后端：

1. **在 `ports` 添加抽象**（如果还没有）：`packages/ports/src/my-database-store.ts`
2. **在 `adapter-storage` 实现**：`packages/adapter-storage/src/my-database-thread-store.ts` 实现 `ThreadStore` 接口
3. **在 `createCore()` 注入**（`packages/http/src/runtime-factory.ts`）：根据 `config.storage.backend === 'my-database'` 选择
4. **更新配置 schema**：`packages/contracts/src/qiongqi-config.ts` 的 `storage.backend` 添加新值
5. **写测试**：`tests/my-database-store.test.ts`

### 6.2 添加一个新 Skill

技能是 `skills/` 目录下的一个子目录：

1. **创建目录**：`skills/my-skill/`
2. **写 manifest**：`skills/my-skill/skill.json`（`specVersion: "1.0"`，含 `id` / `name` / `commands` / `tools.allowed` / `permissions`）
3. **写说明**：`skills/my-skill/SKILL.md`（技能被激活时注入到 system prompt）
4. **如需 MCP**：`mcpServers` 字段声明，`skill-mcp-bridge` 自动收集
5. **路径注入**：`createAgent({ skillRoots: ['/path/to/skills'] })` 或默认 `skills/`

完整 11 个示例技能见 `skills/`（`code-review` / `debugging` / `goal` / `planning` / `tdd` 等）。

### 6.3 添加一个新 Preset

`preset-coding` 是"骨架 + 编码血肉"的现成示例。添加一个新预设（如 `preset-finance`）：

1. **新建包**：`packages/preset-finance/`
2. **写 `createFinanceAgent(options)`**：`preset-finance/src/index.ts` 调用 `createQiongqiServeRuntime({...options, agentName: 'Qiongqi Finance', systemPrompt: FINANCE_SYSTEM_PROMPT, pinnedConstraints: FINANCE_PINNED_CONSTRAINTS})`
3. **定义提示词与约束**：`preset-finance/src/finance-system-prompt.ts`（含 `FINANCE_PINNED_CONSTRAINTS` byte-stable 数组）
4. **注册 CLI preset**：`packages/cli/src/cli-options.ts` 的 `SERVE_PRESETS` 添加 `'finance'`
5. **加新工作流**：`presets/finance/` 目录的 skill + 工具（如 PDF 解析、合规检查）

### 6.4 自定义 ModelClient

引擎通过 `ModelClient` port 抽象与模型解耦。新增厂商：

1. **实现 `ModelClient.stream(request)`**：`AsyncIterable<ModelStreamChunk>`，7 种 chunk 类型（`assistant_text_delta` / `assistant_reasoning_delta` / `tool_call_delta` / `tool_call_complete` / `usage` / `completed` / `error`）
2. **实现 `PricingProvider`**：在 `adapter-model/src/pricing/` 新建 `<vendor>-pricing.ts`，注册到 `CompositePricingProvider`
3. **注入**：`createModelAdapter({ modelClient: new MyClient(...), pricingProvider: Composite([..., myProvider]) })`
4. **SSE 格式参考**：`packages/adapter-model/src/model-compat-client.ts` 已有 `chat_completions` / `responses` / `messages` 三种实现

---

## 附录 A. 完整依赖表

```
@qiongqi/contracts           (无依赖)

@qiongqi/domain
  └─ @qiongqi/contracts

@qiongqi/ports
  ├─ @qiongqi/contracts
  └─ @qiongqi/domain

@qiongqi/cache
  ├─ @qiongqi/contracts
  └─ @qiongqi/ports

@qiongqi/attachments
  └─ @qiongqi/contracts

@qiongqi/adapter-fs
  └─ diff

@qiongqi/tool-infra
  └─ @qiongqi/adapter-fs

@qiongqi/services
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  ├─ @qiongqi/loop          (type-only)
  ├─ @qiongqi/adapter-tools
  ├─ @qiongqi/tool-infra
  └─ @qiongqi/cache

@qiongqi/loop
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  ├─ @qiongqi/cache
  ├─ @qiongqi/services       (type-only)
  ├─ @qiongqi/adapter-tools
  ├─ @qiongqi/adapter-model
  ├─ @qiongqi/attachments
  ├─ @qiongqi/skills
  └─ @qiongqi/memory

@qiongqi/adapter-model
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  └─ @qiongqi/ports

@qiongqi/adapter-storage
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  └─ better-sqlite3

@qiongqi/adapter-tools
  ├─ @qiongqi/adapter-fs
  ├─ @qiongqi/tool-infra
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  ├─ @qiongqi/services
  ├─ @qiongqi/memory
  ├─ @qiongqi/delegation
  ├─ diff
  └─ @modelcontextprotocol/sdk

@qiongqi/skills
  ├─ @qiongqi/contracts
  ├─ @qiongqi/ports
  ├─ @qiongqi/adapter-tools
  └─ zod

@qiongqi/memory
  ├─ @qiongqi/contracts
  └─ @qiongqi/adapter-storage

@qiongqi/delegation
  ├─ @qiongqi/contracts
  ├─ @qiongqi/ports
  ├─ @qiongqi/cache
  ├─ @qiongqi/loop
  ├─ @qiongqi/adapter-storage
  ├─ @qiongqi/memory
  ├─ @qiongqi/skills
  ├─ @qiongqi/services
  └─ zod

@qiongqi/http
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  ├─ @qiongqi/cache
  ├─ @qiongqi/loop
  ├─ @qiongqi/services
  ├─ @qiongqi/adapter-model
  ├─ @qiongqi/adapter-storage
  ├─ @qiongqi/adapter-tools
  ├─ @qiongqi/skills
  ├─ @qiongqi/memory
  ├─ @qiongqi/attachments
  ├─ @qiongqi/delegation
  └─ zod

@qiongqi/cli
  ├─ @qiongqi/http
  ├─ @qiongqi/contracts
  ├─ @qiongqi/adapter-tools
  ├─ @qiongqi/ports
  ├─ @qiongqi/loop
  ├─ @qiongqi/preset-coding
  └─ zod

@qiongqi/preset-coding
  ├─ @qiongqi/http
  ├─ @qiongqi/contracts
  └─ @qiongqi/ports
```

### 外部依赖分布

| 外部依赖 | 所在包 |
|---------|--------|
| `zod` | contracts, skills, delegation, http, cli |
| `better-sqlite3` + `@types/better-sqlite3` | adapter-storage |
| `diff` | adapter-fs, adapter-tools |
| `@modelcontextprotocol/sdk` | adapter-tools |

---

## 附录 B. 构建与测试

### 构建

```bash
pnpm install
pnpm -r run build           # 构建全部 18 个包
node scripts/flatten-dist.mjs  # 拍平 dist 嵌套结构
```

每个包有两份 tsconfig：
- `tsconfig.json` — 开发/类型检查，含 `paths` 映射指向其他包的 `src/`
- `tsconfig.build.json` — 构建，输出到 `dist/`，由 `flatten-dist.mjs` 拍平

### 测试

```bash
pnpm test                  # 全量测试（65 个文件，484 个测试用例）
pnpm test:unit             # 快速单元测试（cache / contracts / domain / ports）
pnpm test:fast             # 快速子集（排除 builtin-tools）
```

测试文件集中在根 `tests/` 目录，根 `vitest.config.ts` 统一管理 18 个包 alias。

### 端到端验证

```bash
npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --base-url "$QIONGQI_BASE_URL" \
  --api-key "$QIONGQI_API_KEY" \
  --port 8899

curl http://127.0.0.1:8899/health
# → {"status":"ok","service":"qiongqi","mode":"serve"}
```

`hybrid` 是生产推荐存储模式（SQLite 索引 + JSONL 全量日志）。CI 或生产镜像构建时建议运行 `pnpm run prepare:sqlite && pnpm run verify:sqlite`，先为当前 Node ABI 编译 `better-sqlite3`，再通过内存库与临时落盘库 probe 提前发现原生绑定缺失、Node ABI 不匹配或平台包缺失问题；否则运行时会降级到 JSONL fallback，功能可用但失去 SQLite 索引性能。

生产探针与指标：

```bash
curl http://127.0.0.1:8899/health
curl http://127.0.0.1:8899/ready
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  http://127.0.0.1:8899/v1/runtime/metrics
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  -H "Accept: text/plain" \
  "http://127.0.0.1:8899/v1/runtime/metrics?format=prometheus"
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  "http://127.0.0.1:8899/v1/runtime/evented-v2/metrics"
```

`/health` 适合作为 liveness；`/ready` 适合作为 readiness，并会在 hybrid SQLite fallback 时返回 `status=degraded`；Prometheus text endpoint 暴露 token/cache、A2A task 状态、evented_v2 run/agent/outbox 状态与存储降级状态。

evented orchestrator + A2A 双实例验证：

```bash
pnpm -r run build
node scripts/flatten-dist.mjs
pnpm run verify:evented-a2a
```

`verify:evented-a2a` 默认启动一个本地 OpenAI-compatible fake model 和两个 evented Qiongqi HTTP runtime，验证 AgentCard 发现、异步 `POST /a2a/tasks`、任务轮询完成、artifacts、SSE subscribe，以及 evented turn state 完成后清理。真实外部互操作需要显式 opt-in：

```bash
QIONGQI_A2A_PEER_URL="https://peer.example.com" \
QIONGQI_A2A_PEER_TOKEN="$TOKEN" \
pnpm run verify:evented-a2a -- --external-peer
```

未提供外部 peer 时，脚本会把 external peer 标记为 skipped，而不是误报为通过。

### 关键脚本（`scripts/`）

| 脚本 | 用途 |
|------|------|
| `flatten-dist.mjs` | 拍平 `dist/` 嵌套结构 |
| `transcript-diff.mjs` | 对比两个 thread 的 usage 指标（缓存命中率、token 节省）|
| `verify-crash-recovery.mjs` | 阶段 3 端到端：模拟崩溃 + EventedTurnOrchestrator 恢复 |
| `verify-evented-a2a.mjs` | 阶段 3/4 端到端：本地双实例 evented orchestrator + A2A task lifecycle 验证，可选外部 peer |

---

## 附录 C. 相关文档

| 文档 | 内容 |
|------|------|
| [`README.md`](../README.md) / [`README.zh.md`](../README.zh.md) / [`README.en.md`](../README.en.md) | 项目入口、安装、快速开始、神话哲学引子 |
| [`PROGRESS.zh.md`](./PROGRESS.zh.md) / [`PROGRESS.en.md`](./PROGRESS.en.md) | 四阶段改造的详细变更日志（1.1–4.x）|
| [`config.example.json`](../config.example.json) | 运行时配置示例（117 行）|
| [`skills/`](../skills/) | 11 个内置技能（`code-review` / `debugging` / `goal` / `planning` / `tdd` 等）|
| 各包 `src/` + JSDoc | 单包源码与 API 细节 |

---

<p align="center">
  <sub>穷奇非凶，乃破局之锐 · Built with ❤️ for the Agent era</sub>
</p>
