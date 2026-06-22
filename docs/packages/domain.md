# @qiongqi/domain

> 纯领域实体与值对象（无 I/O）。
> Layer 1 — 依赖：`@qiongqi/contracts`。被 `@qiongqi/services`、`@qiongqi/loop` 消费。

---

## 中文

### 1. 职责

`@qiongqi/domain` 是 Qiongqi 的**纯领域层**。它不读写文件、不做 I/O，只提供：

- **实体工厂**：`createThreadRecord` / `createTurnRecord` / 10 种 `makeXxxItem`
- **不可变更新**：`appendTurnItem`（idempotent，按 id 去重）/ `replaceTurnItem` / `touchThread`
- **状态机**：`startTurn` / `finishTurn`（`finishTurn` 自动清空 `steering: []`）
- **事件归约器**：`replayRuntimeEvents` + `applyRuntimeEvent` — 单一职责把 runtime event 流重建为完整 projection（SSE 重连补偿的核心）
- **历史修复**：`repairModelHistoryItems` — 切掉 model 不会看到的 GUI-only 桥接项
- **Approval 状态机**：`createApprovalRequest` / `resolveApprovalRequest` / `expireApprovalRequest`
- **Session 投影**：`createAgentSession` / `appendSessionItem` / `closeSession`（append-only）
- **Usage 聚合**：`addUsage`（纯合并；保留 `null` 表示"未知"）

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ThreadEntity` | type | `thread.ts` | `= ThreadRecord` |
| `createThreadRecord` | function | `thread.ts` | 线程工厂；默认 mode=`agent`、status=`idle`、relation=`primary` |
| `touchThread` | function | `thread.ts` | 更新 `updatedAt` 字段 |
| `toThreadSummary` | function | `thread.ts` | 投影为 list 视图（剔除 `turns` 数组）|
| `TurnEntity` | type | `turn.ts` | `= Turn` |
| `createTurnRecord` | function | `turn.ts` | 回合工厂；`reasoningEffort === 'auto'` 归一为 undefined |
| `appendTurnItem` | function | `turn.ts` | idempotent：同 id 替换，否则追加 |
| `replaceTurnItem` | function | `turn.ts` | 按 itemId 浅合并 patch |
| `startTurn` | function | `turn.ts` | `status='running'` + `startedAt` |
| `finishTurn` | function | `turn.ts` | `status` 设为 terminal + 清空 `steering: []` |
| `ItemEntity` | type | `item.ts` | `= TurnItem` |
| `makeUserItem` / `makeAssistantTextItem` / `makeAssistantReasoningItem` / `makeToolCallItem` / `makeToolResultItem` / `makeApprovalItem` / `makeUserInputItem` / `makeCompactionItem` / `makeReviewItem` / `makeErrorItem` | function | `item.ts` | 10 种 typed factory；`makeToolResultItem` 自动 stamp `finishedAt` for terminal status |
| `EventEntity` | type | `event.ts` | `= RuntimeEvent` |
| `compareEventSeq` | function | `event.ts` | 按 `seq` 升序比较（用于 SSE 重放 + inflight 排序）|
| `groupEventsByKind` | function | `event.ts` | 按 `kind` 分桶（用于 chat block 转换 + 测试断言）|
| `EventSourcedRuntimeProjection` | type | `runtime-event-reducer.ts` | 事件归约后的完整状态投影（threadId, lastSeq, turns, items, usage, childRuns, compactions, errors, toolCatalog）|
| `EventSourcedTurnProjection` / `EventSourcedChildRunProjection` | type | `runtime-event-reducer.ts` | 单 turn / 单 child 投影 |
| `createRuntimeEventProjection` | function | `runtime-event-reducer.ts` | 空投影工厂 |
| `replayRuntimeEvents` | function | `runtime-event-reducer.ts` | 事件数组 → projection（先按 `seq` 排序，再 fold）|
| `applyRuntimeEvent` | function | `runtime-event-reducer.ts` | 单事件 reducer；`seq <= lastSeq` 忽略（idempotent）|
| `repairModelHistoryItems` | function | `model-history-repair.ts` | 切掉 model-bound 序列里的 GUI-only 桥接项（reasoning / approval / user_input / error）|
| `isToolResultBridgeItem` | function | `model-history-repair.ts` | 判定某项是否是 tool result 之间的桥接项（model 会忽略）|
| `ApprovalRequest` | type | `approval.ts` | 审批实体 |
| `createApprovalRequest` | function | `approval.ts` | 工厂；status 初始 `pending` |
| `resolveApprovalRequest` | function | `approval.ts` | 决策后状态：`allow → 'allowed'` / `deny → 'denied'` |
| `expireApprovalRequest` | function | `approval.ts` | 超时：status → `'expired'` |
| `AgentSession` | type | `session.ts` | 会话投影（items + events + closed）|
| `createAgentSession` / `appendSessionItem` / `updateSessionItem` / `appendSessionEvent` / `closeSession` | function | `session.ts` | session 不可变更新助手（idempotent by id / seq）|
| `UsageEntity` | type | `usage.ts` | `= UsageSnapshot` |
| `zeroUsage` | function | `usage.ts` | 空 snapshot 工厂 |
| `addUsage` | function | `usage.ts` | 纯合并；`null` 保留；cost 字段 `undefined + undefined → undefined` |

### 3. 关键不变量

- **不可变更新**：所有 `xxx(thread, ...)` 函数都返回**新**对象（`{ ...thread, ... }`），原对象不变。
- **`appendTurnItem` idempotent by id**：同 id 重复追加会被**替换**而非重复添加（`turn.ts:43-51`）。
- **`finishTurn` 清空 `steering`**：回合结束时 `steering: []`（`turn.ts:74-85`）——避免下一回合意外消费上一次的转向消息。
- **`makeToolResultItem` 自动 stamp `finishedAt`**：当 `status ∈ {completed, failed, aborted}` 且未显式提供时，自动 `new Date().toISOString()`（`item.ts:115-128`）。
- **`repairModelHistoryItems` 是 model-bound 切分器**：保留 `tool_call` 链中"属于该 turn 内的"项 + 配对的 `tool_result`；切掉 `assistant_reasoning` / `approval` / `user_input` / `error` / 同 turn 的 `assistant_text`（这些 model 会忽略，保留只会让 prompt 变长）（`model-history-repair.ts:11-64`）。
- **`replayRuntimeEvents` 排序后 fold**：先 `[...events].sort((a, b) => a.seq - b.seq)` 再 reduce，保证乱序事件也能正确归约（`runtime-event-reducer.ts:90-97`）。
- **`applyRuntimeEvent` 拒绝旧 seq**：`event.seq <= projection.lastSeq` 直接返回原 projection（idempotent）（`runtime-event-reducer.ts:103`）。
- **`appendDelta` 仅合并 text/reasoning delta**：`assistant_text_delta` 与 `assistant_reasoning_delta` 同 id 出现时，第二个的 `text` **追加**到第一个的 `text`（SSE 晚加入者看到完整文本而非每一片段）（`runtime-event-reducer.ts:351-364`）。
- **`addUsage` 保留 `null` vs `undefined` 语义**：`cacheHitRate` 为 `null` 表示"未知"（cacheHit+cacheMiss=0）；cost 类字段两侧都 `undefined` 时保持 `undefined`（`usage.ts:25-50`）。
- **`AgentSession` append-only by id/seq**：`appendSessionItem` 同 id 跳过；`appendSessionEvent` 同 seq 跳过（`session.ts:39-84`）。

### 4. 行为规约

来自 `tests/domain.test.ts` 的 `it()` 行为描述：

#### Thread

- `createThreadRecord defaults mode to 'agent' and status to 'idle'` — 缺省值正确
- `createThreadRecord applies DEFAULT_APPROVAL_POLICY and DEFAULT_SANDBOX_MODE`
- `touchThread updates updatedAt to the provided ISO string`
- `toThreadSummary omits the turns array and preserves goal/todos fields`

#### Turn

- `createTurnRecord normalizes reasoningEffort='auto' to undefined`
- `appendTurnItem is idempotent: append the same id twice, get the same items array`
- `appendTurnItem replaces when an item with the same id already exists`
- `replaceTurnItem shallow-merges a patch into the matching item`
- `finishTurn clears the steering queue regardless of status`

#### Item

- `makeToolResultItem auto-stamps finishedAt for terminal status`
- `makeUserItem filters out empty attachmentIds`
- `makeUserItem omits displayText when it equals the canonical text`
- `makeCompactionItem preserves sourceDigest + digestMarker + sourceItemIds only when provided`

#### RuntimeEventReducer

- `replayRuntimeEvents sorts events by seq before folding`
- `applyRuntimeEvent ignores out-of-order events (seq <= lastSeq)`
- `applyRuntimeEvent merges assistant_text_delta text across multiple events with the same item id`
- `applyRuntimeEvent accumulates child run status across delegated turns`
- `applyRuntimeEvent produces a compactions record for compaction_completed events`

#### ModelHistoryRepair

- `repairModelHistoryItems keeps tool_call+tool_result pairs and drops GUI-only bridge items`
- `repairModelHistoryItems drops orphan tool_call items that have no matching result`
- `repairModelHistoryItems preserves assistant_text when it appears before any tool result`

#### Approval

- `createApprovalRequest defaults status to 'pending'`
- `resolveApprovalRequest maps 'allow' → 'allowed', 'deny' → 'denied'`
- `expireApprovalRequest sets status to 'expired' and stamps decidedAt`

#### Session

- `appendSessionItem is idempotent by id`
- `appendSessionEvent is idempotent by seq`
- `closeSession sets closed=true and updates updatedAt`

#### Usage

- `addUsage preserves cacheHitRate=null when no cache metrics are present`
- `addUsage leaves costUsd/costCny undefined when neither side has a value`
- `addUsage accumulates tokenEconomySavings* across both sides`

### 5. 使用示例

```typescript
import {
  createThreadRecord,
  createTurnRecord,
  appendTurnItem,
  startTurn,
  finishTurn,
  makeUserItem,
  makeAssistantTextItem,
  replayRuntimeEvents,
  repairModelHistoryItems,
} from '@qiongqi/domain'
import { RuntimeEvent } from '@qiongqi/contracts'

