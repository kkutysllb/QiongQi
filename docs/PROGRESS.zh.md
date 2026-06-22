# Qiongqi 改造进度

> 本文件根据 **四阶段架构改造计划** 追踪所有任务的完成状态。
> 每次完成里程碑或重要变更后必须同步更新。
>
> English version: [`PROGRESS.en.md`](./PROGRESS.en.md)

**最后更新**：2026-06-21
**当前阶段**：阶段 1 进行中（1.1–1.3 已完成，1.4–1.8 待办）

---

## 总体验证基线

| 指标 | 当前值 | 目标 |
|------|--------|------|
| 全量测试 | 433/433 ✅ | 全绿 |
| 包构建 | 16/16 ✅ | 全绿 |
| 端到端（serve + curl） | ✅ | 通过 |

---

## 阶段 1：SDK 抽离 + monorepo 拆包

### 1.1 初始化 monorepo 骨架 ✅

- [x] `pnpm-workspace.yaml` 配置 `packages: ['packages/*']`（旧 `qiongqi/` 已清理删除）
- [x] 根 `package.json` 添加 vitest devDeps 和测试脚本
- [x] 根级 `vitest.config.ts` 配置 `@qiongqi/*` alias 映射
- [x] 各包 `tsconfig.json` + `tsconfig.build.json` 配置 paths 映射
- [x] `scripts/flatten-dist.mjs` 后处理脚本（拍平嵌套 dist 输出）

### 1.2 包划分（16 个包）✅

175 个源文件 + 5 个 CLI 文件迁移完成，全部 import 重写为 `@qiongqi/*` 格式。

| 包名 | 职责 | 构建 | 状态 |
|------|------|------|------|
| `@qiongqi/contracts` | Zod schema + 类型（零依赖基础层） | ✅ | 完成 |
| `@qiongqi/domain` | Thread/Turn/Item/Event 实体 | ✅ | 完成 |
| `@qiongqi/ports` | ModelClient/ToolHost/Stores 接口 | ✅ | 完成 |
| `@qiongqi/cache` | LRU/TTL/ImmutablePrefix | ✅ | 完成 |
| `@qiongqi/loop` | TurnOrchestrator/PromptBuilder/Policy | ✅ | 完成 |
| `@qiongqi/services` | Thread/Turn/Usage/Review 服务 | ✅ | 完成 |
| `@qiongqi/adapter-model` | ModelCompatClient | ✅ | 完成 |
| `@qiongqi/adapter-tools` | bash/read/edit/grep + MCP provider | ✅ | 完成 |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite 存储 | ✅ | 完成 |
| `@qiongqi/skills` | SkillRuntime + PluginHost | ✅ | 完成 |
| `@qiongqi/memory` | MemoryStore + provider | ✅ | 完成 |
| `@qiongqi/attachments` | AttachmentStore | ✅ | 完成 |
| `@qiongqi/delegation` | DelegationRuntime + ChildExecutor | ✅ | 完成 |
| `@qiongqi/http` | HTTP/SSE server + routes | ✅ | 完成 |
| `@qiongqi/cli` | qiongqi 命令行入口 | ✅ | 完成 |
| `@qiongqi/preset-coding` | 编码预设（系统提示词 + 默认配置） | ✅ | 完成 |

**关键技术决策**：
- `shared`/`prompt`/`config` → 合并入 `contracts`
- `telemetry` → 合并入 `cache`
- `review` → 合并入 `loop`
- `review-service.ts` 从 `services` 移到 `http`（打破 loop↔services 值循环）
- `defaultLocalTools` 改为延迟函数 `getDefaultLocalTools()`（打破 adapter-tools 循环初始化）

### 1.3 关键改造点 ✅

