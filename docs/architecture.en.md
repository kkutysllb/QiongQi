# Qiongqi Architecture

> Qiongqi is not evil — it is the edge that breaks the impasse. The skeleton is constant; the flesh is mutable.
>
> **Document purpose**: A unified reference that fuses **design philosophy** and **technical architecture** — the load-bearing layer between `README` (entry point) and `PROGRESS` (changelog).
>
> **Version note**: This document reflects the 18-package, Stages 1–3 complete / Stage 4 nearly complete state as of 2026-06-22.
>
> 中文版本：[`architecture.zh.md`](./architecture.zh.md)

---

## 0. How to Read

**Who should read this**: New contributors to Qiongqi, developers extending the framework, and researchers seeking to understand the internals of an Agent engine.

**Reading order**:

1. **Want to understand "why"** → §1 Design Philosophy
2. **Want to understand "what it looks like"** → §2 Architecture Overview
3. **Want to understand "how it's split"** → §3 Package Structure
4. **Want to understand "why it's designed this way"** → §4 Key Architectural Decisions
5. **Want to "add new capability"** → §6 Extension Guide
6. **Want to see "where we are"** → §5 Roadmap & Status + `PROGRESS.en.md`

**What this document does NOT cover**:

- Detailed change history and milestones (see `PROGRESS.en.md`)
- Per-package source code walkthroughs (see each package's `src/` + JSDoc)
- Configuration file schema (see `config.example.json` + `packages/contracts/src/qiongqi-config.ts`)

---

## 1. Design Philosophy

Qiongqi is named after the mythical beast from the *Shanhaijing* (山海经), *Shenyijing* (神异经), and *Zuozhuan* (左传) — a creature "tiger-shaped, winged, understands human speech, and dares to destroy trust and discard loyalty" ("状如虎，有翼，知人言语，敢毁信废忠"). We do not treat it as a villain; we treat it as an archetype of **rebellion against central authority and rigid order**.

> "Qiongqi destroys trust and discards loyalty, honoring vile words" — *Zuozhuan* · Duke Wen 18 (《左传·文公十八年》)
> "Qiongqi is tiger-shaped, winged, and devours people" — *Shanhaijing* · Within the Seas, North (《山海经·海内北经》)
> "Qiongqi understands human speech; on hearing a dispute it devours the upright, and on hearing of loyalty it devours their nose" — *Shenyijing* (《神异经》)

These three classical quotations map to the engine's three core propositions.

### 1.1 Three Heads, Three Propositions

#### Proposition ① — The Rebel Against Central Authority

> "Destroying trust, discarding loyalty" — refusing fealty to a single order.

Traditional Agent frameworks depend on a central orchestrator (master agent); all other Agents are its vassals. Qiongqi **rejects this oligarch pattern**:

- Turn orchestration, tool coordination, and context compression are each replaceable port/adapter contracts
- The engine itself (loop + services) only provides "rules of procedure" — it does not make business decisions
- Multi-Agent collaboration happens through decoupled scaffolding (EventBus / Store / Gate), driven by self-negotiation rather than central command
- Sub-agents exist as independent `AgentCard` identities, addressable across processes by other instances

#### Proposition ② — The Self-Reliant "Tiger-Wing"

> "Tiger-shaped, winged" — single combatant, closed-loop operations.

Every Agent is an end-to-end independent execution unit:

- A single Agent can complete the full closed loop from prompt → tool call → result without external help
- Each thread owns its own three-piece artifact set: `messages.jsonl` + `events.jsonl` + `session.json`
- Built-in tools (`read` / `bash` / `edit` / `write` / `grep` / `find` / `ls`) plus 11 bundled `skills/` form a complete "sense-decide-act" closed loop
- `LocalToolHost` does not depend on remote scheduling — it can be deployed into any workspace and start fighting immediately

#### Proposition ③ — The Self-Negotiating Organization That "Speaks Human"

> "Understands human speech" — hearing each other's language, dynamically evaluating the situation.

Multiple Agents self-negotiate through standardized interfaces; the engine does not participate in business decisions:

- The engine and skill system are **fully decoupled** — `CapabilityRegistry` hot-plugs any provider (`Skill` / `MCP` / `Web` / `Memory` / `Delegation`)
- The same engine, today loaded with finance skills, is a risk-control team; tomorrow loaded with AIGC skills, it is a creative studio
- **The engine is the skeleton; skills are the flesh** — `preset-coding` is the ready-made example of "skeleton + coding flesh", but the skeleton itself is not limited to coding

### 1.2 Propositions ↔ Architecture Mapping (Self-Assessment)

| Proposition | Current Implementation | Alignment |
| --- | --- | --- |
| ① Decentralization: reject central orchestrator | `TurnOrchestrator` is still an in-process explicit orchestrator (Engine owns step advancement); sub-agents are spawned through `DelegationRuntime` + `PeerRegistry`; `EventedTurnOrchestrator` introduced in Stage 3 brings an event bus (`TurnEventBus`) but stays in-process | ⚠️ **Partial alignment**. Sub-agents have self-determination; root turns are still centrally coordinated. Cross-process addressing is realized via A2A protocol (Stage 2 + Stage 4) |
| ② End-to-end independence: single combatant closed loop | Each thread has an independent event log; `buildDefaultLocalTools` provides the full toolset; `LocalToolHost` does not depend on remote scheduling; CLI subcommands `qiongqi run/chat/exec` can be invoked independently | ✅ **High alignment** |
| ③ Engine–skill decoupling | `CapabilityRegistry` / `SkillRuntime` / `SkillPluginHost` / `MCP tool provider` / `Web tool provider` / `Memory tool provider` / `Delegation tool provider` are all hot-pluggable providers; `skill-mcp-bridge` merges skill-declared MCP servers into the registry | ✅ **Full alignment** |

> The "⚠️ Partial alignment" on Proposition ① is an honest annotation — internally the Engine still drives step advancement explicitly. `EventedTurnOrchestrator` breaks the step into "subscriber collaboration" as a foundation for future true peer-style orchestration; see §4.4.

### 1.3 Skeleton Constant, Flesh Mutable

This is Qiongqi's **core operational target** — **maximize ROI per token**:

- **Avoid repeated tool schemas**: Tool catalog fingerprint (`buildToolCatalogFingerprint`) detects changes to prevent prompt cache invalidation
- **Avoid runaway tool output**: Tool storm breaker (`ToolStormBreaker`) + tool argument repair (`tool-argument-repair`)
- **Avoid malformed history**: Two-stage repair via `repairModelHistoryItems` + `healLoadedHistoryItems`
- **Avoid invalid retries**: `ContinuationPolicy` distinguishes `failed` from `failed_with_error`
- **Avoid missing cache hits on stable prefixes**: `ImmutablePrefix` + drift detection + prefix verification — three layers of protection

To support this target, the architecture obeys three hard constraints:

1. **Engine layer (Loop, Ports, Adapters) is strictly separated from the domain layer (Skills, Presets)** — any business capability can only be attached as "flesh", never invading the skeleton
2. **Dependency direction is strictly one-way** — `contracts ← domain ← ports ← {cache, loop, services} ← adapters ← {skills, memory, attachments, delegation} ← http ← cli`; any cycle must be broken at the `import type` layer
3. **Composable** — the monorepo multi-package structure allows assembling capability matrices on demand; you don't have to use all 18 packages

---

## 2. Architecture Overview

### 2.1 Layered View

```
┌─────────────────────────────────────────────────────────┐
│                preset-coding  (domain preset)           │
│        "skeleton + coding flesh": system prompt +       │
│         default tools + skills                          │
├─────────────────────────────────────────────────────────┤
│  cli ← http ← delegation ← {skills, memory, attachments}│
│   └─(config/launch)─ └─(routes/A2A)─ └─(sub-agent)─     │
│                       └─(capability)─                   │
│                    ↓                                     │
│         {adapter-model, adapter-tools, adapter-storage, │
│          adapter-fs, tool-infra}                         │
│                    ↓                                     │
│              {loop, services}                            │
│           ↕ (type-only mutual reference)                 │
│                    ↓                                     │
│              cache ← ports ← domain ← contracts          │
└─────────────────────────────────────────────────────────┘
```

Dependency direction: each layer only depends on layers below it; within the same layer, type-only cycles are permitted (e.g. `loop ↔ services`).

### 2.2 Core Data Flow: A Turn's Complete Lifecycle

```
HTTP POST /v1/threads/{id}/turns
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ TurnService │ ──→ │   Turn       │ ──→ │  PromptBuilder  │
│   .start()  │     │ Orchestrator │     │ (immutable      │
└─────────────┘     │  (classic /  │     │  prefix +       │
                    │  evented)    │     │  drift detect)  │
                    └──────┬───────┘     └────────┬────────┘
                           │                      │
                           ▼                      ▼
                    ┌──────────────┐     ┌─────────────────┐
                    │ ModelStep    │ ←── │  ModelClient    │
                    │ Runner       │     │ (adapter-model) │
                    └──────┬───────┘     └─────────────────┘
                           │
                    ┌──────▼───────┐
                    │ Continuation │
                    │ Policy       │  ←─ pure function: stop/continue/failed/
                    └──────┬───────┘        materialize_plan/dispatch
                           │ (has tool calls?)
                    ┌──────▼───────┐
                    │ ToolCall     │ ──→ LocalToolHost (adapter-tools)
                    │ Coordinator  │ ──→ MCP / Skills / Delegation
                    │ + Storm      │     / Web / Memory providers
                    │   Breaker    │ ──→ adapter-fs + tool-infra
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Context      │ ←─ soft/hard/aggressive 3-tier
                    │ Compactor    │     heuristic / model summary
                    └──────┬───────┘     + skill pin preservation
                           │
                    (loop until stop)
                           │
                    ┌──────▼───────┐
                    │ RuntimeEvent │ ──→ EventBus.publish() → SSE
                    │  Recorder    │ ──→ SessionStore.appendEvent()
                    └──────────────┘     (for replay, monotonic seq)
```

**Key invariants**:

- `RuntimeEventRecorder` is the **sole event producer** — all components produce drafts; the recorder assigns `seq`, stamps `timestamp`, fans out, and persists
- `TurnService` is the **sole mutation point for thread/turn/item state** — other components write via `applyItem` / `updateItem` / `finishTurn`
- `PromptBuilder.build()` reassembles the prefix on every call, but `ImmutablePrefix` uses SHA-256 fingerprints to guarantee byte-stability of `systemPrompt + tools + pinnedConstraints + fewShots`

### 2.2.1 Post-P1 Runtime Governance Layer

Qiongqi replaces kk_OClaw `coding_core`; it does not borrow LangGraph, LangChain, or Python core contracts as internal orchestration. kk_OClaw is used only as a product/runtime-governance reference, and the reusable safety, budgeting, path, memory, and terminal-state patterns are reimplemented inside Qiongqi-native package boundaries.

- `@qiongqi/tool-infra`: `applyToolResultBudget` externalizes oversized tool results into outputs and gives the model a head/tail preview; `auditShellCommand` classifies bash commands as block/warn/allow before execution and masks secrets.
- `@qiongqi/attachments` + `@qiongqi/http`: `VirtualPathResolver` provides `/mnt/qiongqi/{workspace,uploads,outputs,artifacts}` virtual mounts; HTTP artifact routes read only thread-local uploads/outputs/artifacts.
- `@qiongqi/delegation` + `@qiongqi/http`: terminal-state helpers and `FileA2ATaskStore` prevent completed/failed/cancelled/aborted records from being overwritten by late racing updates.
- `@qiongqi/memory`: retrieval now uses Chinese/English lexical ranking, technical-token exact matches, scope filtering, and confidence/recency tie-breaks.

### 2.3 Storage & State Architecture

```
ThreadStore (metadata)             SessionStore (event log)
    │                                   │
    ├── InMemoryThreadStore             ├── InMemorySessionStore
    ├── FileThreadStore                 ├── FileSessionStore (JSONL)
    └── HybridThreadStore               └── HybridSessionStore
         (SQLite index +                       (SQLite index +
          JSONL fallback)                       JSONL fallback)
                                              ↑
                                       RuntimeEventRecorder
                                       (appendEvent + seq assignment)

FileTurnStateStore (Stage 3 crash recovery)
  └── <dataDir>/<threadId>/turns/<turnId>/state.json
        TurnStateV1 = {version, threadId, turnId, stepIndex,
                       events: TurnStepEvent[], items, status}
        Purpose: after kill -9, EventedTurnOrchestrator resumes from stepIndex

FileA2ATaskStore (Stage 4 A2A tasks)
  └── <dataDir>/a2a-tasks/<id>.json
        A2ATaskRecord = {id, status: submitted/working/completed/...,
                         threadId, prompt, artifact, artifacts[]}
```

**Storage selection principles**:

- **Production**: `hybrid` (SQLite index + JSONL full log, Codex-style) — balances index performance with full readability
- **Debug / single-machine**: `file` (pure JSONL) — directly `cat` / `jq`-able
- **Tests**: `in-memory` (`InMemoryThreadStore` / `InMemorySessionStore` / `InMemoryEventBus`) — speed first
- **Crash recovery**: Stage 3 introduced `FileTurnStateStore`, only enabled by `EventedTurnOrchestrator`
- **A2A tasks**: Stage 4 dedicated store; task lifecycle is decoupled from threads

---

## 3. Package Structure (18 packages)

### 3.1 Package List (one-liner per package)

| # | Package | Responsibility |
|---|---------|----------------|
| 1 | `@qiongqi/contracts` | Zod schemas + TypeScript types (zero-dep foundation) |
| 2 | `@qiongqi/domain` | Thread / Turn / Item / Event entities and factory functions |
| 3 | `@qiongqi/ports` | ModelClient / ToolHost / Stores / EventBus / Gates interfaces (Hexagonal ports) |
| 4 | `@qiongqi/cache` | LRU / TTL cache, ImmutablePrefix, tool fingerprint, telemetry |
| 5 | `@qiongqi/attachments` | AttachmentStore (attachment metadata + binary stripping) |
| 6 | `@qiongqi/adapter-fs` | Pure FS I/O utilities (edit-diff / truncate / fs-types, no Agent concepts) |
| 7 | `@qiongqi/tool-infra` | Tool execution infrastructure (FileMutationQueue / OutputAccumulator / ToolRateLimit) |
| 8 | `@qiongqi/adapter-model` | OpenAI-compatible model client (chat_completions / responses / messages) |
| 9 | `@qiongqi/adapter-storage` | File / Hybrid / SQLite storage + all in-memory adapters |
| 10 | `@qiongqi/adapter-tools` | Built-in tools (bash / read / edit / grep / find / ls / write) + MCP provider + local tool host |
| 11 | `@qiongqi/skills` | SkillRuntime + SkillPluginHost + skill-tool-provider + marketplace |
| 12 | `@qiongqi/memory` | Cross-session MemoryStore + context injection |
| 13 | `@qiongqi/loop` | TurnOrchestrator / EventedTurnOrchestrator / PromptBuilder / ContinuationPolicy / ToolCallCoordinator / ContextCompactor / TurnEventBus |
| 14 | `@qiongqi/services` | ThreadService / TurnService / UsageService / RuntimeEventRecorder |
| 15 | `@qiongqi/delegation` | DelegationRuntime / ChildAgentExecutor / PeerRegistry / SkillRegistry / TaskThreadMap |
| 16 | `@qiongqi/http` | HTTP/SSE server, Router, Composition Root (`createAgent` / `createHttpServer`), A2A endpoints |
| 17 | `@qiongqi/cli` | `qiongqi` CLI entry point (`serve` / `run` / `chat` / `exec`) |
| 18 | `@qiongqi/preset-coding` | Coding preset (system prompt + tool matrix + skills) |

### 3.2 Dependency Layers (Layer 0–10)

```
Layer 0  (zero deps):    contracts
Layer 1:                 domain
Layer 2:                 ports
Layer 3:                 cache, attachments, adapter-fs
Layer 4:                 services, loop  ← (mutual type-only refs, no value cycle)
                          tool-infra (depends on adapter-fs)
Layer 5:                 adapter-model, adapter-storage, adapter-tools
Layer 6:                 skills, memory
Layer 7:                 delegation
Layer 8:                 http
Layer 9:                 cli
Layer 10:                 preset-coding
```

Dependency direction is strictly one-way — any lower → upper reference is treated as an error (type-only references are the only exception).

### 3.3 Package Guide (grouped by layer)

#### Layer 0 — Zero-dep Foundation

> 📦 Detailed technical docs (Chinese): [`./packages/contracts.md`](./packages/contracts.md) · [`./packages/domain.md`](./packages/domain.md) · [`./packages/ports.md`](./packages/ports.md) · [`./packages/cache.md`](./packages/cache.md) · [`./packages/attachments.md`](./packages/attachments.md)

**`@qiongqi/contracts`** — Zero dependencies. All Zod schemas and TypeScript types for HTTP/SSE interfaces, events, items, capability manifests, configs, and secret redaction.

| Module | Content |
|--------|---------|
| `approvals` / `attachments` / `capabilities` / `events` / `items` / `memory` / `policy` / `review` / `threads` / `turns` / `usage` | Contract schemas |
| `qiongqi-config` | Runtime config schema |
| `qiongqi-system-prompt` | Default system prompt |
| `secret-redaction` | Secret redaction utilities |

```typescript
import { ThreadSchema, TurnSchema, UsageSnapshotSchema } from '@qiongqi/contracts'
```

#### Layer 1 — Pure Domain

> 📦 Detailed technical docs (Chinese): [`./packages/domain.md`](./packages/domain.md)

**`@qiongqi/domain`** — Pure domain entities and value objects, **no I/O**.

| Module | Content |
|--------|---------|
| `thread` | `createThreadRecord()` factory |
| `turn` | Turn state machine + `appendTurnItem` / `replaceTurnItem` |
| `item` | 10 typed factories (`makeUserItem` / `makeToolResultItem` / `makeApprovalItem` etc.) |
| `event` | Event types + `compareEventSeq` |
| `approval` / `usage` | Pure functions for approval/usage |
| `runtime-event-reducer` | Event reducer (event stream → state snapshot, foundation for SSE replay) |
| `model-history-repair` | Model history repair (malformed message correction) |

```typescript
import { createThreadRecord, makeToolResultItem } from '@qiongqi/domain'
```

#### Layer 2 — Ports (Hexagonal)

> 📦 Detailed technical docs (Chinese): [`./packages/ports.md`](./packages/ports.md)

**`@qiongqi/ports`** — Abstract interfaces for all external dependencies. The engine never depends on concrete implementations.

| Interface | Purpose |
|-----------|---------|
| `ModelClient` | `stream(request) → AsyncIterable<ModelStreamChunk>` (7 chunk types) |
| `ToolHost` | Tool execution host + `ToolHostContext` dependency bundle |
| `ThreadStore` / `SessionStore` | Persistence (events + items + session projection) |
| `EventBus` | Synchronous in-memory event bus (`publish` / `subscribe` / `snapshotSince`) |
| `ApprovalGate` / `UserInputGate` | Human-in-the-loop gates (blocking `request` + external `decide`) |
| `WorkspaceInspector` | Workspace git status query |
| `WebProvider` / `Clock` / `IdGenerator` | Utility interfaces + time + ID abstractions (test-injectable) |

```typescript
import type { ModelClient, ToolHost, ThreadStore } from '@qiongqi/ports'
```

#### Layer 3 — Infrastructure

> 📦 Detailed technical docs (Chinese): [`./packages/cache.md`](./packages/cache.md) · [`./packages/attachments.md`](./packages/attachments.md) · [`./packages/adapter-fs.md`](./packages/adapter-fs.md) · [`./packages/tool-infra.md`](./packages/tool-infra.md)

**`@qiongqi/cache`** — Cache infrastructure, immutable prefix, tool fingerprint, telemetry.

| Module | Content |
|--------|---------|
| `immutable-prefix` | `createImmutablePrefix()` — SHA-256 fingerprint + `revision` counter; `verifyImmutablePrefix()` dev-mode check |
| `lru-cache` / `ttl-lru-cache` | Basic LRU + TTL dual-policy cache |
| `prefix-volatility` | Prefix volatility analysis (UUID / ISO 8601 / hex hash detection) |
| `tool-catalog-fingerprint` | Tool catalog fingerprint (detects schema changes; breaking vs additive drift) |
| `cache-telemetry` | Cache hit rate metrics |
| `usage-counter` | Token usage counter (with cache hit rate recompute) |

**`@qiongqi/attachments`** — Attachment management.

```typescript
import { AttachmentStore } from '@qiongqi/attachments'
```

**`@qiongqi/adapter-fs`** (Stage 1.8 new) — **Pure FS I/O utilities, no Agent concepts**. Split out from `adapter-tools`.

| Module | Content |
|--------|---------|
| `edit-diff` | Fuzzy match + unified patch generation |
| `truncate` | `truncateHead` / `truncateTail` + `formatSize` |
| `fs-types` | `FsStats` / `ShellConfig` / `TruncateMode` / `TextSlice` |

**`@qiongqi/tool-infra`** (Stage 1.8 new) — **Tool execution infrastructure**. Depends on `adapter-fs`.

| Module | Content |
|--------|---------|
| `file-mutation-queue` | Cross-process file lock (based on `tmpdir`) |
| `output-accumulator` | UTF-8 / UTF-16LE detection + Han character detection output truncation accumulator |
| `tool-rate-limit` | `parseRateLimitedToolResult` rate-limit result parser |

#### Layer 4 — Engine

> 📦 Detailed technical docs (Chinese): [`./packages/services-event-recorder.md`](./packages/services-event-recorder.md) · [`./packages/services-thread-turn.md`](./packages/services-thread-turn.md) · [`./packages/services-usage.md`](./packages/services-usage.md) · [`./packages/loop-orchestrator.md`](./packages/loop-orchestrator.md) · [`./packages/loop-prompt-and-context.md`](./packages/loop-prompt-and-context.md) · [`./packages/loop-tool-coordination.md`](./packages/loop-tool-coordination.md)

**`@qiongqi/loop`** — Agent Loop core — turn orchestration, prompt building, continuation decisions, tool coordination.

| Module | Content |
|--------|---------|
| `turn-orchestrator` | `TurnOrchestrator` — classic orchestrator (central loop) |
| `prompt-builder` | `PromptBuilder` — prompt assembly (system / context / tools / history / attachments) |
| `model-step-runner` | `ModelStepRunner` — model inference step runner (consumes `AsyncIterable<ModelStreamChunk>`) |
| `continuation-policy` | Pure decision function: `stop` / `continue` / `failed` / `failed_with_error` / `materialize_plan` / `dispatch` |
| `tool-call-coordinator` | `ToolCallCoordinator` — tool call dispatch (with storm breaker + parallel-safe batching) |
| `context-compactor` | `ContextCompactor` — soft / hard / aggressive 3-tier compression, heuristic + model dual mode |
| `token-economy` | Token economy (tool description/result compression) |
| `tool-storm-breaker` | Tool storm suppression (8-window threshold 3, turn-scoped reset) |
| `evented-turn-orchestrator` | `EventedTurnOrchestrator` (Stage 3) — event-driven orchestrator + crash recovery |
| `turn-event-bus` | `TurnEventBus` (Stage 3) — in-process event bus, subscribe by `TurnStepEvent.kind` |
| `turn-state-store` | `FileTurnStateStore` (Stage 3) — crash recovery persistence (`<dataDir>/<threadId>/turns/<turnId>/state.json`) |
| `turn-event-types` | `TurnStateV1` / `TurnStepEvent` / `TurnStateSerializer` (Stage 3) |
| `inflight-tracker` / `steering-queue` / `auto-model-router` | inflight tracking / steering message queue / auto model router |

**`@qiongqi/services`** — Application service layer — thread/turn/usage business logic encapsulation.

| Module | Content |
|--------|---------|
| `thread-service` | `ThreadService` — thread CRUD + Fork / Side + Goal / Todo management |
| `turn-service` | `TurnService` — turn start / status / interrupt / steer / compact / finish |
| `usage-service` | `UsageService` — token usage aggregation and query |
| `runtime-event-recorder` | `RuntimeEventRecorder` — sole event producer (seq assignment + Zod validation + fan-out + persistence) |

> **Note**: `loop` and `services` depend on each other, but the cycle is broken via `import type`. See §4.2.

#### Layer 5 — Adapters

> 📦 Detailed technical docs (Chinese): [`./packages/adapter-storage.md`](./packages/adapter-storage.md) · [`./packages/adapter-model-client.md`](./packages/adapter-model-client.md) · [`./packages/adapter-model-pricing.md`](./packages/adapter-model-pricing.md) · [`./packages/adapter-tools-registry.md`](./packages/adapter-tools-registry.md) · [`./packages/adapter-tools-builtin.md`](./packages/adapter-tools-builtin.md) · [`./packages/adapter-tools-providers.md`](./packages/adapter-tools-providers.md)

**`@qiongqi/adapter-model`** — Model client adapter (OpenAI-compatible API).

| Module | Content |
|--------|---------|
| `model-compat-client` | `ModelCompatClient` (renamed from `DeepseekCompatModelClient` in Stage 1.3) — three endpoint formats: `chat_completions` / `responses` / `messages` |
| `pricing/` | `PricingProvider` abstraction (`DeepseekPricingProvider` + `CompositePricingProvider`) |
| `model-error-probe` | Model error probing (classifies retry strategy) |
| `tool-argument-repair` | Tool argument repair (JSON malformed correction) |

**`@qiongqi/adapter-storage`** — Storage adapter implementations + in-memory adapters.

| Module | Content |
|--------|---------|
| `file-thread-store` / `file-session-store` | JSON file / JSONL append-only event log |
| `hybrid-thread-store` / `hybrid-session-store` | SQLite index + JSONL hybrid (Codex-style) |
| `in-memory-*` | `InMemoryThreadStore` / `InMemorySessionStore` / `InMemoryEventBus` / `InMemoryApprovalGate` / `InMemoryUserInputGate` (for tests) |
| `local-workspace-inspector` | Local workspace inspector |
| `atomic-write` | `atomicWriteFile()` (with win32 fallback) |

**`@qiongqi/adapter-tools`** — Built-in tools + MCP provider + local tool host. **`adapter-fs` + `tool-infra` are barrel re-exported for backward compatibility**.

| Module | Content |
|--------|---------|
| `local-tool-host` | `LocalToolHost` — tool execution host implementation |
| `capability-registry` | `CapabilityRegistry` — tool capability registry |
| `builtin-tools` | `buildBuiltinLocalTools()` / `getDefaultLocalTools()` (**lazy function**, breaks init cycle) |
| `bash` / `read` / `edit` / `write` / `grep` / `find` / `ls` | Built-in file operation tools |
| `builtin-bash-tool` | `createBashLocalTool()` + `startBashSession` |
| `builtin-tool-utils` | `shellConfig()` / `resolveExecutable()` / `normalizeToolPath()` / `resolveWorkspacePath()` / `withToolBoundary()` |
| `mcp-tool-provider` | MCP tool provider (stdio / streamable-http / SSE transport) |
| `mcp-tool-search` | BM25 tool search (with Chinese tokenization) |
| `web-tool-provider` | Web search/fetch tool (domain policy + sourceId) |
| `delegation-tool-provider` | Sub-agent delegation tool |
| `memory-tool-provider` | Memory tool |
| `goal-tools` / `todo-tools` / `create-plan-tool` | Goal / todo / plan management tools |

#### Layer 6 — Capability Extensions

> 📦 Detailed technical docs (Chinese): [`./packages/skills.md`](./packages/skills.md) · [`./packages/memory.md`](./packages/memory.md)

**`@qiongqi/skills`** — Skill runtime, plugin host, skill-to-tool bridge.

| Module | Content |
|--------|---------|
| `skill-runtime` | `SkillRuntime` (v1 legacy runtime) |
| `plugin-host` | `SkillPluginHost` (v2 new runtime, manifest migration) |
| `skill-tool-provider` | `buildSkillToolProvider()` |
| `skill-mcp-bridge` | `collectSkillMcpServers()` |
| `skill-command-registry` | `collectCommands()` |
| `manifest` | `SkillManifestV1` + `migrateLegacyManifest()` |
| `marketplace` | `MarketplaceClient` + `parseMarketplaceManifest()` |

**`@qiongqi/memory`** — Cross-session memory storage and context injection.

```typescript
import { MemoryStore } from '@qiongqi/memory'
```

#### Layer 7 — Delegation & Multi-Agent

> 📦 Detailed technical docs (Chinese): [`./packages/delegation-runtime.md`](./packages/delegation-runtime.md) · [`./packages/delegation-registry.md`](./packages/delegation-registry.md)

**`@qiongqi/delegation`** — Sub-agent delegation runtime, concurrency control, peer addressing.

| Module | Content |
|--------|---------|
| `delegation-runtime` | `DelegationRuntime` — delegation runtime |
| `child-agent-executor` | `ChildAgentExecutor` — child agent executor |
| `peer-registry` | `PeerRegistry` + `FilePeerStore` (Stage 2) — agent peer registry |
| `skill-registry` | `SkillRegistry` (Stage 2) — general skill registry |
| `task-thread-map` | `TaskThreadMap` (Stage 2) — task → child-agent thread map |

#### Layer 8 — HTTP Service

> 📦 Detailed technical docs (Chinese): [`./packages/http-transport.md`](./packages/http-transport.md) · [`./packages/http-composition-and-routes.md`](./packages/http-composition-and-routes.md)

**`@qiongqi/http`** — HTTP/SSE server, routing, auth, Composition Root.

| Module | Content |
|--------|---------|
| `runtime-factory` | `createAgent()` / `createHttpServer()` (Stage 1.4 public API) — **Composition Root** |
| `http-server` / `node-http-server` | HTTP server core + Node.js adapter |
| `router` / `routes` | `Router` + `buildRouter()` (full route table in §3.4) |
| `auth` | Bearer token auth middleware |
| `sse` | SSE streaming response (with 15s heartbeat) |
| `review-service` | `ReviewService` — code review service (**migrated from `services`**, breaks value cycle) |
| `http-peer-transport` | `HttpPeerTransport` (Stage 2) — A2A HTTP transport |
| `a2a-task-model` | `A2ATaskRecord` (Stage 4) — A2A task data model |
| `a2a-task-store` | `FileA2ATaskStore` (Stage 4) — A2A task persistence |

#### Layer 9 — CLI

> 📦 Detailed technical docs (Chinese): [`./packages/cli.md`](./packages/cli.md)

**`@qiongqi/cli`** — `qiongqi` CLI entry point.

| Subcommand | Function |
|------------|----------|
| `qiongqi serve [options]` | Start HTTP/SSE runtime (default command) |
| `qiongqi run [options] <prompt>` | Single agent turn, stdout streaming output |
| `qiongqi chat [options]` | TTY interactive mode (`/exit` / `/quit` to exit) |
| `qiongqi exec [options] <tool>` | Direct tool invocation (`--list-tools` / `--args <json>`) |

```bash
qiongqi serve --data-dir ~/.qiongqi/data --base-url "$QIONGQI_BASE_URL" --api-key "$QIONGQI_API_KEY" --port 8899
```

#### Layer 10 — Domain Preset

> 📦 Detailed technical docs (Chinese): [`./packages/preset-coding.md`](./packages/preset-coding.md)

**`@qiongqi/preset-coding`** — Coding preset. Assembles a software engineering Agent: system prompt + default tools + skills.

```typescript
import { createCodingAgent, CODING_SYSTEM_PROMPT, CODING_PINNED_CONSTRAINTS } from '@qiongqi/preset-coding'

const agent = await createCodingAgent({
  dataDir: './data',
  apiKey: process.env.QIONGQI_API_KEY!,
  baseUrl: process.env.QIONGQI_BASE_URL!,
  model: 'provider-model-name',
})
```

`CODING_PINNED_CONSTRAINTS` are byte-stable constraints, deliberately designed to maximize prompt cache hit rate:

- `system: preserve user intent across compaction`
- `system: keep the HTTP/SSE contract stable for clients`
- `system: keep the stable coding-preset prefix byte-stable for prompt-cache reuse`
- `system: never claim a change is verified without running the relevant tests or build`

### 3.4 HTTP Route Table (50 endpoints)

| Path prefix | Main endpoints | Auth |
|-------------|---------------|------|
| `/health` | Liveness probe | none |
| `/ready` | Readiness/degraded check (storage degraded is visible) | none |
| `/.well-known/agent-card.json` | A2A discovery (Stage 2) | none (RFC 8615) |
| `/a2a/tasks` | POST async task creation (Stage 4) | Bearer |
| `/a2a/tasks/:id` | GET query status | Bearer |
| `/a2a/tasks/:id/cancel` | POST cancel | Bearer |
| `/a2a/tasks/:id/artifacts` | GET turn items | Bearer |
| `/a2a/tasks/:id/subscribe` | SSE progress stream | Bearer |
| `/a2a` | Backward-compat alias | Bearer |
| `/v1/runtime/info` / `/v1/runtime/tools` / `/v1/runtime/metrics` | Runtime diagnostics and metrics | Bearer |
| `/v1/skills` | Skills list (v1 + v2 merged) | Bearer |
| `/v1/attachments` | POST upload / GET list / GET diagnostics | Bearer |
| `/v1/memory` | Memory CRUD | Bearer |
| `/v1/workspace/status` | Git/workspace check | Bearer |
| `/v1/threads` | Thread CRUD + Fork + Goal + Todo | Bearer |
| `/v1/threads/:id/turns` | Start / steer / interrupt / compact | Bearer |
| `/v1/threads/:id/events` | SSE event stream (supports `Last-Event-ID` replay) | Bearer |
| `/v1/threads/:id/review` | Start review | Bearer |
| `/v1/approvals/:id` / `/v1/user-inputs/:id` | Gate decisions | Bearer |
| `/v1/sessions/:id/resume-thread` | Session resume | Bearer |
| `/v1/usage` | Usage aggregation (runtime / thread / day / model) | Bearer |

SSE format: `id: <seq>\nevent: <kind>\ndata: <JSON>\n\n`, with 15s heartbeat events.

---

## 4. Key Architectural Decisions

### 4.1 Composition Root: createAgent / createHttpServer

`createAgent()` is the **sole Composition Root** — it takes 30+ config items and assembles the runtime in four steps:

1. `createCore()` — storage, EventBus, Thread / Turn / Usage services
2. `createModelAdapter()` — `ModelCompatClient` + capability config
3. `createToolMatrix()` — tool registry, skills, delegation runtime
4. `createAgent()` — orchestration loop (TurnOrchestrator assembly)

`createHttpServer({ agent, host, port, accessLog?, telemetry? })` attaches HTTP listening on top of the agent and returns a `QiongqiServeHandle`. `accessLog` can be connected to a JSON logger or APM collector; each structured entry contains request id, trace id, method, path, status, and duration, but not sensitive headers such as authorization. When a request includes W3C `traceparent`, the runtime propagates it in response headers and logs `traceparent` / `traceId` / `spanId`. `telemetry` can be created with `createOpenTelemetryRuntime`, which supports OTLP HTTP, console, memory test exporter, and disabled modes; `qiongqi serve` can enable full HTTP server span lifecycle/export through `serve.observability.openTelemetry` or `QIONGQI_OTEL_*` environment variables.

**Design trade-offs**:

- **No DI container / reflection / decorators** — pure constructor DI, dependencies are explicit in code
- **Presets are configuration, not inheritance** — `createCodingAgent` is a specialization of `createQiongqiServeRuntime` (injects systemPrompt + agentName + pinnedConstraints), not a new base class
- **Backward compatible** — `createQiongqiServeRuntime` / `startQiongqiServe` are marked `@deprecated` but still callable; CLI entry unchanged

### 4.2 Circular Dependency Resolution

Qiongqi strictly obeys the "one-way dependency direction" hard constraint, but during implementation two real cycles emerged, both explicitly resolved:

#### Cycle 1: `loop ↔ services`

**Reason**: `loop` needs `TurnService` / `UsageService` / `RuntimeEventRecorder` to write state; `services` needs `ContextCompactor` / `InflightTracker` / `SteeringQueue` to provide capability.

**Solution**:
- `services/src/turn-service.ts` uses `import type` to reference `loop` types
- `loop/src/*.ts` uses `import type` to reference `services` types
- **`review-service.ts` migrated from `services` to `http`** — it's a "sub-service that starts its own Turn", which belongs to the `http` layer in the dependency graph, physically avoiding value reference

#### Cycle 2: `adapter-tools` module init cycle

**Reason**: `local-tool-host.ts` at module level `import`s `buildBuiltinLocalTools()`, but `builtin-tools.ts` imports `builtin-bash-tool.ts`, which imports back to `local-tool-host.ts`.

**Solution**:
- `defaultLocalTools` changed from module-level **constant** to **lazy function** `getDefaultLocalTools()`
- `buildBuiltinLocalTools()` only executes on the first actual call, so the module init phase no longer forms a cycle

### 4.3 PricingProvider Abstraction

The key decoupling from Stage 1.3. **Goal**: decouple the model client from hardcoded DeepSeek pricing tables, so adding a new vendor only requires registering a `PricingProvider`.

- `PricingProvider` interface (`packages/adapter-model/src/pricing/types.ts`): `estimate(input) → CostEstimate | null`
- `DeepseekPricingProvider` implements DeepSeek's official pricing table; non-DeepSeek hosts return `null`
- `CompositePricingProvider` returns the first non-null estimate in registration order
- `ModelCompatClient` accepts a `pricingProvider` via constructor parameter, defaulting to `defaultPricingProvider` (Composite singleton)
- `mapUsage()` uses the injected provider to estimate cost/savings

**Adding a new vendor's pricing**: implement `PricingProvider` and register it with `Composite`; no client modification needed.

### 4.4 OrchestrationMode: classic / evented_v2 / kernel_v3

The runtime now selects `kernel_v3` by default. `classic`, `evented`, and `evented_v2` remain explicit compatibility modes via `QiongqiServeRuntimeOptions.orchestrationMode`; `evented` normalizes to `evented_v2`.

| Mode | Orchestrator | Crash recovery | Use case |
|------|--------------|----------------|----------|
| `kernel_v3` | durable kernel loop with checkpoints and idempotent effects | yes | default production mode |
| `evented_v2` | `EventedTurnOrchestrator` + `LoopRunner`, with `EventedV2MultiAgentRuntime` + `EventedV2OutboxReconciler` for durable run / mailbox / handoff / outbox flush | yes (`LoopRun` / `TurnStateV2` plus multi-agent `run.events` / `outbox` / `trace()`) | multi-Agent graph foundation, handoff, cross-Agent trace |
| `classic` | `TurnOrchestrator` (explicit step advancement) | none | explicit compatibility fallback |
| `evented` | legacy alias normalized to `evented_v2` | same as `evented_v2` | legacy config compatibility |

**Shared policy**: the classic path keeps using `runOrchestratorStep`; the evented path interprets `LoopPlan.phases` through `LoopRunner` (build-prompt → run-model → decide → evaluate → dispatch-tools), publishes rich events such as `prompt:built` / `model:ran` / `decision` / `tools:dispatched` / `step:retry`, and appends them to `LoopRun.events`. `runStepViaEventBus` is retained only as a compatibility API.

**Stage 2 run transaction progress**: `EventedV2MultiAgentRuntime.handoff()` writes handoff events and a `mailbox_enqueue` outbox intent in the same `MultiAgentRunStore.update()` transaction. After the run commit, it publishes the mailbox message and marks the outbox intent as `published`. If a process crashes after run commit and before/after mailbox publish, another runtime instance can call `flushPendingOutbox(runId)` for one run, or use `MultiAgentRunStore.listWithPendingOutbox()` plus `flushAllPendingOutbox()` to discover and recover pending runs in batch. `EventedV2OutboxReconciler` now provides a periodic, stoppable, observable batch flush shell, and the `evented_v2` server runtime can auto-start it through `runtime.eventedV2OutboxReconciler.enabled`.

**P0 completed scope**: `EventedV2AgentWorker` can claim mailbox tasks, run an injected agent handler, submit the agent result, and complete the mailbox message. `EventedV2MultiAgentRuntime.completeAgentTask()` advances the declarative graph by edge condition. The interpreter handles `agent` / `terminate` / `join` / `retry`; `wait` / `tool` / `judge` suspend as external execution nodes and resume through `completeExternalNode()`. The HTTP runtime factory wires reconciler start/stop/isRunning lifecycle from config. This gives `evented_v2` the generic P0 multi-Agent runtime skeleton.

**Real backlog**: cross-instance lease / store-native CAS, timeline and metrics APIs, declarative graph/agent binding config, remote Agent execution, and production shadow/canary rollout remain next. `createPromptSubscriber` is still a placeholder; peer-style orchestration is a future direction (the honest annotation on Proposition ① in §1.2).

### 4.5 AgentCard / PeerRegistry / A2A Protocol

The multi-Agent infrastructure from Stages 2 + 4:

- **`AgentCard`** (`@qiongqi/contracts`) — Agent ID card (id / url / name / version / skills / capabilities / model / endpoints)
- **`PeerRegistry`** (`@qiongqi/delegation`) — Unified local/remote peer entry; `LocalPeerHandle` (in-process) + `RemotePeerTransport` (interface, implemented by `http/HttpPeerTransport`)
- **`FilePeerStore`** — Remote peer persistence to `<dataDir>/peers.json`
- **`GET /.well-known/agent-card.json`** — A2A discovery (no auth, RFC 8615)
- **`HttpPeerTransport`** — HTTP implementation of `RemotePeerTransport`, with token resolution callback; accepts both legacy `PeerArtifact` responses and Stage 4 `{ task, artifact, artifacts }` responses
- **A2A task endpoints** (Stage 4) — `POST /a2a/tasks` creates a task and starts a background turn, returning 202 + task; `GET /a2a/tasks/:id` query; `/cancel` interrupts the associated turn through a runtime hook; `/artifacts` / `/subscribe` SSE

**Cross-instance A2A closed loop**: Agent A can use the compatible `POST /a2a` endpoint for a synchronous `PeerArtifact`, or submit async work via `POST /a2a/tasks` and query/subscribe to its lifecycle; A discovers B's capabilities through B's AgentCard.

### 4.6 Cache-First Three-Layer Contract

Why does Qiongqi treat cache as a first-class citizen?

1. **`ImmutablePrefix`** (`@qiongqi/cache/immutable-prefix.ts`) owns `systemPrompt + tools + pinnedConstraints + fewShots`, with SHA-256 fingerprint + `revision` counter; mutators like `setTools` / `setSystemPrompt` all go through `mutate()` to re-canonicalize and re-fingerprint; `verifyImmutablePrefix()` checks drift in dev mode
2. **`PromptBuilder.build()`** sends `prefix.fewShots` alone as `ModelRequest.prefix`; per-turn dynamic content (skill instructions, memory injection, mode instruction, drift hint) goes into `contextInstructions`, appended after the prefix
3. **Tool catalog drift detection**: `buildToolCatalogFingerprint` fingerprints by `(threadId, workspace, mode, model, activeSkillIds, allowedToolNames)`. **Breaking drift** → automatic stop; **additive drift** → only emit a `tool_catalog_changed` event

**Real-world effect**: `preset-coding`'s `CODING_PINNED_CONSTRAINTS` are 4 byte-stable constraints, ensuring the highest prompt cache hit rate within a workspace across turns.

---

## 5. Roadmap & Status

Four-stage refactor plan, **as of 2026-06-22**:

| Stage | Goal | Status | Key Deliverables |
|-------|------|--------|------------------|
| **Stage 1** | SDK extraction + monorepo split | ✅ **Complete** | 18 packages + pnpm workspace + vitest aliases + Composition Root split + PricingProvider abstraction + CLI required-field validation |
| **Stage 2** | AgentCard + AgentIdentity | ✅ **Complete** | AgentCard / PeerRegistry / SkillRegistry / TaskThreadMap + `GET /.well-known/agent-card.json` + `POST /a2a` + HttpPeerTransport + cross-instance A2A closed loop verification |
| **Stage 3** | TurnOrchestrator event-driven | ✅ **Complete** | LoopPlan / LoopRunner / LoopRun(TurnStateV2) / FileTurnStateStore / EventedTurnOrchestrator / TurnEventBus + end-to-end kill -9 crash recovery verification |
| **Stage 4** | A2A protocol endpoints | 🔄 **Nearly complete** | A2ATaskRecord / FileA2ATaskStore + async `POST /a2a/tasks` + synchronous compatible `POST /a2a` + `GET /a2a/tasks/:id` + interruptible `cancel` + `artifacts` + SSE `subscribe` + ArtifactSchema bridge. **Awaiting external Agent for cross-vendor interop verification** |

**Current verification baseline** (synchronized with `PROGRESS.zh.md`):
- Full test suite: 484/484 ✅
- Fast test suite: 455/455 ✅
- Package build: 18/18 ✅
- End-to-end (local evented A2A): ✅

Detailed history: [`PROGRESS.zh.md`](./PROGRESS.zh.md) / [`PROGRESS.en.md`](./PROGRESS.en.md).

---

## 6. Extension Guide

### 6.1 Adding a New Adapter

Say you want to add a `MyDatabase` storage backend:

1. **Add abstraction in `ports`** (if not yet): `packages/ports/src/my-database-store.ts`
2. **Implement in `adapter-storage`**: `packages/adapter-storage/src/my-database-thread-store.ts` implements the `ThreadStore` interface
3. **Inject in `createCore()`** (`packages/http/src/runtime-factory.ts`): select based on `config.storage.backend === 'my-database'`
4. **Update config schema**: add the new value to `storage.backend` in `packages/contracts/src/qiongqi-config.ts`
5. **Write tests**: `tests/my-database-store.test.ts`

### 6.2 Adding a New Skill

A skill is a subdirectory under `skills/`:

1. **Create the directory**: `skills/my-skill/`
2. **Write the manifest**: `skills/my-skill/skill.json` (`specVersion: "1.0"`, with `id` / `name` / `commands` / `tools.allowed` / `permissions`)
3. **Write the description**: `skills/my-skill/SKILL.md` (injected into the system prompt when the skill is activated)
4. **If MCP is needed**: declare in the `mcpServers` field; `skill-mcp-bridge` automatically collects it
5. **Path injection**: `createAgent({ skillRoots: ['/path/to/skills'] })` or default `skills/`

See the 11 example skills in `skills/` (`code-review` / `debugging` / `goal` / `planning` / `tdd` etc.).

### 6.3 Adding a New Preset

`preset-coding` is the ready-made example of "skeleton + coding flesh". To add a new preset (e.g. `preset-finance`):

1. **Create a new package**: `packages/preset-finance/`
2. **Write `createFinanceAgent(options)`**: `preset-finance/src/index.ts` calls `createQiongqiServeRuntime({...options, agentName: 'Qiongqi Finance', systemPrompt: FINANCE_SYSTEM_PROMPT, pinnedConstraints: FINANCE_PINNED_CONSTRAINTS})`
3. **Define the prompt and constraints**: `preset-finance/src/finance-system-prompt.ts` (with `FINANCE_PINNED_CONSTRAINTS` byte-stable array)
4. **Register the CLI preset**: add `'finance'` to `SERVE_PRESETS` in `packages/cli/src/cli-options.ts`
5. **Add new workflows**: skill + tools in `presets/finance/` (e.g. PDF parsing, compliance checks)

### 6.4 Customizing ModelClient

The engine is decoupled from any specific model through the `ModelClient` port. To add a new vendor:

1. **Implement `ModelClient.stream(request)`**: returns `AsyncIterable<ModelStreamChunk>` with 7 chunk types (`assistant_text_delta` / `assistant_reasoning_delta` / `tool_call_delta` / `tool_call_complete` / `usage` / `completed` / `error`)
2. **Implement `PricingProvider`**: create `<vendor>-pricing.ts` under `packages/adapter-model/src/pricing/`, register with `CompositePricingProvider`
3. **Inject**: `createModelAdapter({ modelClient: new MyClient(...), pricingProvider: Composite([..., myProvider]) })`
4. **SSE format reference**: see `packages/adapter-model/src/model-compat-client.ts` for the three existing implementations (`chat_completions` / `responses` / `messages`)

---

## Appendix A. Complete Dependency Table

```
@qiongqi/contracts           (no dependencies)

@qiongqi/domain
  └─ @qiongqi/contracts

@qiongqi/ports
  ├─ @qiongqi/contracts
  └─ @qiongqi/domain

@qiongqi/cache
  ├─ @qiongqi/contracts
  └─ @qiongqi/ports

@qiongqi/attachments
  └─ @qiongqi/contracts

@qiongqi/adapter-fs
  └─ diff

@qiongqi/tool-infra
  └─ @qiongqi/adapter-fs

@qiongqi/services
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  ├─ @qiongqi/loop          (type-only)
  ├─ @qiongqi/adapter-tools
  ├─ @qiongqi/tool-infra
  └─ @qiongqi/cache

@qiongqi/loop
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  ├─ @qiongqi/cache
  ├─ @qiongqi/services       (type-only)
  ├─ @qiongqi/adapter-tools
  ├─ @qiongqi/adapter-model
  ├─ @qiongqi/attachments
  ├─ @qiongqi/skills
  └─ @qiongqi/memory

@qiongqi/adapter-model
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  └─ @qiongqi/ports

@qiongqi/adapter-storage
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  └─ better-sqlite3

@qiongqi/adapter-tools
  ├─ @qiongqi/adapter-fs
  ├─ @qiongqi/tool-infra
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  ├─ @qiongqi/services
  ├─ @qiongqi/memory
  ├─ @qiongqi/delegation
  ├─ diff
  └─ @modelcontextprotocol/sdk

@qiongqi/skills
  ├─ @qiongqi/contracts
  ├─ @qiongqi/ports
  ├─ @qiongqi/adapter-tools
  └─ zod

@qiongqi/memory
  ├─ @qiongqi/contracts
  └─ @qiongqi/adapter-storage

@qiongqi/delegation
  ├─ @qiongqi/contracts
  ├─ @qiongqi/ports
  ├─ @qiongqi/cache
  ├─ @qiongqi/loop
  ├─ @qiongqi/adapter-storage
  ├─ @qiongqi/memory
  ├─ @qiongqi/skills
  ├─ @qiongqi/services
  └─ zod

@qiongqi/http
  ├─ @qiongqi/contracts
  ├─ @qiongqi/domain
  ├─ @qiongqi/ports
  ├─ @qiongqi/cache
  ├─ @qiongqi/loop
  ├─ @qiongqi/services
  ├─ @qiongqi/adapter-model
  ├─ @qiongqi/adapter-storage
  ├─ @qiongqi/adapter-tools
  ├─ @qiongqi/skills
  ├─ @qiongqi/memory
  ├─ @qiongqi/attachments
  ├─ @qiongqi/delegation
  └─ zod

@qiongqi/cli
  ├─ @qiongqi/http
  ├─ @qiongqi/contracts
  ├─ @qiongqi/adapter-tools
  ├─ @qiongqi/ports
  ├─ @qiongqi/loop
  ├─ @qiongqi/preset-coding
  └─ zod

@qiongqi/preset-coding
  ├─ @qiongqi/http
  ├─ @qiongqi/contracts
  └─ @qiongqi/ports
```

### External Dependency Distribution

| External dependency | Contained in |
|---------------------|--------------|
| `zod` | contracts, skills, delegation, http, cli |
| `better-sqlite3` + `@types/better-sqlite3` | adapter-storage |
| `diff` | adapter-fs, adapter-tools |
| `@modelcontextprotocol/sdk` | adapter-tools |

---

## Appendix B. Build & Test

### Build

```bash
pnpm install
pnpm -r run build           # Build all 18 packages
node scripts/flatten-dist.mjs  # Flatten the dist nested structure
```

Each package has two tsconfigs:
- `tsconfig.json` — development / type-checking, with `paths` mapping pointing to other packages' `src/`
- `tsconfig.build.json` — build, output to `dist/`, flattened by `flatten-dist.mjs`

### Test

```bash
pnpm test                  # Full test suite (65 files, 484 tests)
pnpm test:unit             # Quick unit tests (cache / contracts / domain / ports)
pnpm test:fast             # Quick subset (excluding builtin-tools)
```

Test files are centralized at the root `tests/` directory; the root `vitest.config.ts` manages aliases for all 18 packages.

### End-to-end Verification

```bash
npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --base-url "$QIONGQI_BASE_URL" \
  --api-key "$QIONGQI_API_KEY" \
  --port 8899

curl http://127.0.0.1:8899/health
# → {"status":"ok","service":"qiongqi","mode":"serve"}
```

`hybrid` is the recommended production storage mode (SQLite index + full JSONL log). Run `pnpm run prepare:sqlite && pnpm run verify:sqlite` in CI or production image builds to compile `better-sqlite3` for the current Node ABI and run both in-memory and temporary file-backed probes. This catches missing native bindings, Node ABI mismatches, or missing platform packages early. If the binding is unavailable, Qiongqi can fall back to JSONL, but the SQLite index performance path is not exercised.

Production probes and metrics:

```bash
curl http://127.0.0.1:8899/health
curl http://127.0.0.1:8899/ready
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  http://127.0.0.1:8899/v1/runtime/metrics
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  -H "Accept: text/plain" \
  "http://127.0.0.1:8899/v1/runtime/metrics?format=prometheus"
```

`/health` is suitable for liveness; `/ready` is suitable for readiness and returns `status=degraded` when hybrid SQLite falls back; the Prometheus text endpoint exports token/cache, A2A task status, and storage degraded state.

Evented orchestrator + two-instance A2A verification:

```bash
pnpm -r run build
node scripts/flatten-dist.mjs
pnpm run verify:evented-a2a
```

`verify:evented-a2a` starts a local OpenAI-compatible fake model and two evented Qiongqi HTTP runtimes by default. It verifies AgentCard discovery, async `POST /a2a/tasks`, polling to task completion, artifacts, SSE subscribe, and evented turn-state cleanup after completion. Real external interoperability is explicit opt-in:

```bash
QIONGQI_A2A_PEER_URL="https://peer.example.com" \
QIONGQI_A2A_PEER_TOKEN="$TOKEN" \
pnpm run verify:evented-a2a -- --external-peer
```

When no external peer is configured, the script reports external peer verification as skipped rather than passed.

### Key Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `flatten-dist.mjs` | Flatten the nested `dist/` structure |
| `transcript-diff.mjs` | Compare usage metrics between two threads (cache hit rate, token savings) |
| `verify-crash-recovery.mjs` | Stage 3 end-to-end: simulate crash + EventedTurnOrchestrator recovery |
| `verify-evented-a2a.mjs` | Stage 3/4 end-to-end: local two-instance evented orchestrator + A2A task lifecycle verification, optional external peer |

---

## Appendix C. Related Documents

| Document | Content |
|----------|---------|
| [`README.md`](../README.md) / [`README.zh.md`](../README.zh.md) / [`README.en.md`](../README.en.md) | Project entry, installation, quick start, philosophical prologue |
| [`PROGRESS.zh.md`](./PROGRESS.zh.md) / [`PROGRESS.en.md`](./PROGRESS.en.md) | Detailed changelog of the four-stage refactor (1.1–4.x) |
| [`config.example.json`](../config.example.json) | Runtime configuration example (117 lines) |
| [`skills/`](../skills/) | 11 built-in skills (`code-review` / `debugging` / `goal` / `planning` / `tdd` etc.) |
| Per-package `src/` + JSDoc | Per-package source code and API details |

---

<p align="center">
  <sub>Qiongqi is not evil — it is the edge that breaks the impasse · Built with ❤️ for the Agent era</sub>
</p>
