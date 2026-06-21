# Qiongqi Architecture Overview

> This document describes the overall architecture, layered design, and core
> data flow of the Qiongqi multi-agent framework.
>
> 中文版本：[`architecture-overview.zh.md`](./architecture-overview.zh.md)

---

## 1. Design Philosophy

Qiongqi is a **domain-neutral, independent multi-agent framework** with these
core principles:

- **Skeleton constant, flesh mutable** — The engine layer (Loop, Ports,
  Adapters) is strictly separated from the domain layer (Skills, Presets).
- **Cache-first orchestration** — Immutable prefix + bounded TTL/LRU cache to
  maximize prompt cache hit rate.
- **Decentralized** — No central scheduling oligarch; each Agent is an
  end-to-end independent closed loop.
- **Composable** — Monorepo multi-package structure for assembling capability
  matrices on demand.

---

## 2. Monorepo Package Structure (16 packages)

```
┌─────────────────────────────────────────────────────────┐
│                    preset-coding                         │
│     (Coding preset: system prompt + default tools +     │
│      skills)                                            │
├─────────────────────────────────────────────────────────┤
│  cli ← http ← delegation ← {skills, memory, attachments} │
│                    ↓                                     │
│         {adapter-model, adapter-tools, adapter-storage}  │
│                    ↓                                     │
│              {loop, services}                            │
│                    ↓                                     │
│              cache ← ports ← domain ← contracts          │
└─────────────────────────────────────────────────────────┘
```

Dependencies flow strictly one way:
`contracts ← domain ← ports ← {cache, loop, services} ← adapters ← {skills, memory, attachments, delegation} ← http ← cli ← preset-coding`

---

## 3. Layered Architecture

### 3.1 Contracts Layer (`@qiongqi/contracts`)

Zero-dependency base layer defining Zod schemas and TypeScript types for all
HTTP/SSE interfaces:

- Thread / Turn / Item data structures
- Event types (`RuntimeEvent`)
- Capability declarations (`RuntimeCapabilityManifest`)
- Approval / user input / tool call contracts
- Usage snapshots (`UsageSnapshot`)

### 3.2 Domain Layer (`@qiongqi/domain`)

Pure domain entities and value objects with no I/O logic:

- `Thread` — conversation thread
- `Turn` — single inference round
- `Item` — messages, tool calls, tool results, etc.
- `Event` — runtime events
- `Approval` — approval requests
- `Usage` — token usage aggregation

### 3.3 Ports Layer (`@qiongqi/ports`)

Abstract interfaces for all external dependencies (Hexagonal Architecture ports):

- `ModelClient` — model inference client
- `ToolHost` — tool execution host
- `ThreadStore` / `SessionStore` — persistent storage
- `EventBus` — event bus
- `ApprovalGate` / `UserInputGate` — human-in-the-loop gates
- `WorkspaceInspector` — workspace info queries

### 3.4 Infrastructure Layer

| Package | Responsibility |
|---------|---------------|
| `@qiongqi/cache` | LRU/TTL cache, immutable prefix, tool fingerprinting, telemetry |
| `@qiongqi/loop` | TurnOrchestrator, PromptBuilder, ContinuationPolicy, ToolCallCoordinator |
| `@qiongqi/services` | ThreadService, TurnService, UsageService, RuntimeEventRecorder |

### 3.5 Adapter Layer

| Package | Responsibility |
|---------|---------------|
| `@qiongqi/adapter-model` | ModelCompatClient (OpenAI-compatible API client) |
| `@qiongqi/adapter-tools` | Built-in tools (bash/read/edit/grep/find/ls/write) + MCP provider + local tool host |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite storage implementations, in-memory adapters (EventBus/Stores/Gates) |

### 3.6 Capability Extension Layer

