<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/qiongqi.png">
    <img src="assets/qiongqi.png" width="100%" alt="Qiongqi — The beast that breaks the deadlock">
  </picture>
</p>

<h1 align="center">Qiongqi</h1>

<p align="center">
  <b>Independent Multi-Agent Framework · Constant skeleton, mutable flesh</b>
</p>

<p align="center">
  <a href="./README.zh.md">中文</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-design-philosophy">Philosophy</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-monorepo-package-structure">Packages</a> ·
  <a href="./docs/packages/README.md">Technical Docs</a> ·
</p>

---

> **The beast that breaks the deadlock.** Qiongqi is named after the mythical
> creature from Chinese classics — a winged tiger that "understands human
> speech" and dares to "destroy trust and discard loyalty." The engine rejects
> central scheduling oligarchs; every Agent is an independent warrior. A single
> Agent can operate in a closed loop, while multiple Agents self-negotiate
> through a decoupled engine skeleton and external skill flesh.

---

## 📖 What is Qiongqi?

**Qiongqi** is a **domain-neutral, independent multi-agent framework** built on
a **cache-first, decentralized orchestration** HTTP/SSE engine skeleton, paired
with a pluggable skill and tool system, assembled into productivity tools for
different industries.

Core goal: **maximize the ROI of every token.** Avoid duplicate tool schemas,
runaway tool outputs, malformed history, invalid retries, and any stable prefix
that could be cached but is missed.

The current implementation includes classic / evented_v2 / kernel_v3
orchestration modes, with `kernel_v3` as the default production execution
kernel. `evented_v2` is the declarative Loop Engineering multi-agent runtime
foundation: durable runs, AgentGraph, mailbox, run-local outbox, remote agent
worker/scheduler, worker registry, timeline/metrics management, and a
shadow/canary/fallback rollout loop. The production surface also includes
HTTP/SSE APIs, A2A task lifecycle, Skill/MCP/Web/Memory/Delegation providers,
attachments/artifacts, hybrid SQLite+JSONL storage, Prometheus metrics,
structured access logs, OpenTelemetry HTTP tracing, and governance features
such as tool result budgeting, bash command audit, virtual paths, and
terminal-state guards.

### Relationship Between evented_v2 and kernel_v3

`kernel_v3` and `evented_v2` are not a simple old/new replacement pair. They
serve different layers of orchestration:

- `kernel_v3` is the default production execution kernel. It focuses on
  deterministic single-run/turn execution: checkpoints, effect idempotency,
  replay, lease/fence behavior, and provider-neutral tool handling.
- `evented_v2` is the declarative multi-agent orchestration runtime. It focuses
  on cross-agent graph progress: AgentGraph, handoff, mailbox, run-local
  outbox, remote worker/scheduler, worker registry, timeline/metrics, and the
  rollout control plane.
- In production, `kernel_v3` remains the stable fallback baseline.
  `evented_v2` takes on multi-agent traffic progressively through
  `runtime.eventedV2Rollout` stages (`shadow` / `canary` / `default`) and can
  automatically fall back through `fallbackMode: "kernel_v3"` plus
  `autoFallback` when failure-rate or consecutive-failure thresholds trip.

### Project Boundary

The KWorks compatibility layer has been fully removed from this repository.
Qiongqi remains a domain-neutral general Agent engine; product-specific
adaptation belongs in external adapters, deployment configuration, or downstream
projects, not in the core engine.

---

## 🐯 Design Philosophy

A three-headed beast, three core propositions:

### 1️⃣ Core Philosophy: The Rebel Against Centralization

Qiongqi has no central scheduling oligarch. Turn orchestration, tool
coordination, and context compaction — every component is a replaceable
port/adapter contract. The engine is just a skeleton; the flesh is injected by
external skills and tools.

### 2️⃣ Individual Capability: The "Tiger Wings"

Every Agent is an end-to-end independent execution unit. A single Agent can
complete a closed loop from prompt to tool call to result return. The Skill
system supports capability encapsulation at any granularity.

### 3️⃣ Collective Intelligence: Self-Negotiating Organization

