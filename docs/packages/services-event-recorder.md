# @qiongqi/services — 事件录制器

> `RuntimeEventRecorder` —— 引擎**唯一**事件生产者，负责 seq 分配、Zod 校验、fan-out、落盘。
> Layer 4 — 依赖：`@qiongqi/contracts`、`@qiongqi/domain`、`@qiongqi/ports`、`@qiongqi/loop`（type-only）、`@qiongqi/adapter-tools`、`@qiongqi/tool-infra`、`@qiongqi/cache`。

---

## 中文

### 1. 职责

`RuntimeEventRecorder` 是 Qiongqi 事件系统的**单一边界**：

- 给每条 event 分配**单调 per-thread seq**（基于 `eventBus.allocateSeq` 或显式传入）
- **校验** event 形状（`RuntimeEventSchema.parse`）
- **stamp timestamp**（缺省时使用 `Clock.nowIso`）
- **fan-out**：调用 `eventBus.publish(event)` 通知所有 SSE 订阅者
- **持久化**：`sessionStore.appendEvent(...)` 落盘用于重连补偿

所有其他组件（PromptBuilder、ModelStepRunner、ToolCallCoordinator、ContinutationPolicy 等）**只**产出 `RuntimeEventDraft`；recorder 是唯一调 `eventBus.publish` + `sessionStore.appendEvent` 的代码路径。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `RuntimeEventRecorder` | class | `runtime-event-recorder.ts` | 唯一事件生产者 |
| `RuntimeEventRecorderOptions` | type | `runtime-event-recorder.ts` | 构造依赖：`{ eventBus, sessionStore, clock?, allocateSeq? }` |
| `RuntimeEventDraft` | type | `runtime-event-recorder.ts` | `Omit<RuntimeEvent, 'seq' \| 'timestamp'>` —— 待 stamp 的事件草稿 |
| `record(draft)` | method | `runtime-event-recorder.ts` | stamp + 校验 + fan-out + 落盘；返回带 `seq` / `timestamp` 的完整事件 |

### 3. 关键不变量

- **唯一事件生产者**：所有 `eventBus.publish` + `sessionStore.appendEvent` 都走 `RuntimeEventRecorder`；其他组件通过 `record(draft)` 提交（`runtime-event-recorder.ts`）。
- **seq 分配算法**：
  1. `allocatedSeq = allocateSeq(threadId)` —— 来自 `eventBus.allocateSeq` 或 recorder 内部 Map
  2. `persistedSeq = sessionStore.highestSeq(threadId)`
  3. `seq = draft.seq ?? max(allocatedSeq, persistedSeq + 1)` —— 让"跨重启后第一次分配"也能选到正确的 seq
- **Zod 校验**：`RuntimeEventSchema.parse(...)` 在 stamp 之后，确保非法事件不会泄漏到总线/落盘。
- **fan-out 顺序**：先 `eventBus.publish`（通知内存订阅者），再 `sessionStore.appendEvent`（落盘）—— SSE 订阅者通常先于持久化看到事件。
- **`RuntimeEventDraft.seq` 是可覆盖的**：调用方可显式传入 `seq`（用于 replay / 测试）；否则按算法分配。
- **`timestamp` 同样可覆盖**：缺省时用 `clock.nowIso()`，否则用 draft 提供的字符串。

### 4. 行为规约

来自 `tests/`:（recorder 在 services 集中测）

- `record assigns a monotonic per-thread seq when no seq is provided`
- `record respects a provided seq (replay / re-emit scenarios)`
- `record stamps timestamp when not provided`
- `record validates via RuntimeEventSchema (Zod errors propagate as exceptions)`
- `record publishes to eventBus before persisting to sessionStore (fan-out order)`
- `record advances the in-memory seq counter to max(allocated, persisted+1)`
- `record returns the validated + stamped event (caller may inspect)`

### 5. 使用示例

```typescript
import { RuntimeEventRecorder } from '@qiongqi/services'

const recorder = new RuntimeEventRecorder({
  eventBus,        // 任意实现（生产用 InMemoryEventBus）
  sessionStore,    // 任意实现
  clock: systemClock,
})

// 1. 组件产出 draft
const draft: RuntimeEventDraft = {
  kind: 'turn_started',
  threadId: 'thread_1',
  turnId: 'turn_1',
}

// 2. recorder 接管
const event = recorder.record(draft)
// event.seq === 1
// event.timestamp === '2026-...'

// 3. 显式 seq（replay 场景）
recorder.record({ ...draft, seq: 42 })
// event.seq === 42（如果 42 > 当前 allocated/persisted）

// 4. Zod 校验失败
recorder.record({ kind: 'unknown_kind' } as any) // throws ZodError
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#2-架构总览`](../architecture.zh.md#2-架构总览)（§2.2 RuntimeEventRecorder 唯一事件生产者）
- 消费方：`@qiongqi/loop` 的所有事件触发点（PromptBuilder, ModelStepRunner, ToolCallCoordinator）
- 源文件：[`runtime-event-recorder.ts`](../../packages/services/src/runtime-event-recorder.ts)
