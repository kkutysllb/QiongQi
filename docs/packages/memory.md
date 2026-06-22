# @qiongqi/memory

> 跨会话记忆存储 —— FileMemoryStore + 简单关键词打分。
> Layer 6 — 依赖：`@qiongqi/contracts`、`@qiongqi/adapter-storage`（用于原子写）。

---

## 中文

### 1. 职责

`@qiongqi/memory` 提供**跨会话持久化记忆**的文件系统实现 `FileMemoryStore`：

- **作用域**：`user`（全局）/ `workspace`（当前 workspace）/ `project`（项目级）
- **CRUD** + **检索**（关键词打分 + confidence 加权）
- **软删除**（tombstone via `deletedAt`）+ **软禁用**（`disabledAt`）
- **lastInjectedIds** 跟踪 —— 防止重复注入

设计哲学：memory 是"骨架之外的血肉"——Engine 不依赖 memory，memory 通过 `memory-tool-provider` 与 `loop` 的 `retrieveMemories` 注入到 prompt。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `MemoryStore` | interface | `memory-store.ts` | 端口契约：create / update / delete / list / retrieve / diagnostics / setLastInjected |
| `FileMemoryStore` | class | `memory-store.ts` | 文件系统实现（`<rootDir>/<id>.json`，通过 `atomicWriteFile` 写）|

#### `MemoryStore` 方法

```typescript
create(input: MemoryCreateRequest): Promise<MemoryRecord>
update(id: string, patch: MemoryUpdateRequest): Promise<MemoryRecord>
delete(id: string): Promise<MemoryRecord>          // 软删除（写 deletedAt）
list(filter?: { workspace?: string; includeDeleted?: boolean }): Promise<MemoryRecord[]>
retrieve(input: { query: string; workspace?: string; limit: number }): Promise<MemoryRecord[]>
diagnostics(): Promise<MemoryDiagnostics>
setLastInjected(ids: string[]): void
```

### 3. 关键不变量

- **`delete` 是软删除**：写入 `deletedAt: now` 但不删除文件；`list({ includeDeleted: false })`（默认）会过滤（`memory-store.ts:71-80, 84-86`）。
- **`update` 支持 `disabled: true / false`**：true 写 `disabledAt`（若未设）；false 清 `disabledAt`（`memory-store.ts:62-64`）。
- **`retrieve` 受 `config.enabled` 控制**：disabled 配置时直接返回 `[]`（`memory-store.ts:90-91`）。
- **`inScope` 规则**：
  - `scope='user'` 永远返回 true
  - `scope='workspace'` 仅当 `record.workspace === filter.workspace`
  - `scope='project'` 永远返回 true（项目级作用域由 `record.project` 字段标识，但当前不强制检查）
  （`memory-store.ts:146-150`）
- **`scoreMemory` 关键词打分**：将 query 拆为长度 > 2 的 token，与 `content + tags` 做 substring 匹配，匹配数 × `confidence`（`memory-store.ts:152-160`）。
- **`list` 按 `updatedAt` 降序**：最近修改在前（`memory-store.ts:87`）。
- **`retrieve` 按 `score` 降序、相同 score 按 `updatedAt` 降序**（`memory-store.ts:96-97`）。
- **`diagnostics` 返回三计数**：active（既无 `deletedAt` 也无 `disabledAt`）/ tombstone（有 `deletedAt`）/ `lastInjectedIds`（`memory-store.ts:107-110`）。
- **写是原子的**：`write` 调用 `atomicWriteFile` 防止半写状态（`memory-store.ts:134-139`）。
- **`readAll` 容错**：单文件 JSON 解析失败返回 `null`，最终 `filter(Boolean)`，单个坏文件不影响整个 store（`memory-store.ts:123-132`）。

### 4. 行为规约

来自 `tests/memory-store.test.ts` 的 `it()` 行为描述：

- `create persists the record and assigns a generated id`
- `create respects an injected idGenerator (deterministic id)`
- `update applies patches and refreshes updatedAt`
- `update with disabled=true sets disabledAt only on first disable`
- `update with disabled=false clears disabledAt`
- `delete writes deletedAt and is idempotent (re-deleting keeps the original timestamp)`
- `list filters out tombstoned records by default`
- `list includes tombstoned records when includeDeleted is true`
- `list filters by workspace scope using the canonical inScope rules`
- `list sorts by updatedAt descending`
- `retrieve returns an empty array when memory is disabled in config`
- `retrieve ranks records by score (substring match count × confidence) descending`
- `retrieve breaks ties on score by updatedAt descending`
- `retrieve respects the limit parameter`
- `diagnostics reports activeCount, tombstoneCount, and lastInjectedIds`
- `setLastInjected replaces the previous array (does not merge)`

### 5. 使用示例

```typescript
import { FileMemoryStore } from '@qiongqi/memory'

const store = new FileMemoryStore({
  rootDir: '/work/.qiongqi/memory',
  config: {
    enabled: true,
    scopes: ['user', 'workspace', 'project'],
    maxInjectedRecords: 8,
  },
})

// 1. 创建
const m1 = await store.create({
  content: 'Project uses TypeScript strict mode',
  scope: 'workspace',
  workspace: '/work',
  tags: ['typescript', 'config'],
  confidence: 0.9,
})

// 2. 检索
const results = await store.retrieve({
  query: 'typescript configuration',
  workspace: '/work',
  limit: 5,
})

// 3. 软删除
await store.delete(m1.id)
// m1 现在有 deletedAt；list({ includeDeleted: false }) 不再返回

// 4. 禁用（保留内容但不再注入）
await store.update(m1.id, { disabled: true })
// retrieve 不会再返回（active filter 会过滤 disabledAt）

// 5. 诊断
const diag = await store.diagnostics()
// { enabled, rootDir, activeCount, tombstoneCount, lastInjectedIds }
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 6 能力扩展层）
- 消费方：`@qiongqi/adapter-tools/memory-tool-provider.ts`（暴露 `memory_create` / `memory_update` / `memory_delete` 工具给 model）；`@qiongqi/loop` 的 `PromptBuilder.retrieveMemories` 注入到 context
- 源文件：[`memory-store.ts`](../../packages/memory/src/memory-store.ts)
- 测试：[`../../tests/memory-store.test.ts`](../../tests/memory-store.test.ts)