Multiple Agents self-negotiate through a decoupled engine skeleton (EventBus,
Store, Gate) rather than central orchestration. The subagent delegation
mechanism supports hierarchical consensus.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+

### Install & Build

```bash
pnpm install
pnpm -r run build
node scripts/flatten-dist.mjs  # Flatten build output
```

Before using `hybrid` storage in production or CI, run `pnpm run prepare:sqlite && pnpm run verify:sqlite` to build and verify that the `better-sqlite3` native binding can be loaded.

Verify the evented orchestrator + two-instance A2A path:

```bash
pnpm -r run build
node scripts/flatten-dist.mjs
pnpm run verify:evented-a2a
```

The script covers async `POST /a2a/tasks` submission, polling to task completion, artifacts, SSE subscribe, and evented turn-state cleanup.

### Start the Runtime

```bash
npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --base-url "$QIONGQI_BASE_URL" \
  --api-key "$QIONGQI_API_KEY" \
  --port 8899
```

After startup, the HTTP API is available at `http://127.0.0.1:8899`.

Production probes and runtime metrics:

```bash
curl http://127.0.0.1:8899/health
curl http://127.0.0.1:8899/ready
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  http://127.0.0.1:8899/v1/runtime/metrics
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  -H "Accept: text/plain" \
  "http://127.0.0.1:8899/v1/runtime/metrics?format=prometheus"
```

`/ready` exposes storage degraded state; `/v1/runtime/metrics` returns JSON by default and can also export Prometheus text for token/cache usage, A2A tasks, and storage diagnostics.

### evented_v2 Production Workers and Rollout

evented_v2 workers can run the outbox reconciler and remote-agent scheduler
without starting an HTTP server. Production orchestration systems can first
generate a stable JSON deployment plan:

```bash
qiongqi worker \
  --deployment-plan \
  --json \
  --config ./config.json \
  --pool-size auto \
  --restart-backoff-ms 1000 \
  --max-restarts 5
```

`runtime.eventedV2Rollout` supports:

- `off`: keep the fallback mode, defaulting to `kernel_v3`.
- `shadow`: keep the primary path on fallback while recording an evented_v2 shadow intent and decision metrics.
- `canary`: route per run/thread with a stable `threadId` hash.
- `default`: make evented_v2 the primary runtime mode.
- `autoFallback`: automatically force traffic back to `kernel_v3` / `classic` based on recent failure rate, consecutive failures, and cooldown.

### Script Reference

```bash
pnpm -r run build          # Build all 18 packages
pnpm run prepare:sqlite    # Build the better-sqlite3 native binding for the current Node ABI
pnpm run verify:sqlite     # Verify the better-sqlite3 native binding for hybrid storage
pnpm run verify:evented-a2a # Local fake-model two-instance evented + A2A verification
pnpm test                  # Full test suite (current baseline: 124 files, 883 tests)
pnpm test:unit             # Unit tests
pnpm test:fast             # Fast test subset
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                    Client (GUI / CLI)            │
└────────────────────┬────────────────────────────┘
                     │ HTTP / SSE
┌────────────────────▼────────────────────────────┐
│                 @qiongqi/http                    │
│   Router · Auth · SSE · Runtime Factory          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              @qiongqi/loop                       │
│  KernelV3 · EventedV2 · LoopRunner · LoopPlan    │
│  AgentGraph · Mailbox · Outbox · Rollout         │
│  ToolCallCoordinator · ContextCompactor          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              @qiongqi/ports                      │
│  ModelClient · ToolHost · Stores · EventBus      │
│  ApprovalGate · UserInputGate · Workspace        │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           Adapters + Extensions                  │
│  adapter-model · adapter-tools · adapter-storage │
│  skills · memory · attachments · delegation      │
│  tool-infra · artifacts · OpenTelemetry          │
└───────────────────────────────────────────────────┘
```

> Detailed architecture: [`docs/architecture.en.md`](./docs/architecture.en.md)
> Per-package technical docs: [`docs/packages/README.md`](./docs/packages/README.md)

---

## 📦 Monorepo Package Structure

Qiongqi uses a pnpm monorepo structure with 18 independent npm packages:

