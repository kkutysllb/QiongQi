# Qiongqi Package Guide

> This document details the responsibility, core exports, and usage of each
> `@qiongqi/*` package.
>
> 中文版本：[`packages.zh.md`](./packages.zh.md)

---

## @qiongqi/contracts

**Responsibility**: Zero-dependency base layer defining Zod schemas and
TypeScript types for all HTTP/SSE interfaces.

**Core Exports**:

| Module | Content |
|--------|---------|
| `approvals` | Approval request/decision schemas |
| `attachments` | Attachment upload/download contracts |
| `capabilities` | Runtime capability manifest (`RuntimeCapabilityManifest`) |
| `events` | Runtime event types (`RuntimeEvent`) |
| `items` | Message/tool call/tool result items |
| `memory` | Memory entry schemas |
| `policy` | Approval policy enums |
| `review` | Code review contracts |
| `threads` | Thread schemas (create/update/list) |
| `turns` | Turn schemas (start/status) |
| `usage` | Token usage snapshots (`UsageSnapshot`) |
| `qiongqi-config` | Runtime configuration schema |
| `qiongqi-system-prompt` | Default system prompt |
| `secret-redaction` | Secret redaction utilities |

```typescript
import { ThreadSchema, TurnSchema, UsageSnapshotSchema } from '@qiongqi/contracts'
```

---

## @qiongqi/domain

**Responsibility**: Pure domain entities and value objects with no I/O logic.

**Core Exports**:

| Module | Content |
|--------|---------|
| `thread` | `createThreadRecord()` — thread record factory |
| `turn` | Turn state machine |
| `item` | Item type guards and constructors (`makeToolResultItem`, `makeApprovalItem`) |
| `event` | Event types and seq management |
| `approval` | `createApprovalRequest()` |
| `usage` | Token aggregation logic |
| `runtime-event-reducer` | Event reducer (events → state snapshot) |
| `model-history-repair` | Model history repair (malformed message correction) |

```typescript
import { createThreadRecord, makeToolResultItem } from '@qiongqi/domain'
```

---

## @qiongqi/ports

**Responsibility**: Hexagonal Architecture port definitions — abstract
interfaces for all external dependencies.

**Core Exports**:

| Module | Interface | Purpose |
|--------|-----------|---------|
| `model-client` | `ModelClient` | Model inference client |
| `tool-host` | `ToolHost`, `ToolHostContext` | Tool execution host |
| `thread-store` | `ThreadStore` | Thread persistence |
| `session-store` | `SessionStore` | Session event log |
| `event-bus` | `EventBus` | Event bus (pub/sub/replay) |
| `approval-gate` | `ApprovalGate` | Approval gate |
| `user-input-gate` | `UserInputGate` | User input gate |
| `workspace-inspector` | `WorkspaceInspector` | Workspace info queries |
| `web-provider` | `WebProvider` | Web search/fetch interface |
| `clock` | `Clock` | Time abstraction (injectable for testing) |
| `id-generator` | `IdGenerator` | ID generator |

```typescript
import type { ModelClient, ToolHost, ThreadStore } from '@qiongqi/ports'
```

---

## @qiongqi/cache

**Responsibility**: Cache infrastructure, immutable prefix, tool
fingerprinting, telemetry metrics.

**Core Exports**:

| Module | Content |
|--------|---------|
| `immutable-prefix` | `createImmutablePrefix()` — prompt cache prefix management |
| `lru-cache` | `LRUCache` — basic LRU cache |
| `ttl-lru-cache` | `TTLCache` — TTL + LRU dual-strategy cache |
| `prefix-volatility` | Prefix volatility analysis (which tokens are unstable) |
| `tool-catalog-fingerprint` | Tool catalog fingerprinting (detect schema changes) |
| `cache-telemetry` | Cache hit rate metrics |
| `usage-counter` | Token usage counter |

---

## @qiongqi/loop