- [x] 系统提示词参数化（`QiongqiServeRuntimeOptions.systemPrompt` + fallback 到 `QIONGQI_SYSTEM_PROMPT`）
- [x] 模型客户端重命名（`DeepseekCompatModelClient` → `ModelCompatClient`，保留旧名别名向后兼容）
- [x] Skills 路径解耦（新增 `skillRoots?: string[]` 参数，移除硬编码 `cwd/qiongqi/skills`）
- [x] Composition Root 拆分：
  - `createCore()` — 存储、事件总线、Thread/Turn/Usage 服务
  - `createModelAdapter()` — ModelCompatClient + 能力配置
  - `createToolMatrix()` — 工具注册表、技能、委派运行时
  - `createAgent()` — 编排循环（TurnOrchestrator 组装）
  - `createQiongqiServeRuntime()` 保留为向后兼容别名
- [x] PricingProvider 抽象层（去 DeepSeek 硬编码）：
  - 新增 `packages/adapter-model/src/pricing/` 子目录
  - `types.ts`：`PricingProvider` 接口 + `CostEstimate` / `PricingInput` 类型
  - `deepseek-pricing.ts`：`DeepseekPricingProvider` 实现（DeepSeek 官方定价表，非 DeepSeek host 返回 null）
  - `composite-pricing.ts`：`CompositePricingProvider` 组合器（按注册顺序返回首个非 null 估算）
  - `index.ts`：barrel exports + `defaultPricingProvider` 单例
  - `ModelCompatClient` 通过构造参数 `pricingProvider` 注入，默认使用 Composite
  - `mapUsage()` 改用注入的 provider 估算成本/节省
  - 新增 Provider 可实现 `PricingProvider` 并注册到 Composite，无需修改客户端
- [x] 模型客户端文件重命名：
  - `deepseek-compat-model-client.ts` → `model-compat-client.ts`
  - `DeepseekCompatConfig` → `ModelCompatConfig`（保留旧名为别名）
  - `deepseek-pricing.ts` 逻辑迁移到 `pricing/deepseek-pricing.ts`（原文件已删除）

### 1.4 新 API 形状 ✅

- [x] `createHttpServer` 公共 API 实现（拆分 agent 构建 vs HTTP 挂载）：
  - 新增 `createHttpServer(options: { agent, host?, port })`
  - `startQiongqiServe` 重构为 `createAgent` + `createHttpServer` 的组合（向后兼容）
  - `createQiongqiServeRuntime` / `startQiongqiServe` 标记为 `@deprecated`
- [x] JSDoc 文档补全：
  - `createAgent` — 完整 Quick start 示例 + @param/@returns + 子组件引用
  - `createCore` / `createModelAdapter` / `createToolMatrix` — 职责说明 + @param
  - `CoreRuntime` / `ModelAdapter` / `ToolMatrix` 接口 JSDoc
  - `CreateHttpServerOptions` + `createHttpServer` 示例与使用场景
- [x] 修复 `RuntimeInfoResponse` schema 回归（1.3 加入的 `agentName` 字段未同步到 contracts 的 zod schema）

### 1.5 CLI 入口重写 ✅

- [x] CLI 默认走 `createCodingAgent`（preset-coding 组装）：
  - `cli/package.json` 新增 `@qiongqi/preset-coding` 依赖
  - `ServeOptionsSchema` 新增 `preset` 字段（默认 `'coding'`）
  - `SERVE_PRESETS = ['coding', 'generic']` 枚举导出
  - `parseServeOptions` 解析 `--preset` 选项 + `QIONGQI_PRESET` 环境变量
  - `resolveRuntimeFactory(preset)` 统一工厂选择（serve/run/chat/exec 共用）
  - `serve-entry.ts` 改用 `createAgent`/`createCodingAgent` + `createHttpServer` 组合
  - 向后兼容：所有现有参数、环境变量、输出格式、QIONGQI_READY 握手不变
  - 端到端验证：默认 `agentName=Qiongqi Coding`，`--preset generic` → `agentName=Qiongqi`
- [x] `baseUrl` / `apiKey` 改为必填：
  - `ServeOptionsSchema` 中 `apiKey`/`baseUrl` 从 `.default(...)` 改为 `.min(1)`
  - 移除旧的 `https://api.deepseek.com/beta` 默认值
  - `DEFAULT_SERVE_OPTIONS` 排除 `baseUrl`/`apiKey`（无默认值）
  - `parseServeOptionsSafe` 在缺失时给出友好提示（指明 CLI flag / 环境变量 / config 文件三选一）
  - `resolveApiKey`/`resolveBaseUrl` 辅助函数统一来源解析
  - 端到端验证：缺失时退出码 78 + 友好提示；提供后正常启动