| Package | Responsibility |
|---------|---------------|
| `@qiongqi/contracts` | Zod schemas + types (zero-dependency base layer) |
| `@qiongqi/domain` | Thread/Turn/Item/Event entities |
| `@qiongqi/ports` | ModelClient/ToolHost/Stores interfaces |
| `@qiongqi/cache` | LRU/TTL cache, immutable prefix |
| `@qiongqi/loop` | kernel_v3 / evented_v2 / classic orchestration, LoopRunner/LoopPlan, AgentGraph, mailbox/outbox, rollout |
| `@qiongqi/services` | Thread/Turn/Usage services |
| `@qiongqi/adapter-model` | Provider-neutral model compatibility client |
| `@qiongqi/adapter-tools` | Built-in tools + MCP/Web/Memory/Delegation providers |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite storage |
| `@qiongqi/skills` | SkillRuntime + PluginHost |
| `@qiongqi/memory` | Cross-session memory + lexical retrieval |
| `@qiongqi/attachments` | Attachment management + virtual path resolver |
| `@qiongqi/adapter-fs` | Pure filesystem I/O utilities |
| `@qiongqi/tool-infra` | Tool infrastructure, result budget, command audit |
| `@qiongqi/delegation` | Child-agent delegation runtime + terminal-state guard |
| `@qiongqi/http` | HTTP/SSE, A2A, metrics, artifacts, OpenTelemetry |
| `@qiongqi/cli` | CLI entry point |
| `@qiongqi/preset-coding` | Coding preset |

> Full dependency graph: [`docs/architecture.en.md#appendix-a-complete-dependency-table`](./docs/architecture.en.md)
> Package details: [`docs/packages/README.md`](./docs/packages/README.md)

---

## ✨ Features

### 🔧 Agent Loop
- **Kernel v3 default production kernel**: durable checkpoints, effect idempotency, and provider-neutral tool handling; this is the default production execution mode
- **Declarative Loop Engineering**: evented_v2 evolves into a declarative loop substrate — `LoopRunner` interprets the `LoopPlan` phase set (build-prompt → run-model → decide → optional evaluate → dispatch-tools); rich events (`prompt:built` / `model:ran` / `decision` / `tools:dispatched` / `step:retry`) are materialized and appended to a `LoopRun` audit log; a pluggable deterministic `LoopEvaluator` triggers bounded retry/reflection according to the phase retry budget; classic mode is retained as a regression anchor
- **evented_v2 multi-agent runtime**: declarative AgentGraph, durable runs, mailbox, run-local outbox, remote agent worker/scheduler, worker registry, and timeline/metrics management
- **Production rollout loop**: `runtime.eventedV2Rollout` supports shadow/canary/default, routes at run/thread granularity, and uses `autoFallback` to force traffic back to the fallback mode
- **Cache-first orchestration**: Immutable prompt prefix + TTL/LRU cache + inflight tracking
- **Context compaction**: Soft/hard threshold-triggered summarization
- **Token economy**: Compress tool descriptions and results
- **Tool Storm Breaker**: Suppress repeated tool calls within the same turn
- **Loop Policy**: Pure-function stop/continue/fail/dispatch/plan-materialize decisions
- **Runtime governance**: Tool result externalization, bash command audit, terminal-state guards

### 🔌 Capability Matrix
- **MCP client**: stdio / streamable-http / SSE transports, BM25 tool search
- **Skills system**: Plugin-based capability injection via `skill.json` / `SKILL.md`
- **Subagent delegation**: Hierarchical agent calls with concurrency control
- **Memory system**: Cross-session persistence, Chinese/English lexical ranking, scope-based retrieval
- **Attachments and artifacts**: Image binary stripping, visual/text channels, virtual-path reads

### 🌐 Server
- **HTTP/SSE API**: Complete `/v1/*` RESTful routes
- **Runtime diagnostics**: Capability manifest, tool diagnostics, JSON/Prometheus metrics
- **Thread management**: Create, fork, side threads, event replay
- **Approval gating**: Multiple policy support
- **Observability**: Request id, structured access logs, W3C `traceparent`, OpenTelemetry HTTP tracing

---

## 📁 Project Structure

