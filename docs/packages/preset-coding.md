# @qiongqi/preset-coding

> 编码 Agent 预设 —— `createCodingAgent` + `CODING_SYSTEM_PROMPT` + `CODING_PINNED_CONSTRAINTS`。
> Layer 10 — 依赖：`@qiongqi/http`、`@qiongqi/contracts`、`@qiongqi/ports`。

---

## 中文

### 1. 职责

`@qiongqi/preset-coding` 是**"骨架 + 编码血肉"**的现成示例。`createCodingAgent` 是**纯特化层**：

- 注入 `systemPrompt`（默认 `CODING_SYSTEM_PROMPT`）
- 注入 `agentName`（默认 `'Qiongqi Coding'`）
- 注入 `pinnedConstraints`（默认 `CODING_PINNED_CONSTRAINTS` 4 条 byte-stable 约束）
- 然后委托给 `createQiongqiServeRuntime`

**关键不引入新基类**——preset 是"配置"不是"继承"。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `createCodingAgent(options)` | function (async) | `index.ts` | 编码 Agent 工厂；委托给 `createQiongqiServeRuntime` |
| `CodingPresetOptions` | type | `index.ts` | 编码 preset 配置（Omit `systemPrompt` + `agentName` + `pinnedConstraints` 后的 QiongqiServeRuntimeOptions + overrides）|
| `CODING_SYSTEM_PROMPT` | const | `coding-system-prompt.ts` | 完整编码 Agent 系统提示（~60 行）|
| `CODING_PINNED_CONSTRAINTS` | const (readonly array) | `index.ts` | 4 条 byte-stable 约束 |

### 3. 关键不变量

- **Prompt 是 byte-stable**（`coding-system-prompt.ts:18`）："This operating contract is intentionally stable. It is kept at the front of every model request so the model prompt-cache can reuse the same prefix across continuations, plans, and tool calls."
- **4 条 pinned constraints**：
  1. `system: preserve user intent across compaction`
  2. `system: keep the HTTP/SSE contract stable for clients`
  3. `system: keep the stable coding-preset prefix byte-stable for prompt-cache reuse`
  4. `system: never claim a change is verified without running the relevant tests or build`
- **Preset 不改 Runtime 行为**：`createCodingAgent` 与 `createQiongqiServeRuntime` 的运行时差异**仅**在于 `agentName` / `systemPrompt` / `pinnedConstraints` 三个字段。
- **Prompt 6 大主题**：
  1. **Core identity** —— 资深工程协作者；保留用户意图（尤其负面约束）；小而一致的 diff；先读后做
  2. **Engineering behaviour** —— 尊重仓库模式（ports/adapters, contracts, services, loop, cache, routes, tests）；typed DTOs；测试邻近行为；不 revert 无关工作
  3. **Tool behaviour** —— 用 advertise 的工具；`read` / `bash` / `edit` / `write` / `grep` / `find` / `ls` 内置家族；approval / user_input 是显式门
  4. **Cache behaviour** —— 不可变 prefix 字节稳定；动态内容在 prefix 之后；compaction 保留目标/约束/决策/文件/任务
  5. **Response style** —— 清晰直接；中文场景用中文；解释变化/验证/风险；具体步骤
  6. **Safety and quality** —— 不隐藏失败测试；不编造 cache hit rate；审计 capability 不缺失；任务完成需代码+测试+build 证明
- **`agentName` 默认 `'Qiongqi Coding'`**：`--preset generic` 对应 `'Qiongqi'`。
- **不强制工具矩阵**：`preset-coding` 不自动加载任何工具（vs `preset-all` 之类）；调用方通过 `capabilities.skills.roots` 等显式挂载。

### 4. 行为规约

来自 `tests/runtime-factory.test.ts`（集成）：

- `createCodingAgent returns a runtime with agentName='Qiongqi Coding'`
- `createCodingAgent uses CODING_SYSTEM_PROMPT by default`
- `createCodingAgent uses CODING_PINNED_CONSTRAINTS by default`
- `createCodingAgent allows overriding systemPrompt via options.systemPrompt`
- `createCodingAgent allows overriding agentName via options.agentName`
- `createCodingAgent allows overriding pinnedConstraints via options.pinnedConstraints`
- `createCodingAgent forwards all other options (dataDir, apiKey, model, ...) to createQiongqiServeRuntime`
- `The default runtime uses createQiongqiServeRuntime which yields agentName='Qiongqi'`

### 5. 使用示例

```typescript
import { createCodingAgent, CODING_SYSTEM_PROMPT, CODING_PINNED_CONSTRAINTS } from '@qiongqi/preset-coding'

// 1. 启动编码 Agent
const runtime = await createCodingAgent({
  host: '127.0.0.1',
  port: 8899,
  dataDir: '/work/.qiongqi/data',
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseUrl: 'https://api.deepseek.com/beta',
  model: 'deepseek-v4-pro',
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
  insecure: false,
  capabilities: {
    skills: { enabled: true, roots: ['/work/.qiongqi/skills'] },
    subagents: { enabled: true, maxParallel: 4 },
    // ...
  },
})

// 2. 覆盖 prompt
const runtime2 = await createCodingAgent({
  // ...
  systemPrompt: '你是一个专注 Python 后端的编码 agent',
  agentName: 'Qiongqi Python',
})

// 3. 直接用 prompt 常量
console.log(CODING_SYSTEM_PROMPT.length)  // ~1800 字符
console.log(CODING_PINNED_CONSTRAINTS)    // 4 条
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 10 领域预设层）
- 消费方：`@qiongqi/cli/serve-entry.ts` 的 `resolveServeRuntimeFactory('coding')` 返回 `createCodingAgent`
- 源文件：[`index.ts`](../../packages/preset-coding/src/index.ts)、[`coding-system-prompt.ts`](../../packages/preset-coding/src/coding-system-prompt.ts)
- 验证：阶段 1.8 端到端验证（`docs/PROGRESS.zh.md:159-163`）：外部消费模拟测试 + bin 入口启动 + 完整 curl 链路
