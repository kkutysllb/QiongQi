# @qiongqi/loop — Orchestrator

> `TurnOrchestrator` + `EventedTurnOrchestrator` + `EventedV2MultiAgentRuntime` + `EventedV2OutboxReconciler` + `LoopRunner` + `LoopPlan` + `LoopRun/TurnStateV2` + `TurnEventBus` + `InflightTracker` + `SteeringQueue` —— 回合编排器与多 Agent 编排 shell（classic / evented / evented_v2 / kernel_v3）。
> Layer 4 — 依赖：`@qiongqi/contracts`、`@qiongqi/domain`、`@qiongqi/ports`、`@qiongqi/cache`、`@qiongqi/services`（type-only）、`@qiongqi/adapter-tools`、`@qiongqi/adapter-model`、`@qiongqi/attachments`、`@qiongqi/skills`、`@qiongqi/memory`。

---

## 中文

### 1. 职责

本子模块是**回合编排的心脏**：

- **`TurnOrchestrator`** —— 经典命令式循环，组装 `PromptBuilder` / `ModelStepRunner` / `ContinuationPolicy` / `ToolCallCoordinator` 4 个子组件
- **`EventedTurnOrchestrator`** —— `LoopRunner` 驱动的 evented loop shell + 崩溃恢复（`LoopRun` / `TurnStateV2` 持久化）
- **`EventedV2MultiAgentRuntime`** —— `evented_v2` 的多 Agent 编排 shell，当前支持 durable run、mailbox、manager-to-specialist handoff、agent task completion、外部 wait/tool/judge 节点恢复、run 内持久化 outbox + `flushPendingOutbox()` / `flushAllPendingOutbox()` 恢复投递，以及 `timeline()` / `metrics()` 只读管理投影
- **`EventedV2AgentWorker`** —— 通用 agent task worker，负责从 mailbox claim task、运行注入的 agent handler、提交结果并 complete mailbox
- **`EventedV2OutboxReconciler`** —— 可嵌入 worker / server lifecycle 的周期性 outbox flush 外壳，提供 `flushOnce()` / `start()` / `stop()` / `isRunning()` 与 flush 结果回调
- **`LoopPlan` / `LoopRunner` / `LoopEvaluator`** —— 声明式 phase spec、phase 解释器与确定性评估/重试策略
- **`runOrchestratorStep`** —— classic 路径的共享 step 实现
- **`TurnEventBus`** —— 进程内 pub/sub 事件总线（`on(kind, fn)` / `emit`）
- **`LoopRun` / `TurnStateV2` / `FileTurnStateStore`** —— evented 崩溃恢复序列化；legacy `TurnStateV1` 会在 load 时升级
- **`InflightTracker`** —— SSE begin/end 对的权威来源
- **`SteeringQueue`** —— 回合内转向消息队列

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `TurnOrchestrator` | class | `turn-orchestrator.ts` | 经典编排器 |
| `TurnOrchestratorOptions` | type | `turn-orchestrator.ts` | 30+ 依赖字段 |
| `runOrchestratorStep` | function | `turn-orchestrator.ts` | classic step 纯函数 |
| `EventedTurnOrchestrator` | class | `evented-turn-orchestrator.ts` | 事件驱动 + 崩溃恢复 |
| `EventedV2MultiAgentRuntime` | class | `evented-v2-multi-agent-runtime.ts` | `evented_v2` 多 Agent 编排 shell；handoff 写入 run outbox，`completeAgentTask()` / `completeExternalNode()` 按 graph edge 推进，`flushPendingOutbox(runId)` / `flushAllPendingOutbox()` 可恢复 mailbox 投递，`timeline()` / `metrics()` 暴露只读观测面 |
| `buildEventedV2RunTimeline` / `buildEventedV2RunMetrics` | function | `evented-v2-observability.ts` | 将 `MultiAgentRun` 投影为 timeline，或将 run 列表聚合为 status / agent-run / outbox 指标 |
| `EventedV2AgentWorker` | class | `evented-v2-multi-agent-runtime.ts` | claim mailbox task、执行 agent handler、提交 agent 结果并 complete mailbox |
| `EventedV2OutboxReconciler` | class | `evented-v2-multi-agent-runtime.ts` | 周期性调用 `flushAllPendingOutbox()`；提供 `start` / `stop` / `isRunning` / `onFlush` / `onError` 生命周期与观测 hook |
| `LoopPlan` / `LoopRun` | type | `loop-plan.ts` | 声明式 phase spec + 可序列化运行日志 |
| `defaultLoopPlan` | function | `loop-plan.ts` | 默认 phase 序列与 step budget |
| `LoopRunner` | class | `loop-runner.ts` | 按 `LoopPlan.phases` 解释 build/run/decide/evaluate/dispatch |
| `defaultLoopEvaluator` | function | `loop-evaluator.ts` | 确定性 retry/fail/pass 评估器 |
| `TurnEventBus` | class | `turn-event-bus.ts` | pub/sub 事件总线 |
| `StepSubscriberDeps` / `StepContext` | type | `turn-event-bus.ts` | 订阅者依赖 + 上下文 |
| `createPromptSubscriber` | function | `turn-event-bus.ts` | 占位（未来 peer 编排）|
| `runStepViaEventBus` | function | `turn-event-bus.ts` | 兼容保留，已废弃；新代码使用 `LoopRunner.step` |
| `TurnStepEvent` | type | `turn-event-types.ts` | 步级事件可辨识联合（`step:start` / `step:steering` / `prompt:built` / `model:ran` / `decision` / `tools:dispatched` / `step:end` / `turn:failed`）|
| `TurnStateV1` / `TurnStateV2` | type | `turn-event-types.ts` | legacy 状态 + 当前 `LoopRun` 状态别名 |
| `TurnStateSerializer` | interface | `turn-event-types.ts` | `save` / `load` / `delete` / `list` |
| `FileTurnStateStore` | class | `turn-state-store.ts` | 文件持久化（`<dataDir>/<threadId>/turns/<turnId>/state.json`）|
| `ORCHESTRATION_MODES` | const | `turn-event-types.ts` | `['classic', 'evented', 'evented_v2', 'kernel_v3']` |
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
- **`LoopRunner` 是 evented step 解释器** —— 按 `LoopPlan.phases` 执行 `build-prompt` / `run-model` / `decide` / 可选 `evaluate` / `dispatch-tools`，并把 rich events append 到 `LoopRun.events`。
- **Evented 状态持久化时机**：每步**前**持久化当前 `LoopRun`（崩溃后可从该 step 恢复）；retry 复用同一 `stepIndex` 与事件日志。
- **Evented 状态清理时机**：完成 / 失败 / 中止时**删除** state.json（避免残留）。
- **`InflightTracker.run` 担保清理**（`inflight-tracker.ts:40-50`）—— `try / finally` 确保 SSE begin/end 对永不泄漏。
- **`SteeringQueue.setTurn` 切换清空**（`steering-queue.ts:11-16`）—— 避免上一回合消息被下一回合消费。
- **`TurnEventBus` 是同步**（`turn-event-bus.ts:12-19`）—— `emit` 立即调用订阅者，订阅者返回值取首个非 void。
- **`TurnStateV2` / `LoopRun` 含 `stepIndex` + `phaseCursor` + `events`** —— 崩溃恢复与审计日志的关键；`TurnStateV1` 只作为兼容读入格式。
- **`EventedV2MultiAgentRuntime` 的 handoff 使用 durable outbox** —— run 事务提交 `handoff_requested` / `handoff_delivered` 与 `mailbox_enqueue` intent；提交后再投递 mailbox，并把 outbox 标记为 `published`。
- **`flushPendingOutbox(runId)` / `flushAllPendingOutbox()` 是可重入恢复入口** —— 若进程在 run 提交后、mailbox enqueue 前/后崩溃，新的 runtime 实例可以重放 pending intent；`MultiAgentRunStore.listWithPendingOutbox()` 负责发现待恢复 run；`MailboxStore.enqueue` 对同一 message 保持幂等且不会把 delivered/completed 降级回 queued。
- **`EventedV2MultiAgentRuntime` 的 graph interpreter 是 condition 驱动** —— `completeAgentTask()` 完成 active agent node 后按 edge condition 推进；`agent` / `terminate` / `join` / `retry` 在 runtime 内解释；`wait` / `tool` / `judge` 作为外部执行节点进入 `suspended`，再由 `completeExternalNode()` 按 condition 恢复。
- **`evented_v2` graph 可由 runtime config 声明** —— HTTP runtime factory 会优先使用 `runtime.eventedV2AgentGraph`，该字段复用 `AgentGraphSchema` 并经 `validateAgentGraph()` 校验；未配置时才回退到内置 manager-specialist graph。
- **`EventedV2RemoteAgentWorker` 是远程 agent 执行适配层** —— HTTP runtime factory 可通过 `runtime.eventedV2AgentPeers` 绑定 `agentId -> AgentCard.id`，worker 从 mailbox claim 任务后调用共享的 `PeerRegistry.invokePeer()`，再把 `PeerArtifact.status` 映射为 graph condition 推进 run。
- **`EventedV2MultiAgentRuntime` 自动使用 store lease/CAS 能力** —— 当 `MultiAgentRunStore` 实现 `acquireLease` / `releaseLease` 时，handoff、agent completion、external node completion 与 outbox flush 都会以 fencing token 调用 `update(..., { fence })`；store 还可通过 `loadVersion()` + `expectedVersion` 提供 CAS。
- **`EventedV2MultiAgentRuntime` 的观测面是 projection-only** —— `timeline(runId)` 只读取 run 并调用 `buildEventedV2RunTimeline()`；`metrics()` 通过 `MultiAgentRunStore.listAll()` 聚合所有 run，不改变运行状态，也不依赖业务 UI。
- **`EventedV2AgentWorker` 是 agent 执行适配层** —— runtime 不绑定具体模型/工具执行策略；worker 只负责任务领取、handler 调用、结果提交与 mailbox 完成，handler 由 server/worker 进程注入。
- **`EventedV2OutboxReconciler` 是调度外壳，不是进程管理器** —— 它提供周期性 flush、停止与观测 hook；HTTP/server runtime 可通过 `runtime.eventedV2OutboxReconciler.enabled` 自动启动，并通过 `intervalMs` 配置间隔；多实例部署策略仍由 store lease/CAS 层继续深化。
- **`createPromptSubscriber` 是占位**（`turn-event-bus.ts`）—— Stage 3 未来扩展为 peer-style 协作。

