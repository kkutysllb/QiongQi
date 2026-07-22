# Qiongqi Production Deployment Checklist

This document covers the P1 production operations surface: probes, metrics, logs, storage verification, and A2A end-to-end verification.

## Preflight

```bash
pnpm install --frozen-lockfile
pnpm run prepare:sqlite
pnpm run verify:sqlite
pnpm -r run build
node scripts/flatten-dist.mjs
pnpm run verify:evented-a2a
```

`hybrid` is the recommended production storage mode. `prepare:sqlite` builds `better-sqlite3` for the current Node ABI, and `verify:sqlite` runs both an in-memory and temporary file-backed probe. This catches native binding, Node ABI, and platform dependency gaps early. If this check fails, the runtime can still fall back to JSONL, but the SQLite index performance path has not been verified.

## Probes

```bash
curl http://127.0.0.1:8899/health
curl http://127.0.0.1:8899/ready
```

`/health` is liveness; `/ready` is readiness. `/ready` returns `status=degraded` when hybrid SQLite falls back and includes the fallback reason under `checks.storage`.

Kubernetes example:

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

## Metrics

```bash
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  http://127.0.0.1:8899/v1/runtime/metrics
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  -H "Accept: text/plain" \
  "http://127.0.0.1:8899/v1/runtime/metrics?format=prometheus"
```

JSON metrics are intended for diagnostics and control planes; Prometheus text is intended for scraping. The exporter includes token/cache usage, A2A task status counts, and `qiongqi_storage_degraded`. When an `evented_v2` multi-agent runtime, remote scheduler, or worker registry is mounted, the same endpoint also exports evented_v2 run/agent/outbox, remote scheduler, and worker online/expired metrics; `/v1/runtime/evented-v2/metrics` exposes the JSON management aggregate.

Prometheus scrape example:

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

## Structured Access Logs

Embedders can pass an access log sink through `createHttpServer`:

```ts
await createHttpServer({
  agent,
  host: '127.0.0.1',
  port: 8899,
  accessLog: (entry) => logger.info(entry)
})
```

Each entry contains `requestId`, `method`, `path`, `status`, and `durationMs`. The runtime reuses caller-provided `x-request-id` values when present, otherwise generates one, and writes it back to response headers. Log entries do not include sensitive headers such as `authorization`.

When callers provide W3C `traceparent`, the runtime propagates it in response headers and includes `traceparent`, `traceId`, and `spanId` in access logs so OpenTelemetry collector/logger pipelines can correlate requests.

## OpenTelemetry Trace Exporter

For production, use the OTLP HTTP exporter to send HTTP server spans to a collector:

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

`qiongqi serve` also supports environment overrides for common fields:

```bash
QIONGQI_OTEL_ENABLED=true \
QIONGQI_OTEL_SERVICE_NAME=qiongqi \
QIONGQI_OTEL_EXPORTER=otlp-http \
QIONGQI_OTEL_ENDPOINT=http://otel-collector:4318/v1/traces \
pnpm qiongqi serve --config ./config.json
```

Available exporters:

- `otlp-http`: sends spans to an OTLP HTTP collector; recommended for production.
- `console`: writes spans to stdout for local debugging.
- `none` or `enabled: false`: disables the SDK exporter while keeping request id / `traceparent` response propagation and access log fields.

## Containers and Orchestration

The repository includes baseline delivery files:

- `Dockerfile`: runs SQLite native binding build+verify, package build, and dist flatten during image build.
- `docker-compose.yml`: local production-shape smoke test with a `/ready` healthcheck.
- `deploy/kubernetes/qiongqi.yaml`: Deployment, PVC, Service, liveness probe, and readiness probe.
- `deploy/prometheus/qiongqi-rules.yaml`: alert rules for storage degraded and failed A2A tasks.

Local container smoke test:

```bash
docker compose up --build
curl http://127.0.0.1:8899/ready
```

## evented_v2 Worker Pool Deployment Plan

Production orchestration systems can generate a stable JSON plan first, then feed it into Kubernetes, systemd, Nomad, or CI templates:

```bash
qiongqi worker \
  --deployment-plan \
  --json \
  --config ./config.json \
  --pool-size auto \
  --restart-backoff-ms 1000 \
  --max-restarts 5
```

The output includes the parent supervisor command, each shard child-worker command, and probe/metrics paths such as `/health`, `/ready`, `/v1/runtime/metrics?format=prometheus`, and `/v1/runtime/evented-v2/metrics`. `--pool-size auto` sizes shards from `runtime.eventedV2AgentPeers`, with at least one worker.

## evented_v2 Rollout

`runtime.eventedV2Rollout` is the evented_v2 gate from validation to production:

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

- `off`: keep the fallback mode, defaulting to `kernel_v3`.
- `shadow`: keep the primary path on the fallback mode while marking an `evented_v2` shadow intent at run-decision time for control-plane sampling, offline comparison, or future isolated dual runs.
- `canary`: select `evented_v2` or the fallback mode per run/thread with a stable `threadId` hash and `canaryPercent`.
- `default`: make `evented_v2` the primary runtime mode.
- `autoFallback`: tracks recent evented_v2 primary outcomes; when failure-rate or consecutive-failure thresholds trip, later runs are forced back to `fallbackMode` for the cooldown window. `/v1/runtime/metrics` and Prometheus expose `eventedV2Rollout` / `qiongqi_evented_v2_rollout_*` metrics.

## A2A Local Cross-instance Verification

```bash
pnpm run verify:evented-a2a
```

By default the script starts a local fake model and two evented Qiongqi HTTP runtimes. It verifies AgentCard discovery, async `POST /a2a/tasks`, polling to completion, artifacts, SSE subscribe, and evented turn-state cleanup.

Real external peer / cross-vendor interoperability has moved to P2 and remains explicit opt-in:

```bash
QIONGQI_A2A_PEER_URL="https://peer.example.com" \
QIONGQI_A2A_PEER_TOKEN="$TOKEN" \
pnpm run verify:evented-a2a -- --external-peer
```

When no external peer is configured, the script reports external peer verification as skipped rather than passed.