// 1. 创建线程 + 回合
const thread = createThreadRecord({
  id: 'thread_1',
  title: 'My thread',
  workspace: '/work',
  model: 'deepseek-v4-pro',
})

let turn = createTurnRecord({
  id: 'turn_1',
  threadId: thread.id,
  prompt: 'Refactor the auth module',
})
turn = startTurn(turn)

// 2. 流式 appendTurnItem
turn = appendTurnItem(turn, makeUserItem({
  id: 'item_user_1', turnId: turn.id, threadId: thread.id,
  text: 'Refactor the auth module',
}))
turn = appendTurnItem(turn, makeAssistantTextItem({
  id: 'item_text_1', turnId: turn.id, threadId: thread.id,
  text: 'Let me look at the auth module first…',
  status: 'running',
}))
turn = finishTurn(turn, 'completed')

// 3. SSE 重连：重建 projection
const events: RuntimeEvent[] = await sessionStore.loadEventsSince(thread.id, sinceSeq)
const projection = replayRuntimeEvents(events)
// → { threadId, lastSeq, turns, items, usage, childRuns, compactions, errors, toolCatalog }

// 4. 修复 model-bound history
const modelItems = repairModelHistoryItems(turn.items)
// 切掉 approval / user_input / error 桥接项；保留 tool_call + 配对 tool_result
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#2-架构总览`](../architecture.zh.md#2-架构总览)（§2.2 RuntimeEventRecorder 唯一事件生产者）
- 消费方：`@qiongqi/services` 用所有工厂 + reducer；`@qiongqi/loop` 用 `startTurn` / `finishTurn` / `appendTurnItem` / `repairModelHistoryItems`
- 源文件：[`thread.ts`](../../packages/domain/src/thread.ts)、[`turn.ts`](../../packages/domain/src/turn.ts)、[`item.ts`](../../packages/domain/src/item.ts)、[`runtime-event-reducer.ts`](../../packages/domain/src/runtime-event-reducer.ts)、[`model-history-repair.ts`](../../packages/domain/src/model-history-repair.ts)、[`approval.ts`](../../packages/domain/src/approval.ts)、[`session.ts`](../../packages/domain/src/session.ts)、[`usage.ts`](../../packages/domain/src/usage.ts)、[`event.ts`](../../packages/domain/src/event.ts)
- 测试：[`../../tests/domain.test.ts`](../../tests/domain.test.ts)（17 个用例）