| Package | Responsibility |
|---------|---------------|
| `@qiongqi/skills` | Skill runtime, PluginHost, skill-tool bridge, Marketplace client |
| `@qiongqi/memory` | Cross-session memory storage, context injection |
| `@qiongqi/attachments` | Attachment management, image binary stripping |
| `@qiongqi/delegation` | Child agent delegation runtime, concurrency control |

### 3.7 Application Layer

| Package | Responsibility |
|---------|---------------|
| `@qiongqi/http` | HTTP/SSE server, routing, auth, runtime factory |
| `@qiongqi/cli` | `qiongqi` CLI entry point (serve / run / chat / exec) |
| `@qiongqi/preset-coding` | Coding preset (system prompt + default tools + skill mounting) |

---

## 4. Core Data Flow

### 4.1 Complete Turn Flow

```
HTTP POST /v1/threads/{id}/turns/start
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ TurnService │ ──→ │   Turn       │ ──→ │  PromptBuilder  │
│   .start()  │     │ Orchestrator │     │ (cache prefix)  │
└─────────────┘     └──────┬───────┘     └────────┬────────┘
                           │                      │
                           ▼                      ▼
                    ┌──────────────┐     ┌─────────────────┐
                    │ ModelStep    │ ←── │  ModelClient    │
                    │ Runner       │     │  (adapter-model)│
                    └──────┬───────┘     └─────────────────┘
                           │
                    ┌──────▼───────┐
                    │ Continuation │
                    │ Policy       │
                    └──────┬───────┘
                           │ (has tool calls?)
                    ┌──────▼───────┐
                    │ ToolCall     │ ──→ ToolHost (adapter-tools)
                    │ Coordinator  │ ──→ MCP / Skills / Delegation
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Context      │ ←── Cache (immutable prefix)
                    │ Compactor    │
                    └──────────────┘
                           │
                    (loop until stop)
                           │
                    ┌──────▼───────┐
                    │ SSE Stream   │ ──→ Client
                    └──────────────┘
```

### 4.2 Storage Architecture

```
ThreadStore (metadata)        SessionStore (event log)
    │                              │
    ├── InMemoryThreadStore        ├── InMemorySessionStore
    ├── FileThreadStore            ├── FileSessionStore (JSONL)
    └── HybridThreadStore          └── HybridSessionStore
         (SQLite index +                  (SQLite index +
          JSONL fallback)                  JSONL fallback)
```

---

## 5. Build System

### 5.1 TypeScript Configuration Strategy

Each package has two tsconfig files:

- `tsconfig.json` — Development/type checking, includes `paths` mapping to
  other packages' `src/`.
- `tsconfig.build.json` — Build, outputs to `dist/`. After build,
  `scripts/flatten-dist.mjs` flattens the nested structure.

### 5.2 Test Configuration

- Root-level `vitest.config.ts` centrally manages all package alias mappings.
- Test files are centralized in the root `tests/` directory.
- `qiongqi/**` legacy directory is excluded to prevent duplicate runs.

### 5.3 Layered Test Scripts

```bash
pnpm test:unit        # Fast unit tests (no I/O)
pnpm test:integration # Integration tests (with storage/HTTP)
pnpm test:fast        # Fast subset (for CI)
```

---

## 6. Four-Stage Refactoring Roadmap

| Stage | Goal | Status |
|-------|------|--------|
| **Stage 1** | SDK extraction + monorepo split | In progress (1.1-1.2 complete) |
| **Stage 2** | AgentCard + AgentIdentity | Not started |
| **Stage 3** | TurnOrchestrator event-driven | Not started |
| **Stage 4** | A2A protocol endpoint | Not started |

Detailed progress: [`PROGRESS.en.md`](./PROGRESS.en.md).

---

## 7. Related Documents

| Document | Content |
|----------|---------|
| [Package Dependencies](./package-dependencies.en.md) | Exact dependency relationships of 16 packages |
| [Package Guide](./packages.en.md) | Detailed API and usage for each package |
| [Refactoring Progress](./PROGRESS.en.md) | Completion status of the four-stage plan |
