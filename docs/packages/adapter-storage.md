# @qiongqi/adapter-storage

> 存储适配器：File / Hybrid / SQLite + 全部 in-memory 适配器。
> Layer 5 — 依赖：`@qiongqi/contracts`、`@qiongqi/domain`、`@qiongqi/ports`、`better-sqlite3`。

---

## 中文

### 1. 职责

`@qiongqi/adapter-storage` 是 Qiongqi 持久化层的**唯一实现来源**。它提供：

- **文件存储**（`File*`）—— JSON / JSONL；调试友好，可直接 `cat` / `jq`
- **混合存储**（`Hybrid*`）—— SQLite 索引 + JSONL 全量日志（Codex-style）
- **内存存储**（`InMemory*`）—— 测试用，零依赖
- **原子写**（`withFileMutationQueue`）—— rename-based 跨进程安全
- **本地工作区检查**（`LocalWorkspaceInspector`）—— 拒绝路径逃逸

存储选型由 `RuntimeConfig.storage.backend` 决定：`'file'` / `'hybrid'` / 隐含的 `in-memory`（仅在 `ChildAgentExecutor` 中使用）。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `withFileMutationQueue(path, fn)` | function (async) | `atomic-write.ts` | 同一文件路径的 mutation 串行化；通过 tmp+rename 原子写 |
| `atomicWriteFile` / `atomicWriteJson` | function | `atomic-write.ts` | 单次原子写（含 win32 fallback）|
| `FileThreadStore` | class | `file-thread-store.ts` | JSON 文件实现；每个 thread 一个 `.json` |
| `FileSessionStore` | class | `file-session-store.ts` | JSONL 追加式；events 不可变 + items 可重写 |
| `HybridThreadStore` | class | `hybrid-thread-store.ts` | SQLite 索引 + JSONL items |
| `HybridSessionStore` | class | `hybrid-session-store.ts` | SQLite 缓存 + JSONL events |
| `InMemoryThreadStore` | class | `in-memory-thread-store.ts` | 线程 Map（测试用）|
| `InMemorySessionStore` | class | `in-memory-session-store.ts` | session Map（测试用）|
| `InMemoryEventBus` | class | `in-memory-event-bus.ts` | 同步事件总线 + per-thread seq 计数器 |
| `InMemoryApprovalGate` | class | `in-memory-approval-gate.ts` | 内存审批门 |
| `InMemoryUserInputGate` | class | `in-memory-user-input-gate.ts` | 内存用户输入门 |
| `LocalWorkspaceInspector` | class | `local-workspace-inspector.ts` | 工作区文件检查（拒绝路径逃逸）|

### 3. 关键不变量

- **原子写基于 tmp+rename**：所有文件 mutation 通过 `withFileMutationQueue` 排队；写过程是 `writeFile(<path>.tmp-<pid>-<ts>)` → `rename(..., <path>)`，POSIX 上 rename 是原子的（`atomic-write.ts`）。
- **路径序列化在进程内 + 跨进程**：进程内 `Map<path, Promise>` 链；`withFileMutationQueue` 的 queue 通过 promise chain 保证顺序（`atomic-write.ts`）。
- **`FileSessionStore` 三流分离**：events 追加到 `events.jsonl`（不可变）；items 可通过 `rewriteItems` 原子重写；session.json 是投影（`file-session-store.ts`）。
- **`Hybrid*` 缓存策略**：SQLite 是 metadata 索引（thread / session 列表 / by-id 查找），JSONL 是 source of truth；`HybridSessionStore` 通过 `(sessionId, lastSeq)` 缓存事件，重启后从 JSONL 重建。
- **`InMemoryEventBus.allocateSeq(threadId)` 是 mutex-free 单调计数器**：每线程独立的 `Map<threadId, number>`。
- **`InMemoryApprovalGate.request()` 永远会 resolve**：被 `abort` 后 `decide` 仍能让 promise 落定。
- **`LocalWorkspaceInspector` 拒绝路径逃逸**：所有路径解析必须落在传入的 `root` 内；父目录引用（`..`）直接拒绝。
- **`file-mutation-queue` 的锁根目录**：`os.tmpdir()/kun-file-mutation-locks/<sha256>.lock` —— 用 `mkdir` 实现原子锁（`@qiongqi/tool-infra` 实现，本包 re-export）。

