# @qiongqi/services — Thread / Turn 服务

> `ThreadService` + `TurnService` —— 线程 CRUD + 回合生命周期。**唯一** thread/turn/item 状态变更点。
> Layer 4 — 同 recorder；额外依赖 `@qiongqi/loop`（type-only）和 `@qiongqi/adapter-tools`。

---

## 中文

### 1. 职责

#### `ThreadService`

线程 CRUD + 父子关系 + Goal/Todo 管理 + 跨 thread 的 `useThreadId` 串行化：

- `list / get / create / update` —— 基础 CRUD
- `fork / resume` —— 父子线程派生
- `getGoal / setGoal / clearGoal` —— 目标管理
- `getTodos / setTodos / clearTodos` —— Todo 列表
- **`withThreadLock(threadId, fn)`** —— 内部串行化助手，所有 mutator 通过它排队

#### `TurnService`

回合生命周期（start/finish/abort/steer/compact）：

- `startTurn` —— 创建 Turn 记录 + AbortController + 注册到 `inflightTurns` + 启动 `SteeringQueue`
- `interruptTurn` —— abort 控制器 + 清空 steering + finalizes open items
- `compact` —— 调用 compactor + 发 `compaction_completed` 事件
- `applyItem` / `updateItem` —— 写 session store + 发 `item_created/updated`
- `finishTurn` —— finalizes open items + 设置终态 status
- `updateTurnMetadata` —— patch-only 更新 `activeSkillIds` / `injectedMemoryIds` / `toolCatalogFingerprint` / `toolCatalogDrift` 等

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ThreadService` | class | `thread-service.ts` | 线程服务 |
| `ThreadServiceOptions` | type | `thread-service.ts` | 构造依赖：`{ threadStore, sessionStore, eventRecorder, ... }` |
| `ListThreadsOptions` | type | `thread-service.ts` | list 查询选项 |
| `ForkThreadOptions` | type | `thread-service.ts` | fork 参数 |
| `ResumeSessionOptions` / `ResumeSessionResult` | type | `thread-service.ts` | session 恢复 |
| `SyncPlanTodosOptions` | type | `thread-service.ts` | 计划 todo 同步 |
| `TurnService` | class | `turn-service.ts` | 回合服务 |
| `TurnServiceOptions` | type | `turn-service.ts` | 构造依赖：`{ threadService, sessionStore, eventRecorder, inflight, steering, compactor, contextCompaction, modelContextProfile, ids }` |
| `TurnStatus` | type | `turn-service.ts` | `'idle' \| 'running' \| 'completed' \| 'failed' \| 'aborted'` |

#### `ThreadService` 关键方法

```typescript
list(options?: ListThreadsOptions): Promise<ThreadSummary[]>
get(threadId: string): Promise<ThreadRecord | null>
create(input: CreateThreadRequest): Promise<ThreadRecord>
update(threadId: string, patch: UpdateThreadRequest): Promise<ThreadRecord>
delete(threadId: string): Promise<boolean>
fork(threadId: string, options?: ForkThreadOptions): Promise<ThreadRecord>
resume(options: ResumeSessionOptions): Promise<ResumeSessionResult>
getGoal(threadId): getGoalResponse
setGoal(threadId, request): ThreadGoal
clearGoal(threadId): cleared
getTodos / setTodos / clearTodos
syncPlanTodos(threadId, options): ThreadTodoList
withThreadLock(threadId, fn): Promise<T>  // internal serialization
```

#### `TurnService` 关键方法

```typescript
startTurn(threadId, request): { turnId, status }
interruptTurn(threadId, turnId, { discard? }): aborted
compact(threadId, turnId?, request): { summary, replacedTokens, ... }
applyItem(threadId, turnItem): item
updateItem(threadId, turnId, itemId, patch): TurnItem | null
finishTurn(threadId, turnId, { status, error? }): final
updateTurnMetadata(threadId, turnId, patch): metadata
getAbortController(turnId): AbortController
```

### 3. 关键不变量

- **`withThreadLock` 串行化所有 mutator**：`ThreadService` 内部用 `Map<threadId, Promise<void>>` 链式排队，并发 `upsertThread` 永不交错（`thread-service.ts:128` 区域）。
- **`TurnService.getAbortController(turnId)` 是 canonical signal**：Engine 与 Tools 都通过它收 abort；`interruptTurn` abort 该 controller + 清空 steering + 移除 inflight（`turn-service.ts:233`）。
- **`finishTurn` 的 finalize**：
  - 设置终态 status（`completed` / `failed` / `aborted`）
  - 若 `error` 存在，append `error` item
  - finalize 所有 open items（`approval → expired` / `user_input → cancelled` / 其他 → `aborted`/`failed`）
  - 清空 `steering: []`
- **`applyItem` 写顺序**：先 `sessionStore.appendItem`，再 emit `item_created` 事件 —— 确保订阅者总是看到已持久化的 item。
- **`compact` 发出 `compaction_completed`**：包含 `summary` / `replacedTokens` / `pinnedConstraints` / `sourceDigest` / `digestMarker` / `sourceItemIds`（`turn-service.ts:136`）。
- **Goal `setGoal` 状态转换**：`active` / `paused` / `blocked` / `usageLimited` / `budgetLimited` / `complete` 之间合法转换由 schema 强制（`@qiongqi/contracts/threads.ts`）。
- **Todo `setTodos` 至多一个 `in_progress`**：通过 `ThreadTodoListSchema.superRefine` 在 `contracts` 层强制；`setTodos` 自身再做 normalize。

### 4. 行为规约

来自 `tests/thread-service.test.ts` / `tests/`:（turn-service 测试通过 loop 间接覆盖）

- `list filters archived/deleted by default, includes when includeArchived is true`
- `list filters side threads unless includeSide is true`
- `list applies the search predicate`
- `list respects the limit option (sorted by updatedAt desc)`
- `create advances the id generator even when an explicit id is supplied (so fork does not collide)`
- `fork creates a new thread with relation:'fork' and copies forkedFrom* metadata`
- `update requires at least one field change (enforced by zod refine)`
- `setGoal requires either an existing goal or a non-empty objective`
- `setTodos normalizes content trimming + at-most-one in_progress enforcement`
- `startTurn registers an AbortController in the inflight map and starts the SteeringQueue`
- `interruptTurn aborts the controller, clears steering, removes from inflight, optionally discards items`
- `compact runs the compactor with a synthetic prefix and emits compaction_completed`
- `finishTurn clears steering and finalizes open items (approval/user_input/tool)`
- `updateTurnMetadata applies patches without creating new items`

### 5. 使用示例

```typescript
import { ThreadService, TurnService } from '@qiongqi/services'

