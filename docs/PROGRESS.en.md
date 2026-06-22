# Qiongqi Refactoring Progress

> This file tracks the completion status of all tasks according to the
> **Four-Stage Architecture Refactoring Plan**.
> It must be updated whenever a milestone or significant change is completed.
>
> 中文版本：[`PROGRESS.zh.md`](./PROGRESS.zh.md)

**Last Updated**: 2026-06-22
**Current Stage**: Stages 1–3 complete ✅, Stage 4 nearly complete (awaiting external Agent cross-vendor verification)

---

## Overall Verification Baseline

| Metric | Current | Target |
|--------|---------|--------|
| Full test suite | 433/433 ✅ | All green |
| Package builds | 18/18 ✅ | All green |
| End-to-end (serve + curl) | ✅ | Pass |

---

## Stage 1: SDK Extraction + Monorepo Split

### 1.1 Initialize Monorepo Skeleton ✅

- [x] `pnpm-workspace.yaml` configured with `packages: ['packages/*']` (legacy `qiongqi/` directory cleaned up and deleted)
- [x] Root `package.json` with vitest devDeps and test scripts
- [x] Root-level `vitest.config.ts` with `@qiongqi/*` alias mapping
- [x] Per-package `tsconfig.json` + `tsconfig.build.json` with paths mapping
- [x] `scripts/flatten-dist.mjs` post-build script (flattens nested dist output)

### 1.2 Package Split (18 packages) ✅

175 source files + 5 CLI files migrated, all imports rewritten to `@qiongqi/*` format.

| Package | Responsibility | Build | Status |
|---------|---------------|-------|--------|
| `@qiongqi/contracts` | Zod schemas + types (zero-dependency base layer) | ✅ | Done |
| `@qiongqi/domain` | Thread/Turn/Item/Event entities | ✅ | Done |
| `@qiongqi/ports` | ModelClient/ToolHost/Stores interfaces | ✅ | Done |
| `@qiongqi/cache` | LRU/TTL/ImmutablePrefix | ✅ | Done |
| `@qiongqi/loop` | TurnOrchestrator/PromptBuilder/Policy + EventedOrch | ✅ | Done |
| `@qiongqi/services` | Thread/Turn/Usage/Review services | ✅ | Done |
| `@qiongqi/adapter-model` | ModelCompatClient | ✅ | Done |
| `@qiongqi/adapter-tools` | bash/read/edit/grep + MCP provider | ✅ | Done |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite storage | ✅ | Done |
| `@qiongqi/skills` | SkillRuntime + PluginHost | ✅ | Done |
| `@qiongqi/memory` | MemoryStore + provider | ✅ | Done |
| `@qiongqi/attachments` | AttachmentStore | ✅ | Done |
| `@qiongqi/adapter-fs` | Pure FS I/O utilities | ✅ | Done |
| `@qiongqi/tool-infra` | Tool execution infrastructure | ✅ | Done |
| `@qiongqi/delegation` | DelegationRuntime + PeerRegistry + SkillRegistry + TaskThreadMap | ✅ | Done |
| `@qiongqi/http` | HTTP/SSE server + routes | ✅ | Done |
| `@qiongqi/cli` | qiongqi CLI entry point | ✅ | Done |
| `@qiongqi/preset-coding` | Coding preset (system prompt + default config) | ✅ | Done |

**Key Technical Decisions**:
- `shared`/`prompt`/`config` → merged into `contracts`
- `telemetry` → merged into `cache`
- `review` → merged into `loop`
- `review-service.ts` moved from `services` to `http` (breaks loop↔services value cycle)
- `defaultLocalTools` changed to lazy function `getDefaultLocalTools()` (breaks adapter-tools circular init)

### 1.3 Key Refactoring Points ✅