### 4. 行为规约

来自 `tests/runtime-factory.test.ts` / `tests/serve.test.ts` / `tests/cli-agent.test.ts`（集成覆盖）：

- `TurnOrchestrator.runTurn returns 'completed' on clean exit`
- `TurnOrchestrator.runTurn returns 'aborted' when signal is aborted mid-step`
- `TurnOrchestrator.runTurn returns 'failed' on tool dispatch or model errors`
- `EventedTurnOrchestrator.runTurn resumes from previous.stepIndex after a crash`
- `EventedTurnOrchestrator deletes state.json on completion / failure / abort`
- `EventedTurnOrchestrator drives LoopRunner and emits prompt/model/decision/tools/retry rich events`
- `EventedTurnOrchestrator retries truncated output on the same stepIndex`
- `EventedTurnOrchestrator preserves required-tool-missing error code/items in evented mode`
- `EventedV2AgentWorker claims queued agent tasks, completes mailbox messages, and advances runs`
- `EventedV2RemoteAgentWorker invokes configured peers for mailbox tasks and advances runs through PeerArtifact statuses`
- `EventedV2MultiAgentRuntime resumes suspended wait/tool/judge nodes through external completion conditions`
- `EventedV2MultiAgentRuntime uses store lease fencing when completing agent tasks`
- `EventedV2MultiAgentRuntime returns projected timeline and aggregate metrics for management observability`
- `buildEventedV2RunTimeline` / `buildEventedV2RunMetrics` project run timeline and aggregate status/agent/outbox metrics`
- `RuntimeTuningConfigSchema` accepts declarative `eventedV2AgentGraph` and the runtime factory starts runs from that configured graph`
- `RuntimeTuningConfigSchema` accepts `eventedV2AgentPeers` and the runtime factory mounts a remote worker when peer bindings are configured`
- `MultiAgentRunStore rejects stale lease fences and stale compare-and-swap versions`
- `EventedV2OutboxReconciler starts from runtime config and stops during runtime shutdown`
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

const evented = new EventedTurnOrchestrator(
  orchestratorOptions,
  new FileTurnStateStore('/work/.qiongqi/state'),
  bus,
  defaultLoopPlan(),
  defaultLoopEvaluator
)

// 3. 崩溃恢复
const state = await stateStore.load('thread_1', 'turn_1')
// state.stepIndex === 1 (从 step 1 恢复)

// 4. Steering
const steering = new SteeringQueue()
steering.setTurn('turn_1')
steering.enqueue('turn_1', 'Actually, focus on the security issues')
const drained = steering.drain() // ['Actually, focus on the security issues']
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#4-关键架构决策`](../architecture.zh.md#4-关键架构决策)（§4.4 OrchestrationMode：classic / evented_v2 / kernel_v3）
- 消费方：`@qiongqi/http` 的 `createAgent` 选择 classic / evented / evented_v2 / kernel_v3；`@qiongqi/delegation` 的 `ChildAgentExecutor` 装配独立 orchestrator
- 源文件：[`turn-orchestrator.ts`](../../packages/loop/src/turn-orchestrator.ts)、[`evented-turn-orchestrator.ts`](../../packages/loop/src/evented-turn-orchestrator.ts)、[`loop-plan.ts`](../../packages/loop/src/loop-plan.ts)、[`loop-runner.ts`](../../packages/loop/src/loop-runner.ts)、[`loop-evaluator.ts`](../../packages/loop/src/loop-evaluator.ts)、[`turn-event-bus.ts`](../../packages/loop/src/turn-event-bus.ts)、[`turn-event-types.ts`](../../packages/loop/src/turn-event-types.ts)、[`turn-state-store.ts`](../../packages/loop/src/turn-state-store.ts)、[`inflight-tracker.ts`](../../packages/loop/src/inflight-tracker.ts)、[`steering-queue.ts`](../../packages/loop/src/steering-queue.ts)
- 验证脚本：[`../../scripts/verify-crash-recovery.mjs`](../../scripts/verify-crash-recovery.mjs)（端到端崩溃恢复）
