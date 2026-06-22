# @qiongqi/loop — Orchestrator

> `TurnOrchestrator` + `EventedTurnOrchestrator` + `TurnEventBus` + `TurnStateV1` + `InflightTracker` + `SteeringQueue` —— 回合编排器（classic / evented 双轨）。
> Layer 4 — 依赖：`@qiongqi/contracts`、`@qiongqi/domain`、`@qiongqi/ports`、`@qiongqi/cache`、`@qiongqi/services`（type-only）、`@qiongqi/adapter-tools`、`@qiongqi/adapter-model`、`@qiongqi/attachments`、`@qiongqi/skills`、`@qiongqi/memory`。

---

## 中文

### 1. 职责

本子模块是**回合编排的心脏**：

- **`TurnOrchestrator`** —— 经典命令式循环，组装 `PromptBuilder` / `ModelStepRunner` / `ContinuationPolicy` / `ToolCallCoordinator` 4 个子组件
- **`EventedTurnOrchestrator`**（Stage 3）—— 事件驱动 + 崩溃恢复（`TurnStateV1` 持久化）
- **`runOrchestratorStep`** —— 共享纯函数 step 实现，被两 orchestrator 共用
- **`TurnEventBus`** —— 进程内 pub/sub 事件总线（`on(kind, fn)` / `emit`）
- **`TurnStateV1` / `FileTurnStateStore`** —— 崩溃恢复序列化
- **`InflightTracker`** —— SSE begin/end 对的权威来源
- **`SteeringQueue`** —— 回合内转向消息队列

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `TurnOrchestrator` | class | `turn-orchestrator.ts` | 经典编排器 |
| `TurnOrchestratorOptions` | type | `turn-orchestrator.ts` | 30+ 依赖字段 |
| `runOrchestratorStep` | function | `turn-orchestrator.ts` | 共享 step 纯函数 |
| `EventedTurnOrchestrator` | class | `evented-turn-orchestrator.ts` | 事件驱动 + 崩溃恢复 |
| `TurnEventBus` | class | `turn-event-bus.ts` | pub/sub 事件总线 |
| `StepSubscriberDeps` / `StepContext` | type | `turn-event-bus.ts` | 订阅者依赖 + 上下文 |
| `createPromptSubscriber` | function | `turn-event-bus.ts` | 占位（未来 peer 编排）|
| `runStepViaEventBus` | function | `turn-event-bus.ts` | 事件驱动 step 执行（仍调用相同组件）|
| `TurnStepEvent` | type | `turn-event-types.ts` | 步级事件可辨识联合（`step:start` / `step:steering` / `prompt:built` / `model:ran` / `decision` / `tools:dispatched` / `step:end` / `turn:failed`）|
| `TurnStateV1` | type | `turn-event-types.ts` | 可序列化回合状态 |
| `TurnStateSerializer` | interface | `turn-event-types.ts` | `save` / `load` / `delete` / `list` |
| `FileTurnStateStore` | class | `turn-state-store.ts` | 文件持久化（`<dataDir>/<threadId>/turns/<turnId>/state.json`）|
| `ORCHESTRATION_MODES` | const | `turn-event-types.ts` | `['classic', 'evented']` |
| `OrchestrationMode` | type | `turn-event-types.ts` | 同上 |
| `InflightTracker` | class | `inflight-tracker.ts` | inflight 资源跟踪 |
| `InflightKind` | type | `inflight-tracker.ts` | `'model' \| 'tool'` |
| `InflightRecord` | type | `inflight-tracker.ts` | `{ id, kind, threadId, turnId?, callId?, startedAt }` |
| `SteeringQueue` | class | `steering-queue.ts` | per-turn 字符串队列 |

### 3. 关键不变量

- **`TurnOrchestrator` 是单进程内显式协调器**（`turn-orchestrator.ts:1-16` 注释）—— 不依赖 event bus；每步是直接的 `runStep()` 调用。
- **`runTurn` 三个硬边界**（`turn-orchestrator.ts:187`）：
  1. **`AbortSignal`** —— 每步顶部检查 `signal.aborted`
  2. **per-thread cost budget** —— `PromptBuilder.build` 顶部检查；超 budget 发 `error` item
  3. **inflight 资源清理** —— `cleanupTurn` 调用 storm breaker reset + inflight clear