- [x] System prompt parameterization (`QiongqiServeRuntimeOptions.systemPrompt` + fallback to `QIONGQI_SYSTEM_PROMPT`)
- [x] Model client rename (`DeepseekCompatModelClient` → `ModelCompatClient`, old name kept as deprecated alias)
- [x] Skills path decoupling (new `skillRoots?: string[]` parameter, removed hardcoded `cwd/qiongqi/skills`)
- [x] Composition Root split:
  - `createCore()` — stores, event bus, Thread/Turn/Usage services
  - `createModelAdapter()` — ModelCompatClient + capability profiles
  - `createToolMatrix()` — tool registry, skills, delegation runtime
  - `createAgent()` — orchestration loop (TurnOrchestrator assembly)
  - `createQiongqiServeRuntime()` kept as backward-compatible alias
- [x] PricingProvider abstraction (decouple DeepSeek hard-coding):
  - New `packages/adapter-model/src/pricing/` subdirectory
  - `types.ts`: `PricingProvider` interface + `CostEstimate` / `PricingInput` types
  - `deepseek-pricing.ts`: `DeepseekPricingProvider` impl (DeepSeek official price table, returns null for non-DeepSeek hosts)
  - `composite-pricing.ts`: `CompositePricingProvider` combinator (returns first non-null estimate in registration order)
  - `index.ts`: barrel exports + `defaultPricingProvider` singleton
  - `ModelCompatClient` accepts `pricingProvider` constructor param, defaults to Composite
  - `mapUsage()` uses injected provider for cost/savings estimation
  - New providers implement `PricingProvider` and register with Composite — no client changes needed
- [x] Model client file rename:
  - `deepseek-compat-model-client.ts` → `model-compat-client.ts`
  - `DeepseekCompatConfig` → `ModelCompatConfig` (old name kept as alias)
  - `deepseek-pricing.ts` logic migrated to `pricing/deepseek-pricing.ts` (original file deleted)

### 1.4 New API Shape ✅

- [x] `createHttpServer` public API (split agent assembly vs HTTP mount):
  - New `createHttpServer(options: { agent, host?, port })`
  - `startQiongqiServe` refactored into `createAgent` + `createHttpServer` composition (backward compatible)
  - `createQiongqiServeRuntime` / `startQiongqiServe` marked `@deprecated`
- [x] JSDoc documentation:
  - `createAgent` — full Quick start example + @param/@returns + sub-component references
  - `createCore` / `createModelAdapter` / `createToolMatrix` — responsibility descriptions + @param
  - `CoreRuntime` / `ModelAdapter` / `ToolMatrix` interface JSDoc
  - `CreateHttpServerOptions` + `createHttpServer` example and use cases
- [x] Fix `RuntimeInfoResponse` schema regression (`agentName` field added in 1.3 was not synced to contracts zod schema)

### 1.5 CLI Entry Rewrite ✅

- [x] CLI defaults to `createCodingAgent` (preset-coding assembly):
  - `cli/package.json` adds `@qiongqi/preset-coding` dependency
  - `ServeOptionsSchema` adds `preset` field (default `'coding'`)
  - `SERVE_PRESETS = ['coding', 'generic']` enum export
  - `parseServeOptions` parses `--preset` flag + `QIONGQI_PRESET` env var
  - `resolveRuntimeFactory(preset)` unified factory selection (shared by serve/run/chat/exec)
  - `serve-entry.ts` switches to `createAgent`/`createCodingAgent` + `createHttpServer` composition
  - Backward compatible: all existing args, env vars, output formats, QIONGQI_READY handshake unchanged
  - E2E verified: default `agentName=Qiongqi Coding`, `--preset generic` → `agentName=Qiongqi`
- [x] `baseUrl` / `apiKey` now required (remove DeepSeek default hard-coding):
  - `ServeOptionsSchema` changed `apiKey`/`baseUrl` from `.default(...)` to `.min(1)`
  - `DEFAULT_SERVE_OPTIONS` excludes `baseUrl`/`apiKey` (no defaults)
  - `parseServeOptionsSafe` gives friendly message when missing (CLI flag / env var / config file)
  - `resolveApiKey`/`resolveBaseUrl` helper functions unify source resolution
  - E2E verified: missing → exit code 78 + friendly message; provided → boots normally

### 1.6 Test Migration ✅

