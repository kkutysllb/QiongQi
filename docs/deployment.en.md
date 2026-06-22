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

JSON metrics are intended for diagnostics and control planes; Prometheus text is intended for scraping. The current exporter includes token/cache usage, A2A task status counts, and `qiongqi_storage_degraded`.

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