```
.
├── assets/
│   └── qiongqi.png               # Project cover image
├── docs/                          # Technical docs (bilingual)
│   ├── architecture.{zh,en}.md   # Unified architecture (philosophy + technical architecture + packages)
│   ├── deployment.{zh,en}.md     # Production deployment, probes, metrics, OTel, A2A, evented_v2 worker/rollout
│   ├── evented-v2-runtime.{zh,en}.md # evented_v2 / kernel_v3 relationship, production enablement, remaining work
│   ├── packages/                 # 27 per-package technical docs
│   └── superpowers/plans/        # Runtime governance and external A2A plans
├── packages/                      # 18 @qiongqi/* packages (packages/<layer>/<package>)
│   ├── foundation/contracts/
│   ├── domain-layer/domain/
│   ├── ports-layer/ports/
│   ├── infrastructure/{cache,attachments,adapter-fs,tool-infra}/
│   ├── engine/{loop,services}/
│   ├── adapters/{adapter-model,adapter-tools,adapter-storage}/
│   ├── capabilities/{skills,memory}/
│   ├── delegation-layer/delegation/
│   ├── http-layer/http/
│   ├── cli-layer/cli/
│   └── presets/preset-coding/
├── tests/                         # Full test suite (current baseline: 124 files, 883 tests)
├── deploy/                        # Kubernetes manifests and Prometheus rules
├── .github/workflows/ci.yml       # CI: SQLite, typecheck, fast tests, build, A2A
├── scripts/                       # Migration and build helper scripts
├── pnpm-workspace.yaml
├── vitest.config.ts
└── package.json
```

---

## 📚 Related Documents

| Document | Location |
|----------|----------|
| **Architecture Overview** | [`docs/architecture.en.md`](./docs/architecture.en.md) |
| **Technical Docs Index** | [`docs/packages/README.md`](./docs/packages/README.md) |
| **Deployment** | [`docs/deployment.en.md`](./docs/deployment.en.md) |
| **Package Dependencies** | [`docs/architecture.en.md#appendix-a-complete-dependency-table`](./docs/architecture.en.md) |
| **Per-Package Docs** | [`docs/packages/`](./docs/packages/) |
| **evented_v2 Runtime** | [`docs/evented-v2-runtime.en.md`](./docs/evented-v2-runtime.en.md) / [`中文`](./docs/evented-v2-runtime.zh.md) |
| **External A2A Verification Plan** | [`docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md`](./docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md) |
| **Runtime Governance Plan** | [`docs/superpowers/plans/2026-06-22-kk-oclaw-runtime-hardening.md`](./docs/superpowers/plans/2026-06-22-kk-oclaw-runtime-hardening.md) |
| **CI / Delivery Assets** | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml), [`Dockerfile`](./Dockerfile), [`deploy/`](./deploy/) |
| **Chinese README** | [`README.zh.md`](./README.zh.md) |

---

## 🗺️ Roadmap

Qiongqi's four-stage architecture refactoring currently stands at:

| Stage | Goal | Status |
|-------|------|--------|
| **Stage 1** | SDK extraction + monorepo split | Complete |
| **Stage 2** | AgentCard + AgentIdentity | Complete |
| **Stage 3** | TurnOrchestrator event-driven | Complete |
| **Stage 4** | A2A protocol endpoint | Local closed loop complete; external cross-vendor interop awaits a real counterpart |
| **Post-P1** | Runtime governance + OpenTelemetry exporter | Complete |
| **Loop Engineering** | Declarative loop substrate (LoopPlan/LoopRunner/Evaluator) | Complete |
| **evented_v2 Runtime** | Declarative AgentGraph + durable mailbox/outbox + remote worker/scheduler + timeline/metrics | Production foundation complete |
| **Production Deployment and Rollout** | worker pool / deployment-plan / shadow-canary-fallback rollout | Baseline loop complete |
| **Next Deepening** | isolated shadow dual-run diffing, standalone graph manifests, capability constraints, external interoperability | Future control-plane work |

Detailed progress: see CHANGELOG commit history.

---

<p align="center">
  <sub>Built with ❤️ for the Agent era</sub>
</p>
