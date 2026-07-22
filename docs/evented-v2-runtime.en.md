# evented_v2 Multi-Agent Runtime

> Version note: this document reflects the production runtime baseline on 2026-07-22.

`evented_v2` is Qiongqi's declarative Loop Engineering runtime for multi-agent orchestration. It is not a replacement kernel for `kernel_v3`. Instead, it sits above the stable `kernel_v3` execution baseline and adds cross-agent graph progress, handoff, asynchronous scheduling, observability, and rollout control.

## Relationship to kernel_v3

`kernel_v3` and `evented_v2` are layered capabilities:

| Layer | Responsibility | Production Role |
|---|---|---|
| `kernel_v3` | Deterministic single-run/turn execution, checkpoints, effect idempotency, replay, lease/fence behavior, provider-neutral tool handling | Default production execution kernel and stable fallback baseline |
| `evented_v2` | AgentGraph, handoff, mailbox, run-local outbox, remote worker/scheduler, worker registry, timeline/metrics, rollout control | Declarative multi-agent orchestration runtime |

The recommended production path keeps `kernel_v3` as the default primary path, then progressively introduces multi-agent traffic into `evented_v2` through `runtime.eventedV2Rollout`. If evented_v2 primary traffic crosses failure-rate or consecutive-failure thresholds, `autoFallback` can automatically route later runs back to `fallbackMode: "kernel_v3"`.

## Implemented Capabilities

- Declarative `AgentGraph` schema, graph validation, and `runtime.eventedV2AgentGraph` config loading.
- `MultiAgentRunStore`, `MailboxStore`, run-local outbox, and `EventedV2OutboxReconciler`.
- Durable handoff, agent task completion, and external `wait` / `tool` / `judge` node resume.
- Graph progress foundation for `agent` / `handoff` / `join` / `retry` / `terminate`.
- `EventedV2RemoteAgentWorker` and `EventedV2RemoteAgentScheduler`, reusing the generic `PeerRegistry` for local or remote peers.
- Mailbox claim lease/fence behavior and declarative compensation mapping from remote failure/cancel/timeout to graph conditions.
- Store-backed worker registry, worker heartbeat, online/expired projections.
- Run timeline, aggregate metrics, HTTP management APIs, and Prometheus metrics.
- `qiongqi worker --once`, daemon, shard, pool supervisor, and `--deployment-plan`.
- `runtime.eventedV2Rollout` stages `off` / `shadow` / `canary` / `default` plus `autoFallback`.

## Production Enablement

Production enablement should use rollout stages instead of replacing the default runtime in one step:

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

Stage semantics:

- `off`: keep the fallback mode, defaulting to `kernel_v3`.
- `shadow`: keep the primary path on fallback while recording evented_v2 shadow intent and decision metrics.
- `canary`: route per run/thread with a stable `threadId` hash and `canaryPercent`.
- `default`: make `evented_v2` the primary runtime mode.
- `autoFallback`: force traffic back to fallback mode from recent evented_v2 primary failure windows.

## Worker Deployment

Production workers can run the outbox reconciler and remote-agent scheduler without starting an HTTP server:

```bash
qiongqi worker \
  --deployment-plan \
  --json \
  --config ./config.json \
  --pool-size auto \
  --restart-backoff-ms 1000 \
  --max-restarts 5
```

`--deployment-plan` emits platform-neutral JSON for Kubernetes, systemd, Nomad, or CI templates. Outside plan mode, `--pool-size N|auto` starts a local parent supervisor, shards `eventedV2AgentPeers`, and launches one child worker per shard. Unexpected child exits are restarted within the restart budget; once the budget is exceeded, the parent supervisor exits.

## Remaining Work

evented_v2 now has a production-grade multi-agent orchestration foundation, but these hardening items remain before routing all multi-agent production traffic through it by default:

- Standalone AgentGraph manifest file loading.
- Agent binding execution policy and capability constraints.
- Graph-level rollout policy and control-plane automation.
- Isolated shadow dual-run diffing beyond the current shadow intent and metrics.
- Historical run replay, paginated queries, filtering, and standardized failure reasons.
- Store-native cross-process CAS / lease / transaction semantics for run-level transactions.
- Real external A2A peer and cross-vendor interoperability validation.

## Project Boundary

The KWorks compatibility layer has been fully removed from this repository. `evented_v2` keeps the generic Agent engine boundary: product-specific adaptation belongs in external adapters, deployment configuration, or downstream projects, not in the core runtime.
