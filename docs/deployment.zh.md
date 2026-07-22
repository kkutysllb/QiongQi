# Qiongqi 生产部署清单

本文聚焦 P1 生产运行面：健康检查、指标、日志、存储验证和 A2A 端到端验证。

## 启动前检查

```bash
pnpm install --frozen-lockfile
pnpm run prepare:sqlite
pnpm run verify:sqlite
pnpm -r run build
node scripts/flatten-dist.mjs
pnpm run verify:evented-a2a
```

`hybrid` 是生产推荐存储模式。`prepare:sqlite` 会按当前 Node ABI 编译 `better-sqlite3`，`verify:sqlite` 会分别跑内存库与临时落盘库 probe，确保原生绑定、Node ABI 和平台依赖都可用。若该检查失败，运行时仍可降级到 JSONL，但 SQLite 索引性能路径没有被验证。

## 探针

```bash
curl http://127.0.0.1:8899/health
curl http://127.0.0.1:8899/ready
```

`/health` 是 liveness；`/ready` 是 readiness。`/ready` 在 hybrid SQLite fallback 时返回 `status=degraded`，同时在 `checks.storage` 中暴露 fallback reason。

Kubernetes 示例：

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8899
readinessProbe:
  httpGet:
    path: /ready
    port: 8899
```

## 指标

```bash
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  http://127.0.0.1:8899/v1/runtime/metrics
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  -H "Accept: text/plain" \
  "http://127.0.0.1:8899/v1/runtime/metrics?format=prometheus"
```

JSON 指标用于调试和控制面；Prometheus text 指标用于抓取。当前导出 token/cache usage、A2A task 状态计数和 `qiongqi_storage_degraded`。
当启用 `evented_v2` multi-agent runtime、remote scheduler 或 worker registry 时，同一端点还会导出 evented_v2 run/agent/outbox、remote scheduler、worker online/expired 指标；`/v1/runtime/evented-v2/metrics` 提供 JSON 管理面聚合。

Prometheus scrape 示例：

```yaml
scrape_configs:
  - job_name: qiongqi
    metrics_path: /v1/runtime/metrics
    params:
      format: [prometheus]
    authorization:
      type: Bearer
      credentials: ${QIONGQI_RUNTIME_TOKEN}
    static_configs:
      - targets: ['qiongqi:8899']
```

## 结构化访问日志

嵌入式运行时可通过 `createHttpServer` 注入日志 sink：

```ts
await createHttpServer({
  agent,
  host: '127.0.0.1',
  port: 8899,
  accessLog: (entry) => logger.info(entry)
})
```

每条日志包含 `requestId`、`method`、`path`、`status`、`durationMs`。运行时会复用调用方传入的 `x-request-id`，否则自动生成，并写回响应头；日志条目不包含 `authorization` 等敏感 header。

如果调用方传入 W3C `traceparent`，运行时会透传响应头，并在 access log 中输出 `traceparent`、`traceId`、`spanId`，可直接被 OpenTelemetry collector/logger pipeline 关联。

## OpenTelemetry Trace Exporter

生产环境推荐使用 OTLP HTTP exporter，把 HTTP server span 发送到 collector：

```json
{
  "serve": {
    "observability": {
      "openTelemetry": {
        "enabled": true,
        "serviceName": "qiongqi",
        "exporter": "otlp-http",
        "endpoint": "http://otel-collector:4318/v1/traces",
        "headers": {}
      }
    }
  }
}
```

`qiongqi serve` 也支持环境变量覆盖常用字段：

```bash
QIONGQI_OTEL_ENABLED=true \
QIONGQI_OTEL_SERVICE_NAME=qiongqi \
QIONGQI_OTEL_EXPORTER=otlp-http \
QIONGQI_OTEL_ENDPOINT=http://otel-collector:4318/v1/traces \
pnpm qiongqi serve --config ./config.json
```

可用 exporter：

- `otlp-http`：发送到 OTLP HTTP collector，生产推荐。
- `console`：本地调试时把 span 输出到 stdout。
- `none` 或 `enabled: false`：关闭 SDK exporter，仅保留 request id / `traceparent` 响应传播与 access log 字段。

## 容器与编排

仓库提供基础交付文件：

- `Dockerfile`：构建时执行 SQLite native binding build+verify、包构建与 dist flatten。
- `docker-compose.yml`：本地生产形态 smoke test，带 `/ready` healthcheck。
- `deploy/kubernetes/qiongqi.yaml`：Deployment、PVC、Service、liveness/readiness probes。
- `deploy/prometheus/qiongqi-rules.yaml`：storage degraded 与 A2A failed task 告警规则。

本地容器 smoke test：

```bash
docker compose up --build
curl http://127.0.0.1:8899/ready
```

## kernel_v3 与 evented_v2 的生产关系

生产默认执行核是 `kernel_v3`。它承担单 run/turn 的确定性执行、checkpoint、effect idempotency 与 replay，是稳定 fallback 基线。

`evented_v2` 不是 `kernel_v3` 的简单替代版本，而是多 Agent 编排运行时。它在 `kernel_v3` 稳定基线之上提供 AgentGraph、mailbox、run-local outbox、remote worker/scheduler、worker registry、timeline/metrics 和 rollout 控制面。生产启用 evented_v2 时推荐从 `runtime.eventedV2Rollout.stage="shadow"` 开始，再进入 `canary`，最后才切到 `default`。

如果 `runtime.eventedV2Rollout.fallbackMode` 设为 `kernel_v3`，则 evented_v2 canary/default 主路径触发 `autoFallback` 后，后续 run 会自动退回 `kernel_v3`。这也是当前推荐的生产安全形态。

## evented_v2 Worker Pool 部署计划

生产编排系统可以先生成稳定 JSON 部署计划，再由 Kubernetes、systemd、Nomad 或 CI 模板消费：

```bash
qiongqi worker \
  --deployment-plan \
  --json \
  --config ./config.json \
  --pool-size auto \
  --restart-backoff-ms 1000 \
  --max-restarts 5
