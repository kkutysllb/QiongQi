# @qiongqi/loop — Prompt / Model / Context

> `PromptBuilder` + `ModelStepRunner` + `ContinuationPolicy` + `ContextCompactor` + `TokenEconomy` + `AutoModelRouter` —— 回合内的"思考"层。
> Layer 4 — 同 orchestrator 子模块。

---

## 中文

### 1. 职责

本子模块处理回合内的**思考/上下文/工具规划**：

- **`PromptBuilder`** —— 每次 step 组装 `ModelRequest`（budget gate → history heal → compaction → routing → attachments → skills → memory → token economy → hygiene）
- **`ModelStepRunner`** —— 流式消费 `ModelStreamChunk`，emit 增量事件
- **`decideContinuation`** —— 纯函数决策：stop / continue / dispatch / failed / materialize_plan / failed_with_error
- **`ContextCompactor`** —— soft/hard/aggressive 三档压缩；heuristic + model 双模式
- **`TokenEconomy`** —— 工具描述 / 结果压缩，节省 token
- **`AutoModelRouter`** —— auto 模式下选择 flash vs pro
- **`ModelContextProfile`** —— per-model soft/hard 阈值

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `PromptBuilder` | class | `prompt-builder.ts` | 每次 step 组装 `ModelRequest` |
| `PromptBuilderDeps` / `BuildContext` / `BuildResult` | type | `prompt-builder.ts` | 构造依赖 + 输入/输出 |
| `ModelStepRunner` | class | `model-step-runner.ts` | 流式消费模型响应 |
| `StepResult` | type | `model-step-runner.ts` | `{ kind: 'aborted' } \| { kind: 'ran', text, textItemId, ..., completedToolCalls, stopReason }` |
| `decideContinuation` | function | `continuation-policy.ts` | 纯决策函数 |
| `ContinuationDecision` | type | `continuation-policy.ts` | 6 种决策的可辨识联合 |
| `ContextCompactor` | class | `context-compactor.ts` | 三档压缩 |
| `ContextCompactionConfig` / `CompactionPlan` | type | `context-compactor.ts` | 压缩配置 + 计划 |
| `ContextEstimator` | class | `context-estimator.ts` | 文本 → token 估算 |
| `estimateModelRequestInputTokens` | function | `model-request-estimator.ts` | request token 估算 |
| `TokenEconomyConfig` / `NormalizedTokenEconomyConfig` | type | `token-economy.ts` | 配置 |
| `applyTokenEconomyToRequest` | function | `token-economy.ts` | 应用压缩到 request |
| `compactToolSpec` / `compactHistoryItem` / `compressProse` | function | `token-economy.ts` | 三个压缩器 |
| `AutoModelRouteSelection` | type | `auto-model-router.ts` | `{ model, reasoningEffort?, source }` |
| `resolveAutoModelRoute` | function | `auto-model-router.ts` | flash-router 主函数 |
| `autoModelHeuristic` | function | `auto-model-router.ts` | 关键词回退 |
| `AUTO_MODEL_ROUTER_MODEL` / `AUTO_MODEL_FLASH` / `AUTO_MODEL_PRO` | const | `auto-model-router.ts` | 模型 ID 常量 |
| `AUTO_MODEL_ROUTER_TIMEOUT_MS` | const | `auto-model-router.ts` | `4000` |
| `MODEL_CONTEXT_PROFILES` | const | `model-context-profile.ts` | 预置 profile |
| `contextThresholdsForModel` | function | `model-context-profile.ts` | 取 per-model 软硬阈值 |
| `modelCapabilitiesForModel` | function | `model-context-profile.ts` | 取 per-model 能力 |
| `resolveModelContextProfile` | function | `model-context-profile.ts` | 按 id 查 profile |
| `computeShortHash` / `createToolDigestMarker` / `compactedItemsDigestSource` | function | `compaction-marker.ts` | 压缩标记工具 |
| `DEFAULT_CONTEXT_THRESHOLDS` | const | `model-context-profile.ts` | `{ softThreshold: 16_000, hardThreshold: 24_000 }` |
| `DEFAULT_TOKEN_ECONOMY_CONFIG` | const | `token-economy.ts` | 默认关闭 |

### 3. 关键不变量

- **`PromptBuilder` 拥有 3 个跨步状态**（`prompt-builder.ts:1-12` 注释）：
  1. `autoModelRoutes` —— 缓存 auto 路由选择
  2. `promptTokenPressure` —— 上一步的 prompt token 最大值
  3. `toolCatalogSnapshots` —— 工具目录指纹历史（漂移检测）
- **`decideContinuation` 纯函数**（`continuation-policy.ts:1-11`）—— **不**做 I/O / 不 emit 事件；orchestrator 应用决策。
- **`materialize_plan` 路径**：GUI 模式要求 `create_plan` 工具调用但 model 输出纯文本时，continuation policy 合成 tool_call（`continuation-policy.ts:44-90`）。
- **`failed_with_error`** 编码 `code: 'required_tool_missing'`（`continuation-policy.ts:91-93`）。
- **三档压缩阈值**（`context-compactor.ts:78-92`）：
  - `tokens < soft` → 不压缩
  - `[soft, soft + 0.6*span)` → `normal`，keep 4
  - `[soft + 0.6*span, hard)` → `aggressive`，keep 2
  - `>= hard` → `force`，keep 1
