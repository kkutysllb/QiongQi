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