```

输出包含父 supervisor 命令、每个 shard child worker 命令，以及 `/health`、`/ready`、`/v1/runtime/metrics?format=prometheus`、`/v1/runtime/evented-v2/metrics` 等探针/指标路径。`--pool-size auto` 会按 `runtime.eventedV2AgentPeers` 数量规划 shard，最少 1 个 worker。

## evented_v2 灰度

`runtime.eventedV2Rollout` 是 evented_v2 从验证到生产的灰度入口：

```json
{
  "runtime": {
    "eventedV2Rollout": {
      "stage": "shadow",
      "canaryPercent": 0,
      "shadowSamplePercent": 10,
      "fallbackMode": "kernel_v3",
      "autoFallback": {
        "enabled": true,
        "windowSize": 20,
        "minRuns": 5,
        "failureRateThreshold": 0.5,
        "consecutiveFailures": 3,
        "cooldownMs": 60000
      }
    }
  }
}
```

- `off`：保持 fallback mode，默认 `kernel_v3`。
- `shadow`：主路径仍走 fallback mode，同时在 run 级决策中标记 `evented_v2` shadow intent，供控制面采样、离线比对或后续隔离双跑使用。
- `canary`：按 `threadId` 稳定 hash 与 `canaryPercent` 在 run 级选择 `evented_v2` 或 fallback mode。
- `default`：将 `evented_v2` 作为主运行时模式。
- `autoFallback`：对 evented_v2 主路径记录最近运行窗口；失败率、连续失败达到阈值后进入冷却期，后续 run 自动压回 `fallbackMode`。`/v1/runtime/metrics` 与 Prometheus 会暴露 `eventedV2Rollout` / `qiongqi_evented_v2_rollout_*` 指标。

## A2A 本地跨实例验证

```bash
pnpm run verify:evented-a2a
```

该脚本默认启动本地 fake model 与两个 evented Qiongqi HTTP runtime，验证 AgentCard 发现、异步 `POST /a2a/tasks`、轮询完成、artifacts、SSE subscribe，以及 evented turn state 清理。

真实外部 peer / 跨厂商互操作已移动到 P2，需要显式 opt-in：

```bash
QIONGQI_A2A_PEER_URL="https://peer.example.com" \
QIONGQI_A2A_PEER_TOKEN="$TOKEN" \
pnpm run verify:evented-a2a -- --external-peer
```

未配置外部 peer 时，脚本会报告 external peer skipped，而不是误报为通过。
