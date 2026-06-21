# Qiongqi Refactoring Progress

> This file tracks the completion status of all tasks according to the
> **Four-Stage Architecture Refactoring Plan**.
> It must be updated whenever a milestone or significant change is completed.
>
> 中文版本：[`PROGRESS.zh.md`](./PROGRESS.zh.md)

**Last Updated**: 2026-06-21
**Current Stage**: Stage 1 in progress (1.1–1.3 complete, 1.4–1.8 pending)

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
