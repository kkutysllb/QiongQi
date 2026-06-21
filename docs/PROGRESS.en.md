# Qiongqi Refactoring Progress

> This file tracks the completion status of all tasks according to the
> **Four-Stage Architecture Refactoring Plan**.
> It must be updated whenever a milestone or significant change is completed.
>
> 中文版本：[`PROGRESS.zh.md`](./PROGRESS.zh.md)

**Last Updated**: 2026-06-21
**Current Stage**: Stage 1 in progress (1.1–1.2 complete, 1.3–1.8 pending)

---

## Overall Verification Baseline

| Metric | Current | Target |
|--------|---------|--------|
| Full test suite | 433/433 ✅ | All green |
| Package builds | 16/16 ✅ | All green |
| End-to-end (serve + curl) | ✅ | Pass |

---

## Stage 1: SDK Extraction + Monorepo Split

### 1.1 Initialize Monorepo Skeleton ✅

- [x] `pnpm-workspace.yaml` configured with `packages: ['packages/*']` (legacy `qiongqi/` directory cleaned up and deleted)
- [x] Root `package.json` with vitest devDeps and test scripts
- [x] Root-level `vitest.config.ts` with `@qiongqi/*` alias mapping
- [x] Per-package `tsconfig.json` + `tsconfig.build.json` with paths mapping
- [x] `scripts/flatten-dist.mjs` post-build script (flattens nested dist output)

### 1.2 Package Split (16 packages) ✅

175 source files + 5 CLI files migrated, all imports rewritten to `@qiongqi/*` format.

| Package | Responsibility | Build | Status |
|---------|---------------|-------|--------|
| `@qiongqi/contracts` | Zod schemas + types (zero-dependency base layer) | ✅ | Done |
| `@qiongqi/domain` | Thread/Turn/Item/Event entities | ✅ | Done |
| `@qiongqi/ports` | ModelClient/ToolHost/Stores interfaces | ✅ | Done |
| `@qiongqi/cache` | LRU/TTL/ImmutablePrefix | ✅ | Done |
| `@qiongqi/loop` | TurnOrchestrator/PromptBuilder/Policy | ✅ | Done |
| `@qiongqi/services` | Thread/Turn/Usage/Review services | ✅ | Done |
| `@qiongqi/adapter-model` | ModelCompatClient | ✅ | Done |
| `@qiongqi/adapter-tools` | bash/read/edit/grep + MCP provider | ✅ | Done |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite storage | ✅ | Done |
| `@qiongqi/skills` | SkillRuntime + PluginHost | ✅ | Done |
| `@qiongqi/memory` | MemoryStore + provider | ✅ | Done |
| `@qiongqi/attachments` | AttachmentStore | ✅ | Done |
| `@qiongqi/delegation` | DelegationRuntime + ChildExecutor | ✅ | Done |
| `@qiongqi/http` | HTTP/SSE server + routes | ✅ | Done |
| `@qiongqi/cli` | qiongqi CLI entry point | ✅ | Done |
| `@qiongqi/preset-coding` | Coding preset (system prompt + default config) | ✅ | Done |

**Key Technical Decisions**:
- `shared`/`prompt`/`config` → merged into `contracts`
- `telemetry` → merged into `cache`
- `review` → merged into `loop`
- `review-service.ts` moved from `services` to `http` (breaks loop↔services value cycle)
- `defaultLocalTools` changed to lazy function `getDefaultLocalTools()` (breaks adapter-tools circular init)

### 1.3 Key Refactoring Points ⏳

- [ ] System prompt parameterization (`createAgent({ systemPrompt })`)
- [ ] Model client rename (`ModelCompatClient`)
- [ ] Skills path decoupling (`createAgent({ skillRoots })`)
- [ ] Composition Root split (`createCore()` / `createModelAdapter()` / `createToolMatrix()` / `createAgent()`)

### 1.4 New API Shape ⏳

- [ ] `createAgent` / `createHttpServer` public API implementation
- [ ] JSDoc documentation

### 1.5 CLI Entry Rewrite ⏳

- [ ] `qiongqi serve` defaults to `createCodingAgent` (preset-coding assembly)

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

### 1.8 Deliverables ⏳

- [x] 16 independent npm packages, each with `package.json` + `tsconfig.json`
- [ ] `createAgent` / `createHttpServer` public API docs (JSDoc)
- [x] preset-coding package verified
- [x] Full test suite + end-to-end verification passed

---

## Stage 2: AgentCard + AgentIdentity (Not Started)

- [ ] `AgentCardSchema` contract definition
- [ ] `PeerRegistry` implementation (local + remote peers)
- [ ] `GET /.well-known/agent-card.json` endpoint
- [ ] DelegationRuntime refactoring (child agent persistence)
- [ ] Cross-instance invocation end-to-end verification

---

## Stage 3: TurnOrchestrator Event-Driven (Not Started)

- [ ] `TurnStateGraph` (inspired by LangGraph)
- [ ] Event bus refactoring
- [ ] Crash recovery (durable state)
- [ ] Gradual rollout strategy (A/B comparison)
- [ ] End-to-end recovery verification

---

## Stage 4: A2A Protocol Endpoint (Not Started)

- [ ] A2A endpoint implementation (`/a2a`)
- [ ] `A2APeerAdapter`
- [ ] Artifact bridging
- [ ] End-to-end cross-instance collaboration verification
