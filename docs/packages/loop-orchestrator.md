# @qiongqi/loop — Orchestrator

> `TurnOrchestrator` + `EventedTurnOrchestrator` + `EventedV2MultiAgentRuntime` + `EventedV2OutboxReconciler` + `EventedV2RemoteAgentScheduler` + `LoopRunner` + `LoopPlan` + `LoopRun/TurnStateV2` + `TurnEventBus` + `InflightTracker` + `SteeringQueue` —— 回合编排器与多 Agent 编排 shell（classic / evented / evented_v2 / kernel_v3）。
> Layer 4 — 依赖：`@qiongqi/contracts`、`@qiongqi/domain`、`@qiongqi/ports`、`@qiongqi/cache`、`@qiongqi/services`（type-only）、`@qiongqi/adapter-tools`、`@qiongqi/adapter-model`、`@qiongqi/attachments`、`@qiongqi/skills`、`@qiongqi/memory`。

---

## 中文

### 1. 职责

本子模块是**回合编排的心脏**：

- **`TurnOrchestrator`** —— 经典命令式循环，组装 `PromptBuilder` / `ModelStepRunner` / `ContinuationPolicy` / `ToolCallCoordinator` 4 个子组件
- **`EventedTurnOrchestrator`** —— `LoopRunner` 驱动的 evented loop shell + 崩溃恢复（`LoopRun` / `TurnStateV2` 持久化）
- **`EventedV2MultiAgentRuntime`** —— `evented_v2` 的多 Agent 编排 shell，当前支持 durable run、mailbox、manager-to-specialist handoff、agent task completion、外部 wait/tool/judge 节点恢复、run 内持久化 outbox + `flushPendingOutbox()` / `flushAllPendingOutbox()` 恢复 mailbox enqueue / complete，以及 `timeline()` / `metrics()` 只读管理投影
- **`EventedV2AgentWorker`** —— 通用 agent task worker，负责从 mailbox claim task、运行注入的 agent handler、提交结果并 complete mailbox
- **`EventedV2OutboxReconciler`** —— 可嵌入 worker / server lifecycle 的周期性 outbox flush 外壳，提供 `flushOnce()` / `start()` / `stop()` / `isRunning()` 与 flush 结果回调
- **`EventedV2RemoteAgentScheduler`** —— 可嵌入 worker / server lifecycle 的周期性 remote agent polling 外壳，按配置的 agent 列表调用 remote worker，隔离单 agent 错误，并通过 `snapshot()` 暴露 supervisor 指标
- **`EventedV2WorkerRegistryStore`** —— 通用 worker 心跳 registry 端口，memory/file store 均实现，可投影 remote worker online/expired 状态
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
| `EventedV2MultiAgentRuntime` | class | `evented-v2-multi-agent-runtime.ts` | `evented_v2` 多 Agent 编排 shell；handoff 写入 `mailbox_enqueue` run outbox，agent completion 写入 `mailbox_complete` run outbox，`completeAgentTask()` / `completeExternalNode()` 按 graph edge 推进，`flushPendingOutbox(runId)` / `flushAllPendingOutbox()` 可恢复 mailbox 投递与完成，`timeline()` / `metrics()` 暴露只读观测面 |
| `buildEventedV2RunTimeline` / `buildEventedV2RunMetrics` | function | `evented-v2-observability.ts` | 将 `MultiAgentRun` 投影为 timeline，或将 run 列表聚合为 status / agent-run / outbox 指标 |
| `EventedV2AgentWorker` | class | `evented-v2-multi-agent-runtime.ts` | claim mailbox task、执行 agent handler、提交 agent 结果并 complete mailbox |
| `EventedV2OutboxReconciler` | class | `evented-v2-multi-agent-runtime.ts` | 周期性调用 `flushAllPendingOutbox()`；提供 `start` / `stop` / `isRunning` / `onFlush` / `onError` 生命周期与观测 hook |
| `EventedV2RemoteAgentScheduler` | class | `evented-v2-multi-agent-runtime.ts` | 周期性轮询配置的 remote agent mailbox；逐 agent 调用 worker、隔离错误、汇总 processed message，并通过 `snapshot()` 暴露 workerId / health / flush / message / error / heartbeat |
| `EventedV2WorkerRegistryStore` | interface | `@qiongqi/ports` `multi-agent-runtime.ts` | store-backed worker heartbeat registry；`recordHeartbeat()` upsert worker，`list({ nowIso })` 计算 online/expired |
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
- **`EventedV2MultiAgentRuntime` 的 mailbox side effect 使用 durable outbox** —— handoff 的 run 事务提交 `handoff_requested` / `handoff_delivered` 与 `mailbox_enqueue` intent；agent completion 的 run 事务提交 graph advancement 与 `mailbox_complete` intent；提交后再执行 mailbox side effect，并把 outbox 标记为 `published`。
- **`flushPendingOutbox(runId)` / `flushAllPendingOutbox()` 是可重入恢复入口** —— 若进程在 run 提交后、mailbox enqueue / complete 前后崩溃，新的 runtime 实例可以重放 pending intent；`MultiAgentRunStore.listWithPendingOutbox()` 负责发现待恢复 run；`MailboxStore.enqueue` 对同一 message 保持幂等且不会把 delivered/completed 降级回 queued，`MailboxStore.complete` 对同一 terminal 状态重放幂等，同时继续用 claim fence 拒绝迟到 worker 覆盖不同终态。
- **`EventedV2MultiAgentRuntime` 的 graph interpreter 是 condition 驱动** —— `completeAgentTask()` 完成 active agent node 后按 edge condition 推进；`agent` / `terminate` / `join` / `retry` 在 runtime 内解释；`wait` / `tool` / `judge` 作为外部执行节点进入 `suspended`，再由 `completeExternalNode()` 按 condition 恢复。
- **`evented_v2` graph 可由 runtime config 声明** —— HTTP runtime factory 会优先使用 `runtime.eventedV2AgentGraph`，该字段复用 `AgentGraphSchema` 并经 `validateAgentGraph()` 校验；未配置时才回退到内置 manager-specialist graph。
- **`EventedV2RemoteAgentWorker` 是远程 agent 执行适配层** —— HTTP runtime factory 可通过 `runtime.eventedV2AgentPeers` 绑定 `agentId -> AgentCard.id`，并通过 `runtime.eventedV2RemoteAgent.timeoutMs` / `leaseTtlMs` 配置远程调用超时与 mailbox claim lease；worker 从 mailbox claim 任务后调用共享的 `PeerRegistry.invokePeer()`，再把 `PeerArtifact.status` 映射为 graph condition 推进 run，`PeerArtifact.artifacts` 会进入 `agentRuns[].peerArtifact` 与 timeline。
- **`EventedV2RemoteAgentWorker` 支持声明式补偿 condition** —— 默认把 peer outcome 映射为 `completed` / `failed` / `aborted`；配置 `runtime.eventedV2RemoteAgent.compensation.statusConditions` 后，可把 `failed` / `aborted` 映射为 `remote_failed`、`fallback` 等 graph condition，由 AgentGraph 决定 retry、fallback、terminate 或人工介入。
- **`EventedV2RemoteAgentScheduler` 是远程 worker 的调度外壳** —— HTTP runtime factory 可通过 `runtime.eventedV2RemoteAgent.scheduler.enabled` 自动启动，并通过 `scheduler.intervalMs` 配置轮询间隔；scheduler 按 peer binding 的 agent 列表调用 worker，单 agent 错误进入 `onError`，不会阻断同批其他 agent；`snapshot()` 会投影 workerId、running/stopped、health、flush/message/error 计数与 heartbeat 时间，供 HTTP runtime metrics 与 Prometheus 导出；挂载 `EventedV2WorkerRegistryStore` 时，每次 flush 后会写入 remote agent worker heartbeat。
- **`qiongqi worker` 是独立 remote worker 入口** —— CLI 可在不启动 HTTP server 的情况下创建 runtime 并驱动 `EventedV2OutboxReconciler` + `EventedV2RemoteAgentScheduler`；`--once` 适合批处理、探针和容器 job，daemon 模式等待 SIGINT/SIGTERM 后 shutdown；`--shard-index` / `--shard-count` 会在 runtime 创建前按稳定排序切分 `eventedV2AgentPeers`，让多个 worker 实例处理不同 agent 子集；`--plan --pool-size N` 只输出 shard 拓扑，不创建 runtime；非 `--plan` 的 `--pool-size N` 会启动一个本地父 supervisor，并为每个 shard 拉起一个 child worker，父进程退出时统一 SIGTERM 子进程；child worker 非预期退出时会按 `--restart-backoff-ms`（默认 1000ms）重启同一 shard。
- **`EventedV2WorkerRegistryStore` 是跨进程 worker 监督基础** —— `InMemoryEventedV2WorkerRegistryStore` 与 `FileEventedV2WorkerRegistryStore` 都支持 `recordHeartbeat()` / `list({ nowIso })`；list 会按 `expiresAt` 计算 online/expired，并被 HTTP runtime metrics / Prometheus 投影为 worker total/online/expired 与 role 维度计数。
- **`EventedV2MultiAgentRuntime` 自动使用 store lease/CAS 能力** —— 当 `MultiAgentRunStore` 实现 `acquireLease` / `releaseLease` 时，handoff、agent completion、external node completion 与 outbox flush 都会以 fencing token 调用 `update(..., { fence })`；store 还可通过 `loadVersion()` + `expectedVersion` 提供 CAS。
- **`EventedV2MultiAgentRuntime` 的观测面是 projection-only** —— `timeline(runId)` 只读取 run 并调用 `buildEventedV2RunTimeline()`；`metrics()` 通过 `MultiAgentRunStore.listAll()` 聚合所有 run，不改变运行状态，也不依赖业务 UI。
- **`EventedV2AgentWorker` 是 agent 执行适配层** —— runtime 不绑定具体模型/工具执行策略；worker 只负责任务领取、handler 调用、结果提交与 mailbox 完成，handler 由 server/worker 进程注入。
- **`MailboxStore` 支持 claim lease/fence** —— `claimNext(agentId, { holderId, ttlMs })` 会给 delivered message 写入 `claimLease`；未过期时其他 worker 不可领取，过期后可被接管；`complete(..., fence)` 会拒绝 stale fence，防止迟到 worker 覆盖结果。
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
- `EventedV2AgentWorker claims queued agent tasks, advances runs, and completes mailbox messages through a recoverable mailbox_complete outbox intent`
- `EventedV2RemoteAgentWorker invokes configured peers for mailbox tasks, records peer artifacts, maps cancellation/timeout to aborted, advances runs through PeerArtifact statuses, and recovers mailbox terminal completion through run outbox`
- `EventedV2MultiAgentRuntime resumes suspended wait/tool/judge nodes through external completion conditions`
- `EventedV2MultiAgentRuntime uses store lease fencing when completing agent tasks`
- `EventedV2MultiAgentRuntime returns projected timeline and aggregate metrics for management observability`
- `buildEventedV2RunTimeline` / `buildEventedV2RunMetrics` project run timeline and aggregate status/agent/outbox metrics`
- `RuntimeTuningConfigSchema` accepts declarative `eventedV2AgentGraph` and the runtime factory starts runs from that configured graph`
- `RuntimeTuningConfigSchema` accepts `eventedV2AgentPeers` / `eventedV2RemoteAgent.timeoutMs` / `eventedV2RemoteAgent.leaseTtlMs` / `eventedV2RemoteAgent.heartbeatTtlMs` / `eventedV2RemoteAgent.scheduler` / `eventedV2RemoteAgent.compensation.statusConditions` and the runtime factory mounts a remote worker plus optional scheduler when peer bindings are configured`
- `MailboxStore leases delivered messages and rejects stale mailbox claim fences on completion`
- `MultiAgentRunStore rejects stale lease fences and stale compare-and-swap versions`
- `EventedV2OutboxReconciler starts from runtime config and stops during runtime shutdown`
- `EventedV2RemoteAgentScheduler starts from runtime config, isolates per-agent polling errors, records store-backed worker registry heartbeats, reports supervision metrics through snapshot/Prometheus, and stops during runtime shutdown`
- `qiongqi worker --once runs evented_v2 outbox and remote-agent scheduler flushes without starting the HTTP server`
- `qiongqi worker --shard-index/--shard-count filters eventedV2AgentPeers before runtime creation for multi-worker agent sharding`
- `qiongqi worker --plan --pool-size prints a stable evented_v2 worker shard topology without creating runtimes`
- `qiongqi worker --pool-size starts a local evented_v2 worker supervisor and spawns one child worker per shard`
- `qiongqi worker --pool-size restarts an unexpectedly exited child worker shard after restart backoff`
- `EventedV2WorkerRegistryStore records memory/file-backed worker heartbeats and reports online/expired status for HTTP/Prometheus metrics`
- `EventedV2RemoteAgentWorker maps peer outcomes through configured compensation conditions before advancing AgentGraph`
- `EventedV2MultiAgentRuntime recovers pending mailbox_complete outbox intents after run advancement succeeds but mailbox completion fails`
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