### 4. 行为规约

来自 `tests/atomic-write.test.ts` / `tests/hybrid-store.test.ts` / `tests/file-session-store.test.ts` / `tests/file-session-store-integration.test.ts`：

- `atomicWriteFile writes to a temp file then renames atomically`
- `atomicWriteFile survives concurrent writers via the per-path queue`
- `withFileMutationQueue serializes mutations to the same absolute path`
- `FileThreadStore.upsert preserves the existing turn list when re-saving`
- `FileSessionStore.appendEvent never overwrites existing events with the same seq`
- `FileSessionStore.rewriteItems swaps items.ndjson atomically (no half-write)`
- `FileSessionStore heals corrupted items on load (skips bad lines, preserves good ones)`
- `HybridThreadStore uses SQLite for thread shells and JSONL for items`
- `HybridSessionStore caches (sessionId, lastSeq) in SQLite and replays from JSONL after restart`
- `InMemoryEventBus allocates per-thread monotonic seq starting at 1`
- `InMemoryEventBus.snapshotSince returns events with seq > sinceSeq`
- `LocalWorkspaceInspector.status returns null fields for non-git workspaces`
- `LocalWorkspaceInspector refuses paths outside the workspace root`

### 5. 使用示例

```typescript
import {
  FileThreadStore,
  FileSessionStore,
  InMemoryEventBus,
  InMemoryApprovalGate,
  withFileMutationQueue,
} from '@qiongqi/adapter-storage'

// 1. 文件实现
const threadStore = new FileThreadStore({ rootDir: '/work/.qiongqi/threads' })
const sessionStore = new FileSessionStore({ rootDir: '/work/.qiongqi/sessions' })
const eventBus = new InMemoryEventBus()
const approvalGate = new InMemoryApprovalGate()

// 2. 原子 mutation
await withFileMutationQueue('/work/.qiongqi/state.json', async () => {
  await atomicWriteFile('/work/.qiongqi/state.json', JSON.stringify(newState, null, 2))
})

// 3. Thread CRUD
const thread = await threadStore.upsert({
  id: 'thread_1',
  title: 'My thread',
  workspace: '/work',
  model: 'deepseek-v4-pro',
  // ...
})
const list = await threadStore.list({ includeArchived: false, limit: 50 })

// 4. Session 事件追加
await sessionStore.appendEvent('thread_1', {
  kind: 'turn_started',
  seq: 1,
  threadId: 'thread_1',
  turnId: 'turn_1',
  timestamp: new Date().toISOString(),
})
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#2-架构总览`](../architecture.zh.md#2-架构总览)（§2.3 存储与状态架构）
- 消费方：`@qiongqi/http` 的 `createCore` 选 file/hybrid；`@qiongqi/delegation` 的 `ChildAgentExecutor` 用 in-memory 全套
- 源文件：[`atomic-write.ts`](../../packages/adapter-storage/src/atomic-write.ts)、[`file-thread-store.ts`](../../packages/adapter-storage/src/file-thread-store.ts)、[`file-session-store.ts`](../../packages/adapter-storage/src/file-session-store.ts)、[`hybrid-thread-store.ts`](../../packages/adapter-storage/src/hybrid-thread-store.ts)、[`hybrid-session-store.ts`](../../packages/adapter-storage/src/hybrid-session-store.ts)、[`in-memory-*.ts`](../../packages/adapter-storage/src/)、[`local-workspace-inspector.ts`](../../packages/adapter-storage/src/local-workspace-inspector.ts)
- 测试：[`../../tests/atomic-write.test.ts`](../../tests/atomic-write.test.ts)、[`../../tests/hybrid-store.test.ts`](../../tests/hybrid-store.test.ts)、[`../../tests/file-session-store.test.ts`](../../tests/file-session-store.test.ts)、[`../../tests/file-session-store-integration.test.ts`](../../tests/file-session-store-integration.test.ts)