// 1. 创建线程
const thread = await threadService.create({
  title: 'My work',
  workspace: '/work',
  model: 'deepseek-v4-pro',
  mode: 'agent',
})

// 2. Fork
const forked = await threadService.fork(thread.id, {
  relation: 'side',
  title: 'Side investigation',
})

// 3. 启动回合
const { turnId } = await turnService.startTurn(thread.id, {
  prompt: 'Refactor the auth module',
})

// 4. 流式 append items
await turnService.applyItem(thread.id, {
  id: 'item_user_1',
  turnId,
  threadId: thread.id,
  role: 'user',
  status: 'completed',
  createdAt: new Date().toISOString(),
  kind: 'user_message',
  text: 'Refactor the auth module',
})

// 5. 中断
await turnService.interruptTurn(thread.id, turnId, { discard: true })
// 所有 open items 状态：approval → expired, user_input → cancelled, others → aborted
// turn.status → 'aborted'

// 6. 压缩
await turnService.compact(thread.id, turnId, {
  pinnedConstraints: ['user: preserve recent turns'],
})
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#2-架构总览`](../architecture.zh.md#2-架构总览)（§2.2 TurnService 唯一状态变更点）
- 消费方：`@qiongqi/loop/TurnOrchestrator` + `EventedTurnOrchestrator`；`@qiongqi/http` 的 thread/turn routes
- 源文件：[`thread-service.ts`](../../packages/services/src/thread-service.ts)、[`turn-service.ts`](../../packages/services/src/turn-service.ts)
- 测试：[`../../tests/thread-service.test.ts`](../../tests/thread-service.test.ts)