### 1.6 测试迁移 ✅

- [x] 53 个测试文件迁移到根 `tests/` 目录
- [x] 所有 import 重写为 `@qiongqi/*` 格式
- [x] `vitest.config.ts` 别名映射（`qiongqi/**` 排除规则已在清理后移除）
- [x] 测试 helper（loop-test-harness, http-server-test-harness）迁移
- [x] `defaultLocalTools` → `getDefaultLocalTools()` 更新
- [x] mock 路径修复（`vi.mock` 路径更新）
- [x] 全量测试 433/433 通过

### 1.7 端到端验证 ✅

- [x] `pnpm -r run build` 全包通过
- [x] `npx vitest run` 全量测试通过
- [x] `qiongqi serve` 启动成功
- [x] `GET /health` 返回 `{"status":"ok"}`
- [x] `POST /v1/threads` 创建线程成功
- [x] `GET /v1/threads` 列表持久化正常
- [x] Auth 中间件工作正常

### 1.7.1 旧单体目录清理 ✅

- [x] `qiongqi/skills/` → 根目录 `skills/`（11 个预设技能）
- [x] `qiongqi/DESIGN.md` → `docs/design-philosophy.zh.md`
- [x] `qiongqi/config.example.json` → 根目录 `config.example.json`
- [x] `qiongqi/scripts/transcript-diff.mjs` → 根目录 `scripts/`
- [x] `pnpm-workspace.yaml` 移除 `'qiongqi'` 条目
- [x] 整个 `qiongqi/` 目录删除（272 个文件，含 181 个冗余源文件 + 42 个冗余测试 + dist/ + node_modules/）
- [x] `tests/builtin-skills.test.ts` 路径修复（`qiongqi/skills` → `skills`）
- [x] 清理后全量测试 433/433 通过 + 端到端验证通过

### 1.8 交付物 ✅

- [x] 16 个独立 npm 包，各自 `package.json` + `tsconfig.json` + `tsconfig.build.json`：
  - 所有包补全顶层 `types: ./dist/index.d.ts`（兼容旧 TS / 工具）
  - 所有包 `exports` 包含 `types` + `import` 双子字段
  - 所有包 `.d.ts` 类型声明文件正确生成（11~71 行不等）
  - `cli` 包新增 `bin: { qiongqi: ./dist/serve-entry.js }` 入口
- [x] `createAgent` / `createHttpServer` 公共 API 文档（JSDoc）见 1.4
- [x] preset-coding 包验证：外部消费模拟测试通过（`createCodingAgent` / `CODING_SYSTEM_PROMPT` / `CODING_PINNED_CONSTRAINTS` 导出正常）
- [x] 全量测试 + 端到端验证通过：
  - 16 包构建全绿 + 433/433 测试全绿 + tsc 0 错误
  - bin 入口启动成功（`agentName=Qiongqi Coding`）
  - Health check / Runtime info / Thread CRUD 全通过

---

## 阶段 2：AgentCard + AgentIdentity（未开始）

- [ ] `AgentCardSchema` 合约定义
- [ ] `PeerRegistry` 实现（本地 + 远程 peer）
- [ ] `GET /.well-known/agent-card.json` 端点
- [ ] DelegationRuntime 改造（子代理持久化）
- [ ] 跨实例互调端到端验证

---

## 阶段 3：TurnOrchestrator 事件化（未开始）

- [ ] `TurnStateGraph`（借鉴 LangGraph）
- [ ] 事件总线重构
- [ ] 崩溃恢复（durable state）
- [ ] 灰度策略（A/B 对比）
- [ ] 端到端恢复验证

---

## 阶段 4：A2A 协议端点（未开始）

- [ ] A2A 端点实现（`/a2a`）
- [ ] `A2APeerAdapter`
- [ ] Artifact 桥接
- [ ] 端到端跨实例协作验证
