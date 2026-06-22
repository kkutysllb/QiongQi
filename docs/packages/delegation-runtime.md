# @qiongqi/delegation — Runtime / Child Agent

> `DelegationRuntime` + `ChildAgentExecutor` —— 子代理委派运行时。
> Layer 7 — 依赖：`@qiongqi/contracts`、`@qiongqi/ports`、`@qiongqi/cache`、`@qiongqi/loop`、`@qiongqi/adapter-storage`、`@qiongqi/memory`、`@qiongqi/skills`、`@qiongqi/services`。

---

## 中文

### 1. 职责

`DelegationRuntime` 是子代理委派的**主入口**：

- 强制 `config.enabled` / `maxParallel` / `maxChildRuns` 三重限制
- 维护 in-process 并发计数（`active`）
- 分配 `childId`，持久化 `ChildRunRecord` 到 `FileDelegationStore`
- 派发到 `peerRegistry.invokePeer`（Stage 2 路径）或 `executor`（Stage 1 legacy 路径）
- 把 child run 状态映射为 runtime events（`turn_started` / `turn_completed` / `turn_failed` / `turn_aborted`）
- 聚合统计（按 `${label}:${model}` 分桶）

`ChildAgentExecutor` 是默认的 `ChildRunExecutor` 实现 —— 给 child 装配一整套**隔离的**运行时（独立 event bus / session store / thread store / orchestrator），不污染主线程状态。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `DelegationRuntime` | class | `delegation-runtime.ts` | 主入口 |
| `ChildRunRecord` | zod schema | `delegation-runtime.ts` | 子代理运行记录 |
| `ChildRunUsage` | type | `delegation-runtime.ts` | 子代理的 token 用量 |
| `ChildRunExecutor` | type | `delegation-runtime.ts` | 委派执行器签名 |
| `ChildRunAggregate` | type | `delegation-runtime.ts` | 聚合统计 |
| `FileDelegationStore` | class | `delegation-runtime.ts` | JSONL 持久化 |
| `aggregateChildRuns` | function | `delegation-runtime.ts` | 按 label+model 聚合 |
| `createChildAgentExecutor` | function | `child-agent-executor.ts` | 隔离子代理工厂 |
| `ChildAgentExecutorOptions` | type | `child-agent-executor.ts` | 构造配置 |

### 3. 关键不变量

- **执行顺序强制**（`delegation-runtime.ts:133-136`）：`enabled` → `maxParallel` → `maxChildRuns` —— 缺一即拒绝。
- **`active` 计数同步在 `upsert` 之后**（`delegation-runtime.ts:153`）：保证并发 caller 看到最新计数。
- **Stage 1 vs Stage 2 路径**：
  - 有 `peerRegistry`：通过 `peerRegistry.invokePeer(childCardId, task, signal)` 分发（可能远程）
  - 无 `peerRegistry`：直接 `await executor({...})`
- **Child run 状态映射**（`delegation-runtime.ts:316`）：
  - `running → turn_started`
  - `completed → turn_completed`
  - `failed → turn_failed`
  - `aborted → turn_aborted`
- **`recordExternalUsage`**：把 child run 的 usage 合并到父 thread 的 UsageCounter。
- **Abort 处理**：若 `signal.aborted`，子 run status 直接 → `aborted`，不发 `failed`。
- **`aggregateChildRuns` 分桶**（`delegation-runtime.ts:366`）：按 `${label}:${model}` 桶化，计算 `averageTotalTokens` / `averageCostUsd` / `averageCostCny`。

### 4. 行为规约

来自 `tests/delegation-runtime.test.ts` / `tests/child-agent-executor.test.ts`：

- `runChild throws when config.enabled is false`
- `runChild throws when active >= maxParallel`
- `runChild throws when existing.length >= maxChildRuns`
- `runChild persists ChildRunRecord (status: running) before invoking`
- `runChild increments active synchronously after persist`
- `runChild (Stage 2) dispatches via peerRegistry.invokePeer`
- `runChild (Stage 1) dispatches via executor directly`
- `runChild transitions status to completed on success and records summary + usage`
- `runChild transitions status to failed on error and records error`
- `runChild transitions status to aborted (not failed) when signal is aborted`
- `runChild emits turn_started/turn_completed/turn_failed/turn_aborted events with child.childSeq`
- `runChild records external usage into the parent thread's UsageCounter`
- `aggregateChildRuns groups by ${label}:${model} and computes averages`
- `createChildAgentExecutor composes isolated (InMemory*) runtime for the child`
- `createChildAgentExecutor returns summary + usage from the child's last assistant text or error`

### 5. 使用示例

```typescript
import {
  DelegationRuntime,
  createChildAgentExecutor,
} from '@qiongqi/delegation'

// 1. Stage 1: 简单 executor
const executor = createChildAgentExecutor({
  dataDir: '/work/.qiongqi/children',
  defaultModel: 'deepseek-v4-pro',
  defaultWorkspace: '/work',
  parentContext: { apiKey, baseUrl },
})

const runtime = new DelegationRuntime({
  config: { enabled: true, maxParallel: 4, maxChildRuns: 100 },
  store,
  executor,
  usageCounter,
  eventRecorder,
  ids,
})

const result = await runtime.runChild({
  parentThreadId: 'thread_1',
  parentTurnId: 'turn_1',
  label: 'investigate-auth',
  prompt: 'Analyze the auth module for security issues',
  workspace: '/work',
  signal: controller.signal,
})
// { childId, status: 'completed', summary, usage }

// 2. 聚合
const aggregate = aggregateChildRuns(await store.list('thread_1'))
// [
//   { label: 'investigate-auth', model: 'deepseek-v4-pro', count: 3, averageTotalTokens: 5000, averageCostUsd: 0.005 },
//   ...
// ]
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 7 委派与多 Agent 层）
- 消费方：`@qiongqi/adapter-tools/delegation-tool-provider.ts` 暴露为 model 工具；`@qiongqi/http` 的 AgentCard 端点
- 源文件：[`delegation-runtime.ts`](../../packages/delegation/src/delegation-runtime.ts)、[`child-agent-executor.ts`](../../packages/delegation/src/child-agent-executor.ts)
- 测试：[`../../tests/delegation-runtime.test.ts`](../../tests/delegation-runtime.test.ts)、[`../../tests/child-agent-executor.test.ts`](../../tests/child-agent-executor.test.ts)