- [x] 53 test files migrated to root `tests/` directory
- [x] All imports rewritten to `@qiongqi/*` format
- [x] `vitest.config.ts` alias mapping (`qiongqi/**` exclude rule removed after cleanup)
- [x] Test helpers (loop-test-harness, http-server-test-harness) migrated
- [x] `defaultLocalTools` → `getDefaultLocalTools()` updated
- [x] Mock paths fixed (`vi.mock` paths updated)
- [x] Full test suite 433/433 passing

### 1.7 End-to-End Verification ✅

- [x] `pnpm -r run build` all packages pass
- [x] `npx vitest run` full test suite passes
- [x] `qiongqi serve` starts successfully
- [x] `GET /health` returns `{"status":"ok"}`
- [x] `POST /v1/threads` creates thread successfully
- [x] `GET /v1/threads` list persistence works
- [x] Auth middleware works correctly

### 1.7.1 Legacy Monolith Directory Cleanup ✅

- [x] `qiongqi/skills/` → root `skills/` (11 preset skills)
- [x] `qiongqi/DESIGN.md` → `docs/design-philosophy.zh.md`
- [x] `qiongqi/config.example.json` → root `config.example.json`
- [x] `qiongqi/scripts/transcript-diff.mjs` → root `scripts/`
- [x] `pnpm-workspace.yaml` removed `'qiongqi'` entry
- [x] Entire `qiongqi/` directory deleted (272 files: 181 redundant source files + 42 redundant tests + dist/ + node_modules/)
- [x] `tests/builtin-skills.test.ts` path fixed (`qiongqi/skills` → `skills`)
- [x] Post-cleanup full test suite 433/433 passing + end-to-end verification passed

### 1.8 Deliverables ✅

- [x] 18 independent npm packages, each with `package.json` + `tsconfig.json` + `tsconfig.build.json`:
  - All packages have top-level `types: ./dist/index.d.ts` (compat for older TS / tools)
  - All packages have `exports` with `types` + `import` sub-fields
  - All packages generate correct `.d.ts` declarations (11~71 lines each)
  - `cli` package adds `bin: { qiongqi: ./dist/serve-entry.js }` entry
- [x] `createAgent` / `createHttpServer` public API docs (JSDoc) — see 1.4
- [x] preset-coding package verified: external consumer simulation test passes (`createCodingAgent` / `CODING_SYSTEM_PROMPT` / `CODING_PINNED_CONSTRAINTS` exports work)
- [x] Full test suite + end-to-end verification passed:
  - 18 packages build green + 433/433 tests green + tsc 0 errors
  - bin entry boots successfully (`agentName=Qiongqi Coding`)
  - Health check / Runtime info / Thread CRUD all pass

---

## Stage 2: AgentCard + AgentIdentity ✅

- [x] `AgentCardSchema` contract definition (`packages/contracts/src/agent-identity.ts`):
  - `SkillSummarySchema` — lightweight skill summary (avoids contracts → skills circular dependency)
  - `AgentCardSchema` — agent identity card (id/url/name/version/skills/capabilities/model/endpoints)
  - `PeerRecordSchema` — local/remote peer records
  - `PeerTaskSchema` / `PeerArtifactSchema` — A2A task & result types
- [x] `PeerRegistry` implementation (`packages/delegation/src/peer-registry.ts`):
  - `LocalPeerHandle` interface — in-process local peer invocation
  - `RemotePeerTransport` interface — remote HTTP peer transport (implemented by http, dependency inversion)
  - `PeerRegistry` — unified `invokePeer(cardId, task)` entry point
  - `FilePeerStore` — remote peer persistence to `peers.json`
- [x] `GET /.well-known/agent-card.json` endpoint:
  - Unauthenticated (RFC 8615 discovery convention)
  - Auto-builds or accepts an explicit AgentCard
  - Stable id persisted to `<dataDir>/agent-identity.json`
- [x] DelegationRuntime refactoring:
  - Optional `peerRegistry` injection — child agents auto-register on run
  - `runChild()` dispatches via `invokePeer(childCardId, task)` when peerRegistry present
  - LocalPeerHandle.invoke bound to real child-agent-executor
  - Child AgentCard persisted to `<dataDir>/agents/<id>/card.json`
  - Behaviour unchanged when no peerRegistry (backward compatible)
