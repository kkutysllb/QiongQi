# @qiongqi/adapter-model — Model Client

> `ModelCompatClient` —— OpenAI/Anthropic/Responses 兼容的 streaming 客户端。
> Layer 5 — 依赖：`@qiongqi/contracts`、`@qiongqi/domain`、`@qiongqi/ports`。被 `@qiongqi/loop` 的 `ModelStepRunner` 消费。

---

## 中文

### 1. 职责

`ModelCompatClient`（别名 `DeepseekCompatModelClient` 向后兼容）是 Qiongqi 的**唯一模型客户端**。它通过 `endpointFormat` 字段支持三种 wire 协议：

- **`chat_completions`**（默认）—— OpenAI 兼容，DeepSeek 走此协议
- **`responses`** —— OpenAI Responses API
- **`messages`** —— Anthropic Messages API

核心功能：

- **SSE 流式解析** + `request.abortSignal` 在 chunk 间传播
- **stream-idle timeout**（默认 45 000ms）—— 两个 chunk 间超过此时间发 `{kind:'error', code:'stream_idle_timeout'}`
- **usage 字段归一化**（`mapUsage`）—— 把三种协议的 `prompt_tokens` / `completion_tokens` / `cached_tokens` / `cache_*_tokens` 统一为 `UsageSnapshot`
- **tool-call 流式累积** —— `tool_call_delta` 在内部合并为 `tool_call_complete`
- **`mergeUsageSnapshots`** —— 多次 partial usage chunk 折叠

附带的 `model-error-probe.ts` 提供 DeepSeek 可达性探测；`tool-argument-repair.ts` 修复 model 输出的畸形 tool arguments。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ModelCompatClient` | class | `model-compat-client.ts` | 多协议 streaming 客户端 |
| `DeepseekCompatModelClient` | class | `model-compat-client.ts` | 向后兼容别名 = `ModelCompatClient` |
| `ModelCompatConfig` | type | `model-compat-client.ts` | 构造配置：`{ baseUrl, apiKey, model, endpointFormat, fetchImpl?, streamIdleTimeoutMs?, pricingProvider? }` |
| `DeepseekCompatConfig` | type | `model-compat-client.ts` | 旧名别名 |
| `ModelCompatClientFactory` | type | `model-compat-client.ts` | `(config) => ModelCompatClient` 工厂类型 |
| `EndpointAdapter` | type | `model-compat-client.ts` | 内部协议适配器接口 |
| `isDeepSeekHost(url)` | function | `model-compat-client.ts` | sniff `deepseek.com` / `deepseek.cc` |
| `probeDeepSeekReachable(opts)` | function | `model-error-probe.ts` | HTTP 探测：`{ reachable, status, latencyMs, error? }` |
| `repairToolArguments(raw)` | function | `tool-argument-repair.ts` | 修复 JSON 畸形 tool args；返回 `{ arguments, notes }` |

### 3. 关键不变量

- **`endpointFormat` 三种互斥**：`buildModelEndpointUrl` 先 strip 已知 trailing path（`/chat/completions` / `/responses` / `/messages`），再 append 规范 path（`/v1/chat/completions` 等）。
- **SSE chunk 间 abort 检查**：`stream` 实现每次 `await` chunk 后检查 `request.abortSignal.aborted`，是延迟 abort 的唯一安全点。
- **Stream-idle timeout**（默认 45s）：两个 chunk 间隔超过此时间 → 发 `error` chunk 并关闭流。
- **Usage 字段归一化跨协议**：`mapUsage` 把 OpenAI `prompt_tokens` / Anthropic `input_tokens` / Responses `input_tokens` 全部映射到 `UsageSnapshot.promptTokens`；cache 字段同理。
- **`mergeUsageSnapshots` 取 max for tokens**：多次 partial chunk 时取**最大**值（避免 model 上报逐步增加时漏算）。
- **DeepSeek v4 专有 reasoning 字段**：`reasoning_content` / `reasoning` / `thinking` 字段映射为 `assistant_reasoning_delta` chunk。
- **Tool call argument 修复**：`repairToolArguments` 失败时返回 `{ arguments: {}, notes: [...] }` 而不抛错（让上层决定）。
- **`isDeepSeekHost` 决定默认 endpoint path**：DeepSeek host 自动用 `chat_completions`；非 DeepSeek host 用配置的 `endpointFormat`（或默认）。
- **`probeDeepSeekReachable` 错误分类**：DNS 失败 / connection refused / timeout / HTTP 非 2xx —— 各自独立返回便于上层区分。

### 4. 行为规约

来自 `tests/model-client.test.ts`（约 56KB 的覆盖）：

- `streams the full assistant text delta + completed chunk sequence for chat_completions`
- `streams the Responses API format with input items and function_call_output`
- `streams the Anthropic Messages format with content blocks`
- `honors request.abortSignal between SSE chunks`
- `emits stream_idle_timeout error when no chunk arrives within streamIdleTimeoutMs`
- `normalizes usage from all three endpoint formats into UsageSnapshot`
- `merges multiple partial usage chunks via max for tokens, last non-null for cost`
- `accumulates tool_call_delta into tool_call_complete with canonicalized arguments`
- `isDeepSeekHost matches deepseek.com and deepseek.cc`
- `probeDeepSeekReachable returns reachable:false on DNS failure / connection refused / timeout / HTTP non-2xx`
- `repairToolArguments strips markdown code fences before parsing JSON`
- `repairToolArguments unwraps {arguments, args, input, parameters, params, payload, __raw} wrappers`
- `repairToolArguments salvages truncated payloads by extracting the first complete JSON object`
- `repairToolArguments handles double-encoded JSON strings`

### 5. 使用示例

```typescript
import { ModelCompatClient } from '@qiongqi/adapter-model'

