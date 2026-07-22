# evented_v2 多 Agent 运行时

> 版本说明：本文档反映 2026-07-22 的生产运行基线。

`evented_v2` 是 Qiongqi 的声明式 Loop Engineering 多 Agent 编排运行时。它不是 `kernel_v3` 的替代内核，而是在 `kernel_v3` 稳定执行基线之上，提供跨 Agent 的 graph 推进、任务移交、异步调度、观测管理和生产灰度能力。

## 与 kernel_v3 的关系

`kernel_v3` 与 `evented_v2` 是分层关系：

| 层级 | 职责 | 生产定位 |
|---|---|---|
| `kernel_v3` | 单 run/turn 的确定性执行、checkpoint、effect idempotency、replay、lease/fence、provider-neutral tool handling | 默认生产执行核与稳定 fallback 基线 |
| `evented_v2` | AgentGraph、handoff、mailbox、run-local outbox、remote worker/scheduler、worker registry、timeline/metrics、rollout 控制 | 声明式多 Agent 编排 runtime |

生产推荐路径是：先让 `kernel_v3` 保持默认主路径，再通过 `runtime.eventedV2Rollout` 将多 Agent 流量逐步引入 `evented_v2`。当 evented_v2 主路径失败率或连续失败达到阈值时，`autoFallback` 可以按 `fallbackMode: "kernel_v3"` 自动退回稳定基线。

## 已落地能力

- 声明式 `AgentGraph` schema、图校验与 `runtime.eventedV2AgentGraph` 配置加载。
- `MultiAgentRunStore`、`MailboxStore`、run-local outbox、`EventedV2OutboxReconciler`。
- durable handoff、agent task completion、外部 `wait` / `tool` / `judge` 节点恢复。
- `agent` / `handoff` / `join` / `retry` / `terminate` 图推进基础。
- `EventedV2RemoteAgentWorker` 与 `EventedV2RemoteAgentScheduler`，复用通用 `PeerRegistry` 调用本地或远程 peer。
- mailbox claim lease/fence、远程失败/取消/超时到 graph condition 的声明式补偿映射。
- store-backed worker registry、worker heartbeat、online/expired 投影。
- run timeline、聚合 metrics、HTTP 管理 API 与 Prometheus 指标。
- `qiongqi worker --once`、daemon、shard、pool supervisor、`--deployment-plan`。
- `runtime.eventedV2Rollout` 的 `off` / `shadow` / `canary` / `default` 与 `autoFallback`。

## 生产启用方式

evented_v2 的生产启用应走灰度，而不是一次性替换默认运行时：

```json
{
  "runtime": {
    "eventedV2Rollout": {
      "stage": "canary",
      "fallbackMode": "kernel_v3",
      "canaryPercent": 10,
      "autoFallback": {
        "enabled": true,
        "windowSize": 20,
        "minRuns": 5,
        "failureRateThreshold": 0.3,
        "consecutiveFailures": 3,
        "cooldownMs": 60000
      }
    }
  }
}
```

阶段语义：

- `off`：保持 fallback mode，默认 `kernel_v3`。
- `shadow`：主路径仍走 fallback，同时记录 evented_v2 shadow intent 和决策指标。
- `canary`：按 `threadId` 稳定 hash 与 `canaryPercent` 在 run 级分流。
- `default`：让 `evented_v2` 成为主运行时模式。
- `autoFallback`：根据 evented_v2 主路径的近期失败窗口自动压回 fallback mode。

## Worker 部署

生产 worker 可在不启动 HTTP server 的情况下运行 outbox reconciler 与 remote agent scheduler：

```bash
qiongqi worker \
  --deployment-plan \
  --json \
  --config ./config.json \
  --pool-size auto \
  --restart-backoff-ms 1000 \
  --max-restarts 5
```

`--deployment-plan` 输出平台中立 JSON，可被 Kubernetes、systemd、Nomad 或 CI 模板消费。非 plan 模式下，`--pool-size N|auto` 会启动本地父 supervisor，并按 shard 切分 `eventedV2AgentPeers`，为每个 shard 拉起 child worker；child worker 非预期退出时会按 restart budget 重启，超过上限后父 supervisor 退出。

## 当前真实剩余

evented_v2 已具备生产级多 Agent 编排基础设施，但默认承载全部多 Agent 生产流量前，还需要继续深化：

- 独立 AgentGraph manifest 文件加载。
- agent binding 执行策略与能力约束校验。
- graph-level rollout 策略与控制面自动化。
- 隔离 shadow 双跑差异比对，而不仅是 shadow intent 与指标记录。
- 历史 run 回放、查询分页、过滤与失败原因标准化。
- store-native 跨进程 CAS / lease / transaction，下沉 run 级事务语义。
- 真实外部 A2A peer 与跨厂商互操作验证。

## 项目边界

KWorks 兼容层已完全从本仓库删除。`evented_v2` 的设计和实现保持通用 Agent 引擎边界：产品专属适配应放在外部 adapter、部署配置或下游项目中，不进入核心 runtime。
