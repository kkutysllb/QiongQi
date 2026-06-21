# Qiongqi Package Dependencies

> This document records the exact dependency relationships of the 16
> `@qiongqi/*` packages. Dependencies flow strictly one way; cycles are not
> allowed.
>
> 中文版本：[`package-dependencies.zh.md`](./package-dependencies.zh.md)

---

## Dependency Layer Overview

```
Layer 0 (zero-dep):   contracts
Layer 1:              domain
Layer 2:              ports
Layer 3:              cache, attachments
Layer 4:              services, loop  ← (mutual type-only refs, no value cycle)
Layer 5:              adapter-model, adapter-storage, adapter-tools
Layer 6:              skills, memory
Layer 7:              delegation
Layer 8:              http
Layer 9:              cli
Layer 10:             preset-coding
```

---

## Complete Dependency Table

### contracts (zero-dependency base layer)

```
@qiongqi/contracts — no dependencies
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

> **Circular Dependency Breaking Strategy**: A cycle exists between `loop` and
> `services`, but value references are converted to type references via
> `import type`, eliminating runtime circular initialization.

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

## Circular Dependency Resolution Records

### Issue 1: loop ↔ services

**Cause**: `loop` needs `TurnService`/`UsageService` from `services`, while
`services` needs `ContextCompactor`/`InflightTracker` from `loop`.

**Solution**:
- Converted `services`'s references to `loop` to `import type` (types only, no
  runtime dependency).
- Moved `review-service.ts` from `services` to `http` to break the value
  reference cycle.

### Issue 2: adapter-tools internal circular initialization

**Cause**: `local-tool-host.ts` called `buildBuiltinLocalTools()` at module
level, and `builtin-tools.ts` imported `builtin-bash-tool.ts`, which in turn
imported `local-tool-host.ts`.

**Solution**:
- Changed `defaultLocalTools` from a module-level constant to a lazy function
  `getDefaultLocalTools()`.
- `buildBuiltinLocalTools()` is only called when actually needed.

---

## External Dependency Distribution

| External Dependency | Package |
|---------------------|---------|
| `zod` | contracts, adapter-tools, cli |
| `better-sqlite3` | adapter-storage |
| `@types/better-sqlite3` | adapter-storage (dev) |
| `diff` | adapter-tools |
| `@modelcontextprotocol/sdk` | adapter-tools |

---

## Related Documents

| Document | Content |
|----------|---------|
| [Architecture Overview](./architecture-overview.en.md) | Layered design and core data flow |
| [Package Guide](./packages.en.md) | Detailed API and usage for each package |