const client = new ModelCompatClient({
  baseUrl: 'https://api.deepseek.com/beta',
  apiKey: process.env.DEEPSEEK_API_KEY!,
  model: 'deepseek-v4-pro',
  endpointFormat: 'chat_completions', // 默认
  streamIdleTimeoutMs: 45_000,
})

// 1. Streaming
for await (const chunk of client.stream({
  threadId: 'thread_1',
  turnId: 'turn_1',
  model: 'deepseek-v4-pro',
  systemPrompt: 'You are a coding assistant.',
  prefix: [],
  history: [],
  tools: [],
  abortSignal: controller.signal,
})) {
  switch (chunk.kind) {
    case 'assistant_text_delta':
      process.stdout.write(chunk.text)
      break
    case 'usage':
      usageService.record('thread_1', chunk.usage)
      break
    case 'completed':
      console.log('Done:', chunk.stopReason)
      break
    case 'error':
      throw new Error(chunk.message)
  }
}

// 2. 探测
const probe = await probeDeepSeekReachable({
  baseUrl: 'https://api.deepseek.com/beta',
  apiKey: '...',
  timeoutMs: 5_000,
})
console.log(probe.reachable, probe.latencyMs)

// 3. 修复 tool args
const result = repairToolArguments('```json\n{"command": "ls"}\n```')
// { arguments: { command: 'ls' }, notes: [...] }
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 5 适配器层）
- 消费方：`@qiongqi/loop/ModelStepRunner` 消费 stream；`@qiongqi/http` 的 `runtime-factory` 创建 client
- 源文件：[`model-compat-client.ts`](../../packages/adapter-model/src/model-compat-client.ts)、[`model-error-probe.ts`](../../packages/adapter-model/src/model-error-probe.ts)、[`tool-argument-repair.ts`](../../packages/adapter-model/src/tool-argument-repair.ts)
- 测试：[`../../tests/model-client.test.ts`](../../tests/model-client.test.ts)、[`../../tests/tool-call-repair.test.ts`](../../tests/tool-call-repair.test.ts)
