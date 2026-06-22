# @qiongqi/services — Usage 服务

> `UsageService` —— per-thread token / cache / cost 聚合 + 仪表盘查询。
> Layer 4 — 同 recorder + `ThreadService`。

---

## 中文

### 1. 职责

`UsageService` 包装 `@qiongqi/cache` 的 `UsageCounter` + `CacheTelemetry`，提供：

- **折叠** `ModelStreamChunk['usage']` 到 per-thread snapshot
- **记录 token economy 节省**（来自 `loop-events.ts` 的 `recordTokenEconomySavings`）
- **查询 API**：per-thread / 全局 / 按日（`/v1/usage?group_by=day`）/ 按线程（`group_by=thread`）/ 按模型（`group_by=model`）
- **携带备份**（`seedUsageCarryover`）—— 从 JSONL 历史重建时初始化

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `UsageService` | class | `usage-service.ts` | 用量聚合 + 查询 |
| `UsageValidationError` | class | `usage-service.ts` | 解析查询参数失败时抛 |
| `DailyUsageQuery` | type | `usage-service.ts` | `{ from, to, timezone }` |
| `ModelUsageQuery` | type | `usage-service.ts` | `{ from, to, timezone, model? }` |
| `ThreadUsageRecord` | type | `usage-service.ts` | 单线程查询返回 |
| `parseDailyUsageQuery` / `parseModelUsageQuery` | function | `usage-service.ts` | URL params → schema 验证 |
| `formatDateInTimezone` | function | `usage-service.ts` | YYYY-MM-DD 格式化（按 timezone）|
| `buildThreadUsageResponse` / `buildDailyUsageResponse` / `buildModelUsageResponse` | function | `usage-service.ts` | 构建 `/v1/usage` 响应 |
| `MAX_DAILY_USAGE_DAYS` | const | `usage-service.ts` | 单次 daily 查询最大跨度（默认 90 天）|

#### 关键方法

```typescript
record(threadId, chunkUsage): void           // 折叠 ModelStreamChunk['usage']
recordTokenEconomySavings(threadId, delta): void
seed(threadId, snapshot): void
forThread(threadId): UsageSnapshot
total(): UsageSnapshot
cacheSnapshot(threadId): CacheSnapshot
seedUsageCarryover(records): Promise<void>  // 从 JSONL 历史重建
```

### 3. 关键不变量

- **Cost 字段 undefined 保持 undefined**：与 `UsageCounter` 一致；`null` cacheHitRate 表示"未知"。
- **`cacheHitRate` 重算公式**：`hit / (hit + miss)`；分母为 0 时返回 `null`。
- **`MAX_DAILY_USAGE_DAYS` 防止单查询过载**：daily 查询超过该值的 `to - from` 跨度会抛 `UsageValidationError`。
- **时区无关存储**：所有 snapshot 用 `Date` / ISO 字符串；daily 聚合按 query 的 `timezone` 在 `formatDateInTimezone` 阶段归类。

### 4. 行为规约

来自 `tests/usage-service.test.ts` 的 `it()` 行为描述：

- `record folds a single ModelStreamChunk['usage'] into the per-thread snapshot`
- `record preserves undefined cost fields (does not coerce to 0)`
- `recordTokenEconomySavings adds to the running token economy fields`
- `total sums across all threads, preserving null cacheHitRate when no cache metrics exist`
- `forThread returns emptyUsageSnapshot() for unknown threadId`
- `seedUsageCarryover replays JSONL events to rebuild the per-thread counter`
- `parseDailyUsageQuery rejects when from > to or span exceeds MAX_DAILY_USAGE_DAYS`
- `buildDailyUsageResponse groups by date in the query timezone and returns the totals`

### 5. 使用示例

```typescript
import { UsageService } from '@qiongqi/services'

const usage = new UsageService({ counter, telemetry })

// 1. 折叠单次模型响应
usage.record('thread_1', {
  kind: 'usage',
  usage: {
    promptTokens: 1500,
    completionTokens: 200,
    totalTokens: 1700,
    cachedTokens: 1200,
    cacheHitTokens: 1100,
    cacheMissTokens: 100,
    cacheHitRate: 1100 / 1200,
    turns: 1,
  },
})

// 2. 记录 token economy 节省
usage.recordTokenEconomySavings('thread_1', {
  tokenEconomySavingsTokens: 500,
  tokenEconomySavingsUsd: 0.001,
})

// 3. 查询
const snap = usage.forThread('thread_1')
const total = usage.total()
const cache = usage.cacheSnapshot('thread_1')

// 4. 仪表盘响应
const daily = buildDailyUsageResponse(usage, {
  from: '2026-06-01',
  to: '2026-06-30',
  timezone: 'Asia/Shanghai',
})
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 4 引擎层）
- 消费方：`@qiongqi/http` 的 `/v1/usage` 路由
- 源文件：[`usage-service.ts`](../../packages/services/src/usage-service.ts)
- 测试：[`../../tests/usage-service.test.ts`](../../tests/usage-service.test.ts)