- [x] A2A protocol implementation:
  - `POST /a2a` endpoint (authenticated) — receives PeerTask, creates temp thread + runs turn, returns PeerArtifact
  - `HttpPeerTransport` — HTTP implementation of `RemotePeerTransport` (token resolution callback)
  - `createAgent` injects `HttpPeerTransport` + `PeerRegistry` into runtime
- [x] Cross-instance A2A closed-loop verification:
  - AgentCard discovery: two instances have independent `qiongqi:<uuid>` ids
  - AgentCard endpoint returns complete card (id/url/name/version/model/endpoints/capabilities)
  - `POST /a2a` task submission: A→B / B→A cross-call receives task, creates thread, executes turn, returns PeerArtifact
  - Id persists across restarts
  - Full 433/433 tests + tsc 0 errors

---

## Stage 3: TurnOrchestrator Event-Driven ✅

- [x] Event type system (`packages/loop/src/turn-event-types.ts`):
  - `TurnStateV1` — serialisable turn state (version/threadId/turnId/stepIndex/events/items/status)
  - `TurnStepEvent` — step-level event union type (step:start/prompt:built/model:ran/decision/tools:dispatched etc.)
  - `TurnStateSerializer` — state persistence interface (save/load/delete/list)
  - `OrchestrationMode = 'classic' | 'evented'` — dual-mode enum
- [x] `FileTurnStateStore` (`packages/loop/src/turn-state-store.ts`):
  - File-based `TurnStateSerializer` implementation
  - Persists to `<dataDir>/<threadId>/turns/<turnId>/state.json`
- [x] `EventedTurnOrchestrator` (`packages/loop/src/evented-turn-orchestrator.ts`):
  - Owns independent PromptBuilder/ModelStepRunner/ToolCallCoordinator instances
  - Implements its own event-driven loop, calling shared `runOrchestratorStep` per iteration
  - Persists `TurnStateV1` before/after each step for crash recovery
  - `assembleRuntime` conditionally selects orchestrator based on `orchestrationMode`
- [x] `runOrchestratorStep` shared function (`packages/loop/src/turn-orchestrator.ts`):
  - Extracted from `TurnOrchestrator.runStep` as a pure function
  - Classic and evented orchestrators share the same step logic
- [x] `QiongqiServeRuntimeOptions.orchestrationMode` dual-run flag
  - `classic` default, `evented` uses EventedTurnOrchestrator + FileTurnStateStore
- [x] Full test suite 433/433 passing (classic mode)
- [x] `TurnEventBus` + `runStepViaEventBus` (`packages/loop/src/turn-event-bus.ts`):
  - Lightweight in-process event bus, subscribe by `TurnStepEvent.kind`
  - `runStepViaEventBus` — event-driven step execution (replaces sequential calls)
  - Step boundaries now publish `step:start` / `step:end` so subscribers can observe evented turn boundaries
  - `EventedTurnOrchestrator` supports `TurnEventBus` injection, dual-mode operation
- [x] End-to-end recovery verification:
  - evented mode + real model: turn executes correctly
  - Simulated crash: save state.json (stepIndex=1), resume from breakpoint on restart
  - State auto-cleaned after turn completion
  - Full 433/433 tests + tsc 0 errors
- [x] `scripts/verify-evented-a2a.mjs` local two-instance verification:
  - Starts a local fake model + two evented Qiongqi HTTP runtimes
  - Covers AgentCard discovery, A2A task lifecycle, artifacts, and SSE subscribe
  - Verifies evented turn state cleanup after the A2A turn completes

---

## Stage 4: A2A Protocol Endpoint 🔄

> Note: Qiongqi internal two-instance A2A cross-call verification was completed in Stage 2 (AgentCard discovery → POST /a2a → PeerArtifact);
> cross-vendor interoperability verification has no external Agent as a baseline.

- [x] `A2ATaskRecord` data model (`packages/http/src/a2a-task-model.ts`)
  - Task states: submitted → working → completed/failed/cancelled
- [x] `FileA2ATaskStore` (`packages/http/src/a2a-task-store.ts`)
  - Persists to `<dataDir>/a2a-tasks/<id>.json`