- **`runOrchestratorStep` 是纯函数**（`turn-orchestrator.ts:351-358` 注释）—— 让 `EventedTurnOrchestrator` 能 wrap 它在 `TurnStepEvent` 录制中。
- **Evented 状态持久化时机**（`evented-turn-orchestrator.ts:128-141`）：每步**前**持久化（崩溃后可从该 step 恢复）。
- **Evented 状态清理时机**（`evented-turn-orchestrator.ts:182-185`）：完成 / 失败 / 中止时**删除** state.json（避免残留）。
- **`InflightTracker.run` 担保清理**（`inflight-tracker.ts:40-50`）—— `try / finally` 确保 SSE begin/end 对永不泄漏。
- **`SteeringQueue.setTurn` 切换清空**（`steering-queue.ts:11-16`）—— 避免上一回合消息被下一回合消费。
- **`TurnEventBus` 是同步**（`turn-event-bus.ts:12-19`）—— `emit` 立即调用订阅者，订阅者返回值取首个非 void。
- **`TurnStateV1` 含 `stepIndex`** —— 崩溃恢复的关键（`turn-state-store.ts`）。
- **`createPromptSubscriber` 是占位**（`turn-event-bus.ts`）—— Stage 3 未来扩展为 peer-style 协作。

### 4. 行为规约

来自 `tests/runtime-factory.test.ts` / `tests/serve.test.ts` / `tests/cli-agent.test.ts`（集成覆盖）：

- `TurnOrchestrator.runTurn returns 'completed' on clean exit`
- `TurnOrchestrator.runTurn returns 'aborted' when signal is aborted mid-step`
- `TurnOrchestrator.runTurn returns 'failed' on tool dispatch or model errors`
- `EventedTurnOrchestrator.runTurn resumes from previous.stepIndex after a crash`
- `EventedTurnOrchestrator deletes state.json on completion / failure / abort`
- `EventedTurnOrchestrator emits a step:start / step:end around each runStep`
- `InflightTracker.run registers before, guarantees end() in finally`
- `InflightTracker.abortAll returns id+reason markers for tool cleanup`
- `SteeringQueue.enqueue trims and pushes; switch turns clears the buffer`
- `SteeringQueue.drain returns and clears in one step`
- `TurnEventBus.on(kind, fn) returns an unsubscribe function`
- `FileTurnStateStore saves/loads/deletes/listed by (threadId, turnId)`

### 5. 使用示例

```typescript
import { TurnOrchestrator, TurnEventBus, InflightTracker, SteeringQueue } from '@qiongqi/loop'

// 1. Classic
const orchestrator = new TurnOrchestrator({
  threadService, turnService, eventRecorder, usageService, inflight, steering,
  promptBuilder, modelStepRunner, continuationPolicy, toolCallCoordinator,
  ids, contextCompaction, toolStorm, modelCapabilities, activePlanContext,
  // ... 30+ 字段
})

const status = await orchestrator.runTurn('thread_1', 'turn_1')
// 'completed' | 'aborted' | 'failed'

// 2. Evented
const bus = new TurnEventBus()
bus.on('step:start', (event) => console.log('Step start:', event.stepIndex))
bus.on('step:end', (event) => console.log('Step end:', event.decision))

const evented = new EventedTurnOrchestrator({
  // ... 同样的 30+ 字段
  eventBus: bus,
  stateStore: new FileTurnStateStore({ rootDir: '/work/.qiongqi/state' }),
  orchestrationMode: 'evented',
})

// 3. 崩溃恢复
const state = await evented.loadPreviousState('thread_1', 'turn_1')
// state.stepIndex === 1 (从 step 1 恢复)

// 4. Steering
const steering = new SteeringQueue()
steering.setTurn('turn_1')
steering.enqueue('turn_1', 'Actually, focus on the security issues')
const drained = steering.drain() // ['Actually, focus on the security issues']
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#4-关键架构决策`](../architecture.zh.md#4-关键架构决策)（§4.4 OrchestrationMode 双轨）
- 消费方：`@qiongqi/http` 的 `createAgent` 选 classic/evented；`@qiongqi/delegation` 的 `ChildAgentExecutor` 装配独立 orchestrator
- 源文件：[`turn-orchestrator.ts`](../../packages/loop/src/turn-orchestrator.ts)、[`evented-turn-orchestrator.ts`](../../packages/loop/src/evented-turn-orchestrator.ts)、[`turn-event-bus.ts`](../../packages/loop/src/turn-event-bus.ts)、[`turn-event-types.ts`](../../packages/loop/src/turn-event-types.ts)、[`turn-state-store.ts`](../../packages/loop/src/turn-state-store.ts)、[`inflight-tracker.ts`](../../packages/loop/src/inflight-tracker.ts)、[`steering-queue.ts`](../../packages/loop/src/steering-queue.ts)
- 验证脚本：[`../../scripts/verify-crash-recovery.mjs`](../../scripts/verify-crash-recovery.mjs)（端到端崩溃恢复）
