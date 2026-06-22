# Qiongqi Per-Package 技术文档索引

> 27 份 per-package 文档，按依赖层级（Layer 0-10）组织，覆盖 monorepo 全部 18 个 npm 包。
> 详细架构叙事见 [`../architecture.zh.md`](../architecture.zh.md) / [`../architecture.en.md`](../architecture.en.md)。

## 阅读顺序

1. **架构总览** → [`../architecture.zh.md`](../architecture.zh.md)（6 章 + 3 附录）
2. **本索引** → 下方按 Layer 组织的文档列表
3. **逐包文档** → 每一份都遵循统一结构：职责 / 公共 API / 关键不变量 / 行为规约 / 使用示例 / 关联文档

## 文档列表（按 Layer 分组）

### Layer 0 — 零依赖基础层

| 文档 | 包 | 核心内容 |
|------|----|---------|
| [`contracts.md`](./contracts.md) | `@qiongqi/contracts` | Zod schema + TypeScript 类型（23 文件，22 个 Zod schema，零依赖基础层）|
| [`domain.md`](./domain.md) | `@qiongqi/domain` | 纯领域实体与值对象（10 个工厂 + 10 个 makeXxxItem + runtime-event-reducer）|
| [`attachments.md`](./attachments.md) | `@qiongqi/attachments` | FileAttachmentStore（PNG / JPEG / WebP + 文本回退 + 作用域授权）|
| [`ports.md`](./ports.md) | `@qiongqi/ports` | 11 个 Hexagonal 端口接口（ModelClient / ToolHost / Stores / EventBus / Gates）|
| [`cache.md`](./cache.md) | `@qiongqi/cache` | ImmutablePrefix + LRU/TTL + 工具目录指纹 + 遥测 + 用量计数 |

### Layer 3 — 基础设施

| 文档 | 包 | 核心内容 |
|------|----|---------|
| [`adapter-fs.md`](./adapter-fs.md) | `@qiongqi/adapter-fs` | 纯 FS I/O（edit-diff fuzzy match / truncate UTF-8 安全 / fs-types）|
| [`tool-infra.md`](./tool-infra.md) | `@qiongqi/tool-infra` | 工具执行基础设施（FileMutationQueue / OutputAccumulator / ToolRateLimit）|
| [`memory.md`](./memory.md) | `@qiongqi/memory` | FileMemoryStore（跨会话记忆 + 关键词打分 + 软删除/软禁用）|

### Layer 4-5 — 引擎 + 适配器

| 文档 | 包 | 核心内容 |
|------|----|---------|
| [`adapter-storage.md`](./adapter-storage.md) | `@qiongqi/adapter-storage` | File/Hybrid/InMemory 三套存储 + atomic write + workspace inspector |
| [`adapter-model-client.md`](./adapter-model-client.md) | `@qiongqi/adapter-model` | ModelCompatClient（chat_completions/responses/messages 三协议 streaming 客户端）|
| [`adapter-model-pricing.md`](./adapter-model-pricing.md) | `@qiongqi/adapter-model` | PricingProvider 抽象（DeepSeek 解耦 + Composite）|
| [`services-event-recorder.md`](./services-event-recorder.md) | `@qiongqi/services` | RuntimeEventRecorder（唯一事件生产者）|
| [`services-thread-turn.md`](./services-thread-turn.md) | `@qiongqi/services` | ThreadService + TurnService（唯一状态变更点）|
| [`services-usage.md`](./services-usage.md) | `@qiongqi/services` | UsageService（用量聚合 + 仪表盘查询）|
| [`adapter-tools-registry.md`](./adapter-tools-registry.md) | `@qiongqi/adapter-tools` | CapabilityRegistry / LocalToolHost / ReadTracker / ToolHooks |
| [`adapter-tools-builtin.md`](./adapter-tools-builtin.md) | `@qiongqi/adapter-tools` | 内置工具（bash / read / write / edit / grep / find / ls / plan / goal / todo）|
| [`adapter-tools-providers.md`](./adapter-tools-providers.md) | `@qiongqi/adapter-tools` | 外部 Provider（MCP / Web / Memory / Delegation）|
| [`skills.md`](./skills.md) | `@qiongqi/skills` | SkillRuntime + SkillPluginHost + Marketplace |
| [`delegation-runtime.md`](./delegation-runtime.md) | `@qiongqi/delegation` | DelegationRuntime + ChildAgentExecutor |
| [`delegation-registry.md`](./delegation-registry.md) | `@qiongqi/delegation` | PeerRegistry + SkillRegistry + TaskThreadMap |
| [`loop-orchestrator.md`](./loop-orchestrator.md) | `@qiongqi/loop` | TurnOrchestrator + EventedTurnOrchestrator + TurnEventBus + InflightTracker + SteeringQueue |
| [`loop-prompt-and-context.md`](./loop-prompt-and-context.md) | `@qiongqi/loop` | PromptBuilder + ModelStepRunner + ContinuationPolicy + ContextCompactor + TokenEconomy + AutoModelRouter |
| [`loop-tool-coordination.md`](./loop-tool-coordination.md) | `@qiongqi/loop` | ToolCallCoordinator + ToolStormBreaker + request-history-hygiene + history-healing |

### Layer 8-10 — 交付层

| 文档 | 包 | 核心内容 |
|------|----|---------|
| [`http-transport.md`](./http-transport.md) | `@qiongqi/http` | Router / SSE / Auth / Response / Node HTTP / A2A transport |
| [`http-composition-and-routes.md`](./http-composition-and-routes.md) | `@qiongqi/http` | createAgent Composition Root + ReviewService + 18 个 route handlers |
| [`cli.md`](./cli.md) | `@qiongqi/cli` | qiongqi serve / run / chat / exec |
| [`preset-coding.md`](./preset-coding.md) | `@qiongqi/preset-coding` | createCodingAgent + CODING_SYSTEM_PROMPT + CODING_PINNED_CONSTRAINTS |

## 文档结构

每份 per-package 文档都遵循统一结构（参考 [architecture.zh.md §1.2](../architecture.zh.md)）：

```
## 1. 职责          # 一句话定位 + 依赖 + 关键能力
## 2. 公共 API      # 导出表（name | kind | signature | purpose）
## 3. 关键不变量    # 从源文件 JSDoc 头提取的硬约束（带 file:line 引用）
## 4. 行为规约      # 从 it() 测试名提炼的行为保证
## 5. 使用示例      # 最小可运行示例
## 6. 关联文档      # 链回 architecture + 其他 per-package 文档 + 源文件
```

## 文档统计

- **总文档数**：27 份（不含本 README）
- **覆盖包数**：18 / 18
- **总行数**：约 7000 行中文
- **每份平均**：约 250 行
- **最大单份**：`http-composition-and-routes.md`（18 个 route handlers + Composition Root）
- **最小单份**：`attachments.md` / `memory.md`（单文件实现）

## 写作原则

所有内容基于源码实际读取（`Read` 工具）：

- **API 表**：每个导出在源文件中精确查证
- **不变量**：直接引用源文件的 JSDoc 头 + inline 注释（带 `file:line` 引用）
- **行为规约**：从 `tests/*.test.ts` 的 `it()` 字符串提炼
- **示例**：从测试或源文件的 usage pattern 提取

如发现文档与代码不符，请以**源码为准**并提交 PR 修正。