**Responsibility**: Agent Loop core — turn orchestration, prompt building,
continuation decisions, tool coordination.

**Core Exports**:

| Module | Content |
|--------|---------|
| `turn-orchestrator` | `TurnOrchestrator` — turn orchestrator (central loop) |
| `prompt-builder` | `PromptBuilder` — prompt assembly (system/context/tools/history) |
| `model-step-runner` | `ModelStepRunner` — model inference step executor |
| `continuation-policy` | `ContinuationPolicy` — stop/continue/fail/plan decisions |
| `tool-call-coordinator` | `ToolCallCoordinator` — tool call dispatch and concurrency |
| `context-compactor` | `ContextCompactor` — context compaction (soft/hard thresholds) |
| `token-economy` | Token economy (tool description/result compression) |
| `tool-storm-breaker` | Tool storm suppression (prevent repeated calls in same turn) |
| `inflight-tracker` | `InflightTracker` — inflight tool call tracking |
| `steering-queue` | `SteeringQueue` — runtime steering message queue |
| `auto-model-router` | Auto model routing (select model based on task) |

---

## @qiongqi/services

**Responsibility**: Application service layer — business logic for
threads/turns/usage.

**Core Exports**:

| Module | Content |
|--------|---------|
| `thread-service` | `ThreadService` — thread CRUD + Fork/Side |
| `turn-service` | `TurnService` — turn start/status management |
| `usage-service` | `UsageService` — token usage aggregation and queries |
| `runtime-event-recorder` | `RuntimeEventRecorder` — runtime event recorder |

---

## @qiongqi/adapter-model

**Responsibility**: Model client adapter (OpenAI-compatible API).

**Core Exports**:

| Module | Content |
|--------|---------|
| `model-compat-client` | `ModelCompatClient` — OpenAI-compatible model client |
| `pricing/` | PricingProvider abstraction (DeepseekPricingProvider + CompositePricingProvider) |
| `model-error-probe` | Model error probing (retry strategy classification) |
| `tool-argument-repair` | Tool argument repair (JSON malformation correction) |

---

## @qiongqi/adapter-storage

**Responsibility**: Storage adapter implementations + in-memory adapters.

**Core Exports**:

| Module | Content |
|--------|---------|
| `file-thread-store` | `FileThreadStore` — JSON file thread storage |
| `file-session-store` | `FileSessionStore` — JSONL append-only event log |
| `hybrid-thread-store` | `HybridThreadStore` — SQLite index + JSONL |
| `hybrid-session-store` | `HybridSessionStore` — SQLite + JSONL hybrid |
| `in-memory-thread-store` | `InMemoryThreadStore` — in-memory implementation (for testing) |
| `in-memory-session-store` | `InMemorySessionStore` — in-memory implementation |
| `in-memory-event-bus` | `InMemoryEventBus` — in-memory event bus |
| `in-memory-approval-gate` | `InMemoryApprovalGate` — in-memory approval gate |
| `in-memory-user-input-gate` | `InMemoryUserInputGate` — in-memory user input gate |
| `local-workspace-inspector` | `LocalWorkspaceInspector` — local workspace inspector |
| `atomic-write` | `atomicWriteFile()` — atomic file write |

---

## @qiongqi/adapter-tools

**Responsibility**: Built-in tool implementations + MCP provider + local tool
host.

**Core Exports**:

| Module | Content |
|--------|---------|
| `local-tool-host` | `LocalToolHost` — tool execution host implementation |
| `capability-registry` | `CapabilityRegistry` — tool capability registry |
| `builtin-tools` | `buildBuiltinLocalTools()`, `createTool()` — tool factories |
| `bash` | Bash tool implementation |
| `read` / `edit` / `write` / `grep` / `find` / `ls` | File operation tools |
| `builtin-bash-tool` | `createBashLocalTool()` |
| `builtin-tool-utils` | `shellConfig()`, `resolveExecutable()`, `normalizeToolPath()`, etc. |
| `mcp-tool-provider` | MCP tool provider (stdio/streamable-http/SSE) |
| `mcp-tool-search` | BM25 tool search |
| `web-tool-provider` | Web search/fetch tool |
| `delegation-tool-provider` | Child agent delegation tool |
| `memory-tool-provider` | Memory tool |
| `goal-tools` / `todo-tools` | Goal/todo management tools |
| `create-plan-tool` | Plan materialization tool |