- **`frozen` 永远保留** —— 首 N 条消息不被压缩切掉。
- **`sourceDigest` + `digestMarker`** —— 链式压缩时验证 head 一致性（`<qiongqi:tool_digest sha256="...">` XML 标记）。
- **Token economy limits**（`token-economy.ts:34-47`）：`MAX_COMMAND_LINES=180` / `MAX_READ_LINES=320` / `MAX_TOKENS=8000` 等。
- **`compressProse` 用 `withProtectedSegments`** —— 代码块 / URL / 路径 / 标识符不被破坏。
- **AutoModelRouter flash 优先**（`AUTO_MODEL_ROUTER_MODEL='deepseek-v4-flash'`）—— heuristic 失败时回退到 `deepseek-v4-pro`。
- **Router timeout 4s** —— 任何 router 失败都用 heuristic。
- **Heuristic 关键词**（`auto-model-router.ts:83-100`）：`refactor` / `architecture` / `debug` / `security` / `review` / `audit` / `migrate` / `optimize` / `rewrite` / `implement` / `analyze` → 走 pro。
- **`ModelStepRunner` 流式 emit**（`model-step-runner.ts:71-180`）：每个 chunk 立即 emit 事件 + 累积 state。
- **`repairDispatchToolArguments` 总是调用** —— 修复 provider 中性的 argument 形状。

### 4. 行为规约

来自 `tests/continuation-policy.test.ts` / `tests/tool-call-repair.test.ts` / `tests/token-economy.test.ts` / `tests/auto-model-router.test.ts` / `tests/model-step-runner.test.ts`：

- `decideContinuation returns stop when no tool calls and no active goal`
- `decideContinuation returns continue when no tool calls but goal is active`
- `decideContinuation returns dispatch when tool calls are present`
- `decideContinuation returns failed on stopReason='error'`
- `decideContinuation returns materialize_plan when GUI plan required but model emitted text`
- `decideContinuation returns failed_with_error when required tool missing`
- `PromptBuilder.build returns aborted when signal is aborted mid-build`
- `PromptBuilder.build returns stop on breaking tool catalog drift`
- `PromptBuilder.build records pre_send/post_send pipeline stages with details`
- `ModelStepRunner.run returns ran with stopReason='stop' | 'tool_calls' | 'length' | 'error'`
- `ContextCompactor.planCompaction returns null when tokens < soft`
- `ContextCompactor.compact preserves frozen slice + produces summary item with digest marker`
- `ContextCompactor.compact keeps 1/2/4 recent in force/aggressive/normal modes`
- `applyTokenEconomyToRequest short-circuits when config.enabled=false`
- `resolveAutoModelRoute uses AbortController with 4000ms timeout`
- `autoModelHeuristic routes to pro when any keyword matches`

### 5. 使用示例

```typescript
import {
  PromptBuilder, ModelStepRunner, decideContinuation,
  ContextCompactor, applyTokenEconomyToRequest, resolveAutoModelRoute,
} from '@qiongqi/loop'

// 1. Build
const result = await promptBuilder.build({
  threadId: 'thread_1',
  turnId: 'turn_1',
  stepIndex: 0,
})
// { kind: 'built', ctx: { request, promptTokens, ... } }

// 2. Step
const step = await modelStepRunner.run({
  ctx: result.ctx!,
  modelRequest: result.ctx!.request,
  signal: controller.signal,
})
// { kind: 'ran', text: '...', completedToolCalls: [...], stopReason: 'tool_calls' }

// 3. Decision
const decision = decideContinuation({
  stepResult: step,
  hasToolCalls: step.completedToolCalls.length > 0,
  activeGoalInstruction: '...',
  requiredToolName: undefined,
  activePlanContext: undefined,
})
// { kind: 'dispatch' }

// 4. Compact
const compact = contextCompactor.planCompaction(items, { model: 'deepseek-v4-pro', promptTokens: 20000 })
// { mode: 'aggressive', keepRecent: 2, reason: 'usage prompt_tokens' }
const result = contextCompactor.compact({ items, plan: compact, frozen: firstTwo })

// 5. Token economy
applyTokenEconomyToRequest(request, { enabled: true, compressToolDescriptions: true, compressToolResults: true })
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#4-关键架构决策`](../architecture.zh.md#4-关键架构决策)（§4.6 Cache-First 三层契约）
- 消费方：`TurnOrchestrator` / `EventedTurnOrchestrator` 调用 `PromptBuilder.build` + `ModelStepRunner.run` + `decideContinuation`
- 源文件：[`prompt-builder.ts`](../../packages/loop/src/prompt-builder.ts)、[`model-step-runner.ts`](../../packages/loop/src/model-step-runner.ts)、[`continuation-policy.ts`](../../packages/loop/src/continuation-policy.ts)、[`context-compactor.ts`](../../packages/loop/src/context-compactor.ts)、[`token-economy.ts`](../../packages/loop/src/token-economy.ts)、[`auto-model-router.ts`](../../packages/loop/src/auto-model-router.ts)、[`model-context-profile.ts`](../../packages/loop/src/model-context-profile.ts)、[`context-estimator.ts`](../../packages/loop/src/context-estimator.ts)、[`model-request-estimator.ts`](../../packages/loop/src/model-request-estimator.ts)、[`compaction-marker.ts`](../../packages/loop/src/compaction-marker.ts)
- 测试：见上述 5 个测试文件
