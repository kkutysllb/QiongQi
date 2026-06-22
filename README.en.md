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
  <a href="./docs/PROGRESS.en.md">Progress</a>
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

### Start the Runtime

```bash
npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --api-key "$DEEPSEEK_API_KEY" \
  --port 8899
```

After startup, the HTTP API is available at `http://127.0.0.1:8899`.

### Script Reference

```bash
pnpm -r run build          # Build all 18 packages
pnpm test                  # Full test suite (Vitest)
pnpm test:unit             # Unit tests
pnpm test:integration      # Integration tests
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
│  TurnOrchestrator · PromptBuilder · Policy       │
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
└───────────────────────────────────────────────────┘
```

> Detailed architecture: [`docs/architecture.en.md`](./docs/architecture.en.md)

---

## 📦 Monorepo Package Structure

Qiongqi uses a pnpm monorepo structure with 16 independent npm packages:

| Package | Responsibility |
|---------|---------------|
| `@qiongqi/contracts` | Zod schemas + types (zero-dependency base layer) |
| `@qiongqi/domain` | Thread/Turn/Item/Event entities |
| `@qiongqi/ports` | ModelClient/ToolHost/Stores interfaces |
| `@qiongqi/cache` | LRU/TTL cache, immutable prefix |
| `@qiongqi/loop` | TurnOrchestrator/PromptBuilder/Policy |
| `@qiongqi/services` | Thread/Turn/Usage services |
| `@qiongqi/adapter-model` | OpenAI-compatible model client |
| `@qiongqi/adapter-tools` | bash/read/edit/grep + MCP provider |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite storage |
| `@qiongqi/skills` | SkillRuntime + PluginHost |
| `@qiongqi/memory` | Cross-session memory storage |
| `@qiongqi/attachments` | Attachment management |
| `@qiongqi/delegation` | Child agent delegation runtime |
| `@qiongqi/http` | HTTP/SSE server |
| `@qiongqi/cli` | CLI entry point |
| `@qiongqi/preset-coding` | Coding preset |

> Full dependency graph: [`docs/architecture.en.md#appendix-a-complete-dependency-table`](./docs/architecture.en.md)
> Package details: [`docs/architecture.en.md#3-package-structure`](./docs/architecture.en.md)

---

## ✨ Features

### 🔧 Agent Loop
- **Cache-first orchestration**: Immutable prompt prefix + TTL/LRU cache + inflight tracking
- **Context compaction**: Soft/hard threshold-triggered summarization
- **Token economy**: Compress tool descriptions and results
- **Tool Storm Breaker**: Suppress repeated tool calls within the same turn
- **Continuation Policy**: Intelligent stop/continue/fail decisions

### 🔌 Capability Matrix
- **MCP client**: stdio / streamable-http / SSE transports, BM25 tool search
- **Skills system**: Plugin-based capability injection via `skill.json` / `SKILL.md`
- **Subagent delegation**: Hierarchical agent calls with concurrency control
- **Memory system**: Cross-session persistence, scope-based retrieval
- **Attachment management**: Image binary stripping, dual-channel visual/text processing

### 🌐 Server
- **HTTP/SSE API**: Complete `/v1/*` RESTful routes
- **Runtime diagnostics**: Capability manifest and tool diagnostics
- **Thread management**: Create, fork, side threads, event replay
- **Approval gating**: Multiple policy support

---

## 📁 Project Structure

```
.
├── assets/
│   └── qiongqi.png               # Project cover image
├── docs/                          # Technical docs (bilingual)
│   ├── PROGRESS.zh.md            # Progress (Chinese)
│   ├── PROGRESS.en.md            # Progress (English)
│   └── architecture.{zh,en}.md   # Unified architecture (design philosophy + tech architecture + package tour)
├── packages/                      # 18 @qiongqi/* packages
│   ├── contracts/
│   ├── domain/
│   ├── ports/
│   ├── cache/
│   ├── loop/
│   ├── services/
│   ├── adapter-model/
│   ├── adapter-tools/
│   ├── adapter-storage/
│   ├── skills/
│   ├── memory/
│   ├── attachments/
│   ├── delegation/
│   ├── http/
│   ├── cli/
│   └── preset-coding/
├── tests/                         # Full test suite (53 files, 433 tests)
├── scripts/                       # Migration and build helper scripts
├── pnpm-workspace.yaml
├── vitest.config.ts
└── package.json
```

---

## 📚 Related Documents

| Document | Location |
|----------|----------|
| **Refactoring Progress** | [`docs/PROGRESS.en.md`](./docs/PROGRESS.en.md) |
| **Architecture Overview** | [`docs/architecture.en.md`](./docs/architecture.en.md) |
| **Package Dependencies** | [`docs/architecture.en.md#appendix-a-complete-dependency-table`](./docs/architecture.en.md) |
| **Package Guide** | [`docs/architecture.en.md#3-package-structure`](./docs/architecture.en.md) |
| **Design Specs** | [`docs/superpowers/specs/`](./docs/superpowers/specs/) |
| **Chinese README** | [`README.zh.md`](./README.zh.md) |

---

## 🗺️ Roadmap

Qiongqi is undergoing a four-stage architecture refactoring, currently in
Stage 1:

| Stage | Goal | Status |
|-------|------|--------|
| **Stage 1** | SDK extraction + monorepo split | In progress |
| **Stage 2** | AgentCard + AgentIdentity | Not started |
| **Stage 3** | TurnOrchestrator event-driven | Not started |
| **Stage 4** | A2A protocol endpoint | Not started |

Detailed progress: [`docs/PROGRESS.en.md`](./docs/PROGRESS.en.md).

---

<p align="center">
  <sub>Built with ❤️ for the Agent era</sub>
</p>
