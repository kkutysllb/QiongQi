# Qiongqi 包依赖图

> 本文记录 16 个 `@qiongqi/*` 包的精确依赖关系。
> 依赖方向严格单向，不允许循环。
>
> English version: [`package-dependencies.en.md`](./package-dependencies.en.md)

---

## 依赖层级总览

```
Layer 0 (零依赖):     contracts
Layer 1:              domain
Layer 2:              ports
Layer 3:              cache, attachments
Layer 4:              services, loop  ← (互相 type-only 引用，无值循环)
Layer 5:              adapter-model, adapter-storage, adapter-tools
Layer 6:              skills, memory
Layer 7:              delegation
Layer 8:              http
Layer 9:              cli
Layer 10:             preset-coding
```

---

## 完整依赖表

### contracts（零依赖基础层）

```
@qiongqi/contracts — 无依赖
```

### domain

```
@qiongqi/domain
  └── @qiongqi/contracts
```

### ports

```
@qiongqi/ports
  ├── @qiongqi/contracts
  └── @qiongqi/domain
```

### cache

```
@qiongqi/cache
  ├── @qiongqi/contracts
  └── @qiongqi/ports
```

### attachments

```
@qiongqi/attachments
  └── @qiongqi/contracts
```

### services

```
@qiongqi/services
  ├── @qiongqi/contracts
  ├── @qiongqi/domain
  ├── @qiongqi/ports
  ├── @qiongqi/loop        (type-only: InflightTracker, SteeringQueue, ContextCompactor)
  ├── @qiongqi/adapter-tools
  └── @qiongqi/cache
```

### loop

```
@qiongqi/loop
  ├── @qiongqi/contracts
  ├── @qiongqi/domain
  ├── @qiongqi/ports
  ├── @qiongqi/cache
  ├── @qiongqi/services     (type-only: TurnService, UsageService, RuntimeEventRecorder)
  ├── @qiongqi/adapter-tools
  ├── @qiongqi/adapter-model
  ├── @qiongqi/attachments
  ├── @qiongqi/skills
  └── @qiongqi/memory
```

> **循环依赖打破策略**：`loop` 和 `services` 之间存在循环，但通过 `import type` 将
> 值引用改为类型引用，消除了运行时循环初始化。

### adapter-model

```
@qiongqi/adapter-model
  ├── @qiongqi/contracts
  ├── @qiongqi/domain
  └── @qiongqi/ports
```

### adapter-storage

```
@qiongqi/adapter-storage
  ├── @qiongqi/contracts
  ├── @qiongqi/domain
  └── @qiongqi/ports
```

### adapter-tools

```
@qiongqi/adapter-tools
  ├── @qiongqi/contracts
  ├── @qiongqi/domain
  ├── @qiongqi/ports
  ├── @qiongqi/services
  ├── @qiongqi/memory
  └── @qiongqi/delegation
```

### skills

```
@qiongqi/skills
  ├── @qiongqi/contracts
  ├── @qiongqi/ports
  └── @qiongqi/adapter-tools
```

### memory

```
@qiongqi/memory
  ├── @qiongqi/contracts
  └── @qiongqi/adapter-storage
```

### delegation

```
@qiongqi/delegation
  ├── @qiongqi/contracts
  ├── @qiongqi/ports
  ├── @qiongqi/cache
  ├── @qiongqi/loop
  ├── @qiongqi/adapter-storage
  ├── @qiongqi/memory
  ├── @qiongqi/skills
  └── @qiongqi/services
```

### http

```
@qiongqi/http
  ├── @qiongqi/contracts
  ├── @qiongqi/domain
  ├── @qiongqi/ports
  ├── @qiongqi/cache
  ├── @qiongqi/loop
  ├── @qiongqi/services
  ├── @qiongqi/adapter-model
  ├── @qiongqi/adapter-storage
  ├── @qiongqi/adapter-tools
  ├── @qiongqi/skills
  ├── @qiongqi/memory
  ├── @qiongqi/attachments
  └── @qiongqi/delegation
```

### cli

```
@qiongqi/cli
  ├── @qiongqi/http
  ├── @qiongqi/contracts
  ├── @qiongqi/adapter-tools
  ├── @qiongqi/ports
  └── @qiongqi/loop
```

### preset-coding

```
@qiongqi/preset-coding
  ├── @qiongqi/http
  ├── @qiongqi/contracts
  └── @qiongqi/ports
```

---

## 循环依赖处理记录

### 问题 1: loop ↔ services

**原因**：`loop` 需要使用 `services` 中的 `TurnService`/`UsageService`，而
`services` 需要使用 `loop` 中的 `ContextCompactor`/`InflightTracker`。

**解决方案**：
- 将 `services` 对 `loop` 的引用改为 `import type`（仅类型，运行时无依赖）
- `review-service.ts` 从 `services` 移到 `http`，打破值引用循环

### 问题 2: adapter-tools 内部循环初始化

**原因**：`local-tool-host.ts` 在模块级调用 `buildBuiltinLocalTools()`，而
`builtin-tools.ts` 导入了 `builtin-bash-tool.ts`，后者又导入了
`local-tool-host.ts`。

**解决方案**：
- `defaultLocalTools` 从模块级常量改为延迟函数 `getDefaultLocalTools()`
- 只在实际使用时才调用 `buildBuiltinLocalTools()`

---

## 外部依赖分布

| 外部依赖 | 所在包 |
|---------|--------|
| `zod` | contracts, adapter-tools, cli |
| `better-sqlite3` | adapter-storage |
| `@types/better-sqlite3` | adapter-storage (dev) |
| `diff` | adapter-tools |
| `@modelcontextprotocol/sdk` | adapter-tools |

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [架构总览](./architecture-overview.zh.md) | 分层设计和核心数据流 |
| [各包说明](./packages.zh.md) | 每个包的详细 API 和用法 |
