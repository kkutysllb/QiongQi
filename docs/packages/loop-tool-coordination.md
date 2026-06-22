# @qiongqi/loop — Tool Coordination

> `ToolCallCoordinator` + `ToolStormBreaker` + `request-history-hygiene` + `history-healing` + 工具 helpers —— 工具协调层。
> Layer 4 — 同 orchestrator 子模块。

---

## 中文

### 1. 职责

本子模块处理**回合内的工具调用协调**：

- **`ToolCallCoordinator`** —— 工具调用分发：storm 检查 + 顺序/并行决策 + 审批 + 用户输入
- **`ToolStormBreaker`** —— 同回合重复调用抑制
- **`repairDispatchToolArguments`** —— 工具参数修复
- **`applyRequestHistoryHygiene`** —— 历史项压缩（输出/参数）
- **`healLoadedHistoryItems`** —— 加载时修复 orphan
- **`recordPipelineStage` / `recordTokenEconomySavings` / `recordToolCatalogDrift`** —— 事件辅助
- **Shared helpers** —— `PARALLEL_READ_ONLY_TOOL_NAMES` / `MAX_PARALLEL_TOOL_CALLS` / `PLAN_MODE_INSTRUCTION` / `goalContinuationInstruction` / `todoContinuationInstruction`
- **`AppendOnlySessionLog`** —— 进程内有界 session window + 磁盘 replay

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ToolCallCoordinator` | class | `tool-call-coordinator.ts` | 工具调用协调器 |
| `ToolCallCoordinatorDeps` | type | `tool-call-coordinator.ts` | 构造依赖 |
| `ToolStormBreaker` | class | `tool-storm-breaker.ts` | 重复调用抑制 |
| `ToolStormBreakerOptions` | type | `tool-storm-breaker.ts` | `{ windowSize?, threshold? }` |
| `repairDispatchToolArguments` | function | `tool-call-repair.ts` | 参数修复 |
| `ToolCallArgumentRepairOptions` / `ToolCallArgumentRepairResult` | type | `tool-call-repair.ts` | 修复配置 / 结果 |
| `applyRequestHistoryHygiene` | function | `request-history-hygiene.ts` | 历史压缩 |
| `RequestHistoryHygieneOptions` | type | `request-history-hygiene.ts` | 压缩阈值 |
| `healLoadedHistoryItems` | function | `history-healing.ts` | 加载时修复 |
| `HistoryHealingResult` | type | `history-healing.ts` | `{ items, changed }` |
| `recordPipelineStage` | function | `loop-events.ts` | 发出 `pipeline_stage` 事件 |
| `recordTokenEconomySavings` | function | `loop-events.ts` | 发出节省 + cost 估算 |
| `recordToolCatalogDrift` | function | `loop-events.ts` | 发出漂移事件 + error item |
| `PIPELINE_STAGE_LABELS` | const | `loop-events.ts` | 11 阶段显示名 |
| `PARALLEL_READ_ONLY_TOOL_NAMES` | const | `loop-helpers.ts` | `{read, grep, find, ls}` |
| `MAX_PARALLEL_TOOL_CALLS` | const | `loop-helpers.ts` | `3` |
| `PLAN_MODE_INSTRUCTION` | const | `loop-helpers.ts` | 稳定 plan-mode 提示 |
| `goalContinuationInstruction(goal)` | function | `loop-helpers.ts` | active goal 提示 |
| `todoContinuationInstruction(todos)` | function | `loop-helpers.ts` | thread todos 提示 |
| `hasSuccessfulCreatePlanResult(items, turnId)` | function | `loop-helpers.ts` | 谓词 |
| `allowedToolNamesWithGuiStateTools(...)` | function | `loop-helpers.ts` | 注入 `create_plan` 到白名单 |
| `effectiveHistoryAfterLatestCompaction(items)` | function | `loop-helpers.ts` | 切掉最新 compaction 之前 |
| `AppendOnlySessionLog` | class | `append-only-session-log.ts` | 有界 session 窗口 + 磁盘 replay |
| `DEFAULT_COMPACTION_SUMMARY_TIMEOUT_MS` / `MAX_TOKENS` / `INPUT_MAX_BYTES` | const | `token-economy.ts` | 压缩默认 |

### 3. 关键不变量

- **`ToolCallCoordinator.dispatch` 混合顺序/并行**（`tool-call-coordinator.ts:90-170`）：
  - 顺序：先 storm 检查
  - 并行安全批处理：连续 N 个 read-only 工具（最多 3 个）用 `Promise.allSettled` 并发
  - 非安全：单条顺序执行
- **`isParallelSafeToolCall` 4 条件**（`tool-call-coordinator.ts:172-181`）：
  1. 工具名在 `PARALLEL_READ_ONLY_TOOL_NAMES`
  2. `toolKind === 'tool_call'`
  3. approval policy 不是 `untrusted` / `never`
  4. provider kind === `'built-in'`
- **`executeToolCall` 错误恢复**（`tool-call-coordinator.ts:251-280`）—— 错误匹配 `'unknown tool:'` / `' is not provided by '` / `' is not advertised'` / `' is disabled by policy'` 转 `tool_dispatch_rejected` 错误 item（不抛错）。
- **`afterToolResultPersisted` for create_plan**（`tool-call-coordinator.ts:309-343`）—— `create_plan` 触发 `onPlanWritten` 副作用（plan checklist sync）。
- **Storm breaker 默认 8 窗口 + 3 阈值**（`tool-storm-breaker.ts:14-17`）—— 同 `(name, args)` 出现 3 次抑制。
- **Storm breaker 在变异工具时清空 read-only 历史**（`tool-storm-breaker.ts:34-60`）—— `write` / `edit` / `delete` 等触发 reset。
- **Storm exempt 列表**：`request_user_input` / `user_input` 不参与 storm。
- **`repairDispatchToolArguments` 文件变体不截断**（`tool-call-repair.ts:53-60`）—— `toolKind === 'file_change'` 保留长 arguments。
- **`WRAPPER_KEYS`**（`tool-call-repair.ts:15`）：`'arguments'` / `'args'` / `'input'` / `'parameters'` / `'params'` / `'payload'` / `'__raw'`。
- **`DEFAULT_MAX_STRING_BYTES = 512 * 1024`**（`tool-call-repair.ts:14`）。
- **History hygiene limits**（`request-history-hygiene.ts:11-17`）：`maxToolResultLines=320` / `maxToolResultBytes=32K` / `maxToolArgumentStringBytes=8K` / `maxArrayItems=80`。
- **History hygiene 只压缩 `tool_result` 和配对的 `tool_call`**（`request-history-hygiene.ts:42-73`）。
- **Storm breaker 跨 turn 重置**：由 `setupTurn` 调 `reset`。
- **`goalContinuationInstruction` 严格 blocked 校验**（`loop-helpers.ts:74-110`）—— 重复 3 次"必须保持原始 objective"，防止漂移。
- **`todoContinuationInstruction` 限 50 行**（`loop-helpers.ts:112-128`）。
- **`PLAN_MODE_INSTRUCTION` 字节稳定**（`loop-helpers.ts:39-47`）—— 不参与 prefix 哈希。

### 4. 行为规约

来自 `tests/tool-storm-breaker.test.ts` / `tests/tool-call-repair.test.ts` / `tests/request-history-hygiene.test.ts`：

- `ToolCallCoordinator.dispatch returns 'continue' on clean completion`
- `ToolCallCoordinator.dispatch returns 'aborted' on signal abort`
- `ToolCallCoordinator.dispatch batches up to 3 consecutive parallel-safe calls`
- `ToolCallCoordinator.dispatch suppresses the 3rd identical call via storm breaker`
- `ToolCallCoordinator.dispatch routes untrusted/never policies to sequential`
- `ToolStormBreaker.inspect returns suppress:true when count >= threshold-1`
- `ToolStormBreaker resets read-only history on mutating call`
- `ToolStormBreaker.reset clears the entire window`
- `repairDispatchToolArguments handles wrapper keys (arguments/args/input/...)`
- `repairDispatchToolArguments skips string truncation for file_change tool kind`
- `applyRequestHistoryHygiene compacts tool_result output and tool_call summary`
- `healLoadedHistoryItems repairs missing ids/callIds and returns changed=true`
- `goalContinuationInstruction requires strict blocked-audit (repeat 3x)`
- `todoContinuationInstruction truncates to 50 rows`

### 5. 使用示例

```typescript
import {
  ToolCallCoordinator, ToolStormBreaker,
  repairDispatchToolArguments, applyRequestHistoryHygiene,
  AppendOnlySessionLog,
} from '@qiongqi/loop'