- [x] A2A endpoint upgrade:
  - `POST /a2a/tasks` — creates task, starts a background turn, quickly returns 202 + task
  - `GET /a2a/tasks/{id}` — queries task status
  - Old `POST /a2a` keeps synchronous compatibility and returns the legacy PeerArtifact semantics
- [x] `ServerRuntime.a2aTaskStore` injection
- [x] `POST /a2a/tasks/{id}/cancel` — cancels pending/working tasks and interrupts the associated turn through a runtime hook; background completion no longer overwrites a cancelled terminal state
- [x] `GET /a2a/tasks/{id}/artifacts` — retrieve turn items from task's thread
- [x] `GET /a2a/tasks/{id}/subscribe` — SSE event stream (completed: immediate push, in-progress: polling+eventBus)
- [x] `ArtifactSchema` + `mapItemsToArtifacts()` — A2A Artifact ↔ TurnItem bridge (`packages/contracts/src/a2a-artifact.ts`)
  - assistant_text→text/markdown, tool_result→application/json, error→text/plain
  - a2aCreateTask response includes `artifacts` array
- [x] `HttpPeerTransport` accepts both legacy `PeerArtifact` responses and Stage 4 `{ task, artifact, artifacts }` responses
- [ ] `A2APeerAdapter` — covered by HttpPeerTransport
- [ ] Cross-vendor interoperability verification (moved to P2: requires a real external peer/vendor counterpart)
- [x] End-to-end cross-instance collaboration verification (local fake-model two-instance path; external peer still requires a real counterpart)

## P1: Production Operations Surface 🔄

- [x] `GET /ready` readiness check:
  - Unauthenticated, separate from `/health` liveness
  - Exposes storage degraded state, making hybrid SQLite fallback visible
- [x] `GET /v1/runtime/metrics` runtime metrics:
  - Bearer-authenticated
  - JSON by default; supports `?format=prometheus` / `Accept: text/plain` for Prometheus text
  - Summarizes token/cache usage, A2A task status counts, and storage diagnostics
- [x] `HybridThreadStore.diagnostics()`:
  - Exposes `backend=hybrid`, SQLite path, SQLite availability, and fallback reason
  - Runtime factory injects `ServerRuntime.storageDiagnostics`
- [x] Structured logs / request id:
  - `dispatchRequest` generates or reuses `x-request-id` and writes it back to response headers
  - `startNodeHttpServer` / `createHttpServer` accept an `accessLog` sink for redacted structured access logs
- [x] Prometheus exporter:
  - `/v1/runtime/metrics?format=prometheus` exports `qiongqi_usage_*`, `qiongqi_cache_hit_rate`, `qiongqi_a2a_tasks_total`, and `qiongqi_storage_degraded`
- [x] CI and production deployment docs:
  - GitHub Actions covers SQLite native binding build+verify, typecheck, fast tests, build, flatten, and evented A2A
  - `docs/deployment.en.md` documents probes, Prometheus scrape, hybrid storage gate, structured logs, and A2A verification
  - Provides `Dockerfile`, `docker-compose.yml`, Kubernetes manifest, and Prometheus alert rules
- [x] Trace id / OpenTelemetry-compatible propagation:
  - Supports W3C `traceparent` propagation
  - Access logs include `traceparent`, `traceId`, and `spanId` for OTel collectors/loggers

## P2: Cross-instance Interoperability and Deeper Observability

- [ ] Real external A2A peer / cross-vendor interoperability verification:
  - Reuse `pnpm run verify:evented-a2a -- --external-peer`
  - Requires `QIONGQI_A2A_PEER_URL` / `QIONGQI_A2A_PEER_TOKEN` pointing at a real counterpart
- [ ] Full OpenTelemetry SDK exporter:
  - Add span lifecycle/exporter on top of existing `traceparent` propagation

| `@qiongqi/adapter-fs` | File-system capabilities (read/write/edit/grep/find/ls/bash) | ✅ | New |
| `@qiongqi/tool-infra` | Tool infrastructure (hooks/rate-limit/mutation-queue) | ✅ | New |
