# @qiongqi/adapter-model — Pricing

> `PricingProvider` 抽象层 —— 阶段 1.3 的 DeepSeek 解耦。Composite 组合多家厂商定价。
> Layer 5 — 依赖：`@qiongqi/contracts`。

---

## 中文

### 1. 职责

阶段 1.3 的关键解耦：让 `ModelCompatClient` 不再硬编码 DeepSeek 定价表。新增厂商只需实现 `PricingProvider` 并注册到 `CompositePricingProvider`。

四个核心组件：

- **`PricingProvider`** —— 端口：`estimateCost` / `estimateCacheSavings`
- **`DeepSeekPricingProvider`** —— DeepSeek 官方定价表，非 DeepSeek host 返回 `null`
- **`CompositePricingProvider`** —— 按注册顺序返回首个非 null 估算
- **`defaultPricingProvider`** —— Composite 单例，注册了 `DeepSeekPricingProvider`

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `PricingProvider` | interface | `pricing/types.ts` | 端口：`estimateCost` / `estimateCacheSavings` |
| `ModelPrice` | type | `pricing/types.ts` | `{ inputUsdPerMillion, outputUsdPerMillion, ... }` |
| `UsageForPricing` | type | `pricing/types.ts` | `{ model, providerHost?, cacheHitTokens, cacheMissTokens, outputTokens }` |
| `CostEstimate` | type | `pricing/types.ts` | `{ costUsd, costCny, cacheSavingsUsd, cacheSavingsCny }` |
| `DeepSeekPricingProvider` | class | `pricing/deepseek-pricing.ts` | DeepSeek 官方定价 |
| `DEEPSEEK_PRICING` | const | `pricing/deepseek-pricing.ts` | 预置价格表（按 model id）|
| `createDeepseekPricingProvider` | function | `pricing/deepseek-pricing.ts` | 工厂 |
| `estimateDeepseekInputTokenCost` | function | `pricing/deepseek-pricing.ts` | token economy 节省估算便捷函数 |
| `CompositePricingProvider` | class | `pricing/composite-pricing.ts` | 多 provider 组合 |
| `defaultPricingProvider` | const | `pricing/index.ts` | Composite 单例（注册 DeepSeek）|

### 3. 关键不变量

- **DeepSeek host 才返回非 null**：`DeepSeekPricingProvider.estimateCost` 检查 `providerHost` 必须匹配 `deepseek.com` / `deepseek.cc`；非 DeepSeek host 返回 `null`，由 Composite 继续查询下一个 provider。
- **Cache 节省 = `cacheHitTokens × (inputPrice - cacheHitPrice)`**：`estimateCacheSavings` 假设有 cache hit 的 token 走折扣价。
- **CNY 汇率**：`PricingProvider` 假设 USD × 固定汇率得到 CNY；当前实现使用 `1 USD ≈ 7.2 CNY`（可在 `composite-pricing.ts` 配置）。
- **Composite 注册顺序敏感**：先注册的 provider 优先；适合"新厂商覆盖默认"或"特定 model 走特定 provider"。
- **新增厂商定价的实现步骤**：
  1. 实现 `PricingProvider` 接口（`pricing/<vendor>-pricing.ts`）
  2. 在 `pricing/index.ts` 注册到 `defaultPricingProvider`
  3. 无需修改 `ModelCompatClient`

### 4. 行为规约

来自 `tests/deepseek-pricing.test.ts`：

- `DeepSeekPricingProvider returns null for non-DeepSeek host`
- `DeepSeekPricingProvider returns null for unknown model id`
- `CompositePricingProvider returns the first non-null estimate in registration order`
- `CompositePricingProvider returns null when all providers return null`
- `estimateCacheSavings uses cache-hit price (lower than input price) for cached tokens`
- `estimateDeepseekInputTokenCost is a convenience for the loop token-economy path`
- `defaultPricingProvider includes DeepSeekPricingProvider by default`

### 5. 使用示例

```typescript
import {
  PricingProvider,
  DeepSeekPricingProvider,
  CompositePricingProvider,
  defaultPricingProvider,
} from '@qiongqi/adapter-model'

// 1. 直接用默认
const estimate = defaultPricingProvider.estimateCost({
  model: 'deepseek-v4-pro',
  providerHost: 'api.deepseek.com',
  cacheHitTokens: 1000,
  cacheMissTokens: 200,
  outputTokens: 500,
})
// { costUsd: ..., costCny: ..., cacheSavingsUsd: ..., cacheSavingsCny: ... }

// 2. 组合多个 provider
const composite = new CompositePricingProvider([
  new DeepSeekPricingProvider(),
  new AnthropicPricingProvider(),  // 假设的另一个 provider
  new OpenAIPricingProvider(),
])

// 3. 新增厂商
class MyVendorPricingProvider implements PricingProvider {
  estimateCost(usage: UsageForPricing): CostEstimate | null {
    if (!usage.providerHost?.includes('myvendor.com')) return null
    // ... 计算逻辑
    return { costUsd, costCny, cacheSavingsUsd, cacheSavingsCny }
  }
  estimateCacheSavings(usage: UsageForPricing) { ... }
}
defaultPricingProvider.providers.push(new MyVendorPricingProvider())
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#4-关键架构决策`](../architecture.zh.md#4-关键架构决策)（§4.3 PricingProvider 抽象层）
- 消费方：`ModelCompatClient.mapUsage` 通过 `pricingProvider.estimateCost` 计算 cost 字段
- 源文件：[`pricing/types.ts`](../../packages/adapter-model/src/pricing/types.ts)、[`pricing/deepseek-pricing.ts`](../../packages/adapter-model/src/pricing/deepseek-pricing.ts)、[`pricing/composite-pricing.ts`](../../packages/adapter-model/src/pricing/composite-pricing.ts)、[`pricing/index.ts`](../../packages/adapter-model/src/pricing/index.ts)
- 测试：[`../../tests/deepseek-pricing.test.ts`](../../tests/deepseek-pricing.test.ts)
