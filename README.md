<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/qiongqi.png">
    <img src="assets/qiongqi.png" width="100%" alt="Qiongqi — 穷奇非凶，乃破局之锐">
  </picture>
</p>

<h1 align="center">Qiongqi · 穷奇</h1>

<p align="center">
  <b>独立多 Agent 框架 · 骨架不变，血肉万变</b>
</p>

<p align="center">
  🌐 <a href="./README.zh.md">中文</a> · <a href="./README.en.md">English</a><br>
  <a href="./docs/architecture.zh.md">架构文档</a> ·
  <a href="./docs/packages/README.md">技术文档</a> ·
  <a href="./docs/deployment.zh.md">生产部署</a>
</p>

---

> **穷奇非凶，乃破局之锐。** Qiongqi 是一个领域中立的独立多 Agent 框架，以 cache-first、去中心化编排的 HTTP/SSE 引擎为骨架，搭配可插拔的技能与工具体系。
>
> 本项目的 **四阶段架构构建**（monorepo 拆包 → AgentCard → 事件化 → A2A）已完成到生产运行基线：`kernel_v3` 是默认生产执行核，`evented_v2` 是声明式 Loop Engineering 驱动的多 Agent 运行时基础设施，已具备 durable run / mailbox / outbox / remote worker / worker registry / timeline / metrics / rollout 灰度闭环。真实外部 A2A peer / 跨厂商互操作验证仍保留为需要外部对端的 P2 验证项。

---

## 📖 什么是 穷奇（Qiongqi）？

**Qiongqi** 是一个**领域中立的独立多 Agent 框架**，以 **cache-first、去中心化编排**的 HTTP/SSE 引擎为骨架，搭配可插拔的技能与工具体系，面向不同行业组装为生产力工具。你也可以用预置的技能完成一个coding agent实现编码生产力的工具。

核心目标：**提高每一 token 的 ROI**。避免重复工具 schema、失控工具输出、畸形历史、无效重试，以及任何可以命中却错过的稳定前缀。

当前能力包括 classic / evented_v2 / kernel_v3 编排模式、声明式 Loop Engineering（LoopRunner 解释 LoopPlan phases，并通过 Evaluator 做有界 retry）、evented_v2 多 Agent Graph runtime、durable mailbox/outbox、远程 agent worker/scheduler、worker pool 部署计划、shadow/canary/fallback 灰度闭环、HTTP/SSE API、A2A task lifecycle、Skill/MCP/Web/Memory/Delegation provider、attachments/artifacts、hybrid SQLite+JSONL storage、Prometheus metrics、structured access logs、OpenTelemetry HTTP tracing，以及工具输出预算、bash command audit、virtual path、terminal-state guard 等运行治理能力。

**evented_v2 与 kernel_v3 的关系**：`kernel_v3` 是默认生产执行核，负责单 run/turn 的 checkpoint、effect idempotency、replay 与 provider-neutral tool handling；`evented_v2` 是上层多 Agent 编排运行时，负责声明式 AgentGraph、handoff、mailbox、run-local outbox、remote worker/scheduler、timeline/metrics 与灰度控制。两者不是简单的新旧替代关系：生产默认仍由 `kernel_v3` 承载稳定单 Agent 路径，`evented_v2` 通过 `runtime.eventedV2Rollout` 按 shadow/canary/default 逐步接管多 Agent 流量，并可通过 `fallbackMode: "kernel_v3"` 自动回退。

**项目边界**：KWorks 兼容层已从本仓库完全移除；Qiongqi 保持领域中立的通用 Agent 引擎，不携带产品专属兼容逻辑。

> 完整介绍请阅读 **[中文 README](./README.zh.md)** 或 **[English README](./README.en.md)**。

---

## 🚀 快速开始

```bash
pnpm install
pnpm -r run build
node scripts/flatten-dist.mjs

npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --base-url "$QIONGQI_BASE_URL" \
  --api-key "$QIONGQI_API_KEY" \
  --port 8899
```

生产或 CI 中使用 `hybrid` 存储前，建议运行 `pnpm run prepare:sqlite && pnpm run verify:sqlite`，用于编译并验证 `better-sqlite3` 原生绑定可加载。

生产探针与运行指标：

```bash
curl http://127.0.0.1:8899/health
curl http://127.0.0.1:8899/ready
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  http://127.0.0.1:8899/v1/runtime/metrics
curl -H "Authorization: Bearer $QIONGQI_RUNTIME_TOKEN" \
  -H "Accept: text/plain" \
  "http://127.0.0.1:8899/v1/runtime/metrics?format=prometheus"
```

`/ready` 会暴露 storage degraded 状态；`/v1/runtime/metrics` 默认返回 JSON，也可用 Prometheus text 格式导出 token/cache、A2A task 与存储诊断。

evented_v2 生产 worker pool 可先生成平台中立的部署计划，再交给 Kubernetes、systemd、Nomad 或 CI 模板消费：

```bash
qiongqi worker \
  --deployment-plan \
  --json \
  --config ./config.json \
  --pool-size auto \
  --restart-backoff-ms 1000 \
  --max-restarts 5
```

灰度入口为 `runtime.eventedV2Rollout`，支持 `off` / `shadow` / `canary` / `default`，并可通过 `autoFallback` 按失败率、连续失败与冷却窗口把 evented_v2 主路径自动压回 `kernel_v3` / `classic` fallback mode。

验证 evented orchestrator + A2A 双实例路径：

```bash
pnpm -r run build
node scripts/flatten-dist.mjs
pnpm run verify:evented-a2a
```

该脚本覆盖异步 `POST /a2a/tasks` 提交、任务轮询完成、artifacts、SSE subscribe，以及 evented turn state 清理。

---

## 📦 Monorepo 包结构

采用 pnpm monorepo 多包结构，共 18 个独立 npm 包。当前状态以 [`docs/architecture.zh.md`](./docs/architecture.zh.md#3-包结构) 为准。

---

## 📚 相关文档

| 文档 | 位置 |
|------|------|
| **中文 README** | [`README.zh.md`](./README.zh.md) |
| **English README** | [`README.en.md`](./README.en.md) |
| **架构总览** | [`docs/architecture.zh.md`](./docs/architecture.zh.md) |
| **技术文档索引** | [`docs/packages/README.md`](./docs/packages/README.md) |
| **生产部署** | [`docs/deployment.zh.md`](./docs/deployment.zh.md) |
| **英文生产部署** | [`docs/deployment.en.md`](./docs/deployment.en.md) |
| **evented_v2 运行时** | [`docs/evented-v2-runtime.zh.md`](./docs/evented-v2-runtime.zh.md) / [`EN`](./docs/evented-v2-runtime.en.md) |
| **包依赖图** | [`docs/architecture.zh.md#附录-a-完整依赖表`](./docs/architecture.zh.md) |
| **逐包技术文档** | [`docs/packages/`](./docs/packages/) |
| **外部 A2A 验证计划** | [`docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md`](./docs/superpowers/plans/2026-06-23-external-a2a-interoperability.md) |
| **CI 工作流** | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) |
| **部署资产** | [`Dockerfile`](./Dockerfile), [`docker-compose.yml`](./docker-compose.yml), [`deploy/`](./deploy/) |

---

<p align="center">
  <sub>Built with ❤️ for the Agent era · 穷奇非凶，乃破局之锐</sub>
</p>