---

## @qiongqi/skills

**Responsibility**: Skill runtime, plugin host, skill-tool bridge.

**Core Exports**:

| Module | Content |
|--------|---------|
| `skill-runtime` | `SkillRuntime` — skill runtime core |
| `plugin-host` | `SkillPluginHost` — skill plugin host |
| `skill-tool-provider` | `buildSkillToolProvider()` — skill tool bridge |
| `skill-mcp-bridge` | `collectSkillMcpServers()` — skill MCP server collection |
| `skill-command-registry` | `collectCommands()` — command registry |
| `manifest` | `SkillManifestV1`, `migrateLegacyManifest()` |
| `marketplace` | `MarketplaceClient`, `parseMarketplaceManifest()` |

---

## @qiongqi/memory

**Responsibility**: Cross-session memory storage and context injection.

```typescript
import { MemoryStore } from '@qiongqi/memory'
```

---

## @qiongqi/attachments

**Responsibility**: Attachment management, image binary stripping.

```typescript
import { AttachmentStore } from '@qiongqi/attachments'
```

---

## @qiongqi/delegation

**Responsibility**: Child agent delegation runtime, concurrency control.

**Core Exports**:

| Module | Content |
|--------|---------|
| `delegation-runtime` | `DelegationRuntime` — delegation runtime |
| `child-agent-executor` | `ChildAgentExecutor` — child agent executor |
| `peer-registry` | `PeerRegistry` + `FilePeerStore` — agent peer registry (Stage 2) |

---

## @qiongqi/http

**Responsibility**: HTTP/SSE server, routing, auth, runtime factory.

**Core Exports**:

| Module | Content |
|--------|---------|
| `runtime-factory` | `createAgent()` / `createHttpServer()` — Composition Root (Stage 1.4) |
| `http-server` | HTTP server core |
| `node-http-server` | Node.js HTTP server adapter |
| `router` | `Router` — router |
| `routes` | `buildRouter()` — full route builder |
| `auth` | Bearer token auth middleware |
| `sse` | SSE streaming response |
| `review-service` | `ReviewService` — code review service |
| `http-peer-transport` | `HttpPeerTransport` — A2A HTTP transport (Stage 2) |
| `a2a-task-model` | `A2ATaskRecord` — A2A task data model (Stage 4) |
| `a2a-task-store` | `FileA2ATaskStore` — A2A task persistence (Stage 4) |

---

## @qiongqi/cli

**Responsibility**: `qiongqi` CLI entry point.

**Core Exports**:

| Module | Content |
|--------|---------|
| `serve` | `qiongqi serve` — start HTTP server |
| `agent-cli` | `qiongqi run` / `chat` / `exec` — interactive agent |
| `cli-options` | CLI argument parsing |

```bash
qiongqi serve --data-dir ~/.qiongqi/data --api-key $KEY --port 8899
```

---

## @qiongqi/preset-coding

**Responsibility**: Coding preset — assembles a software engineering agent
(system prompt + default tools + skill mounting).

```typescript
// Target API after Stage 1.4 completion (partially implemented)
import { createCodingAgent } from '@qiongqi/preset-coding'

const agent = await createCodingAgent({
  dataDir: './data',
  apiKey: process.env.API_KEY,
})
```

---

## Related Documents

| Document | Content |
|----------|---------|
| [Architecture Overview](./architecture-overview.en.md) | Layered design and core data flow |
| [Package Dependencies](./package-dependencies.en.md) | Exact dependency relationships of 16 packages |