// 1. Storm breaker 初始化
const storm = new ToolStormBreaker({ windowSize: 8, threshold: 3 })

// 2. Coordinator
const coordinator = new ToolCallCoordinator({
  host, threadService, turnService, eventRecorder,
  inflight, steering, ids, toolStorm: storm,
  // ...
})

// 3. Dispatch
coordinator.setupTurn('turn_1')
const result = await coordinator.dispatch({
  calls: [
    { callId: 'c1', toolName: 'read', toolKind: 'tool_call', arguments: { path: '/work/a.ts' } },
    { callId: 'c2', toolName: 'grep', toolKind: 'tool_call', arguments: { pattern: 'TODO' } },
  ],
  threadId: 'thread_1', turnId: 'turn_1', workspace: '/work',
  approvalPolicy: 'auto', signal: controller.signal,
})
// 'continue'
coordinator.cleanupTurn('turn_1')

// 4. Repair
const repaired = repairDispatchToolArguments(
  '```json\n{"command": "ls -la"}\n```',
  { toolName: 'bash', toolKind: 'command_execution' },
)
// { arguments: { command: 'ls -la' }, notes: [...] }

// 5. History hygiene
const cleaned = applyRequestHistoryHygiene(items, {
  maxToolResultLines: 320, maxToolResultBytes: 32_768,
  maxToolArgumentStringBytes: 8_192, maxToolArgumentStringTokens: 2_000,
  maxArrayItems: 80,
})
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#2-架构总览`](../architecture.zh.md#2-架构总览)（§2.2 工具协调）
- 消费方：`TurnOrchestrator` / `EventedTurnOrchestrator` 调用 `coordinator.dispatch`
- 源文件：[`tool-call-coordinator.ts`](../../packages/loop/src/tool-call-coordinator.ts)、[`tool-call-repair.ts`](../../packages/loop/src/tool-call-repair.ts)、[`tool-storm-breaker.ts`](../../packages/loop/src/tool-storm-breaker.ts)、[`request-history-hygiene.ts`](../../packages/loop/src/request-history-hygiene.ts)、[`history-healing.ts`](../../packages/loop/src/history-healing.ts)、[`loop-events.ts`](../../packages/loop/src/loop-events.ts)、[`loop-helpers.ts`](../../packages/loop/src/loop-helpers.ts)、[`append-only-session-log.ts`](../../packages/loop/src/append-only-session-log.ts)
- 测试：[`../../tests/tool-storm-breaker.test.ts`](../../tests/tool-storm-breaker.test.ts)、[`../../tests/tool-call-repair.test.ts`](../../tests/tool-call-repair.test.ts)、[`../../tests/request-history-hygiene.test.ts`](../../tests/request-history-hygiene.test.ts)
