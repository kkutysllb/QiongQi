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
  <a href="./docs/PROGRESS.zh.md">改造进度</a> ·
  <a href="./docs/architecture-overview.zh.md">架构文档</a> ·
  <a href="./docs/packages.zh.md">包说明</a>
</p>

---

> **穷奇非凶，乃破局之锐。** Qiongqi 是一个领域中立的独立多 Agent 框架，以 cache-first、去中心化编排的 HTTP/SSE 引擎为骨架，搭配可插拔的技能与工具体系。
>
> 本项目正在进行 **四阶段架构改造**（monorepo 拆包 → AgentCard → 事件化 → A2A），当前处于阶段 1。详细进度见 [`docs/PROGRESS.zh.md`](./docs/PROGRESS.zh.md)。

---

## 📖 什么是 Qiongqi？

**Qiongqi** 是一个**领域中立的独立多 Agent 框架**，以 **cache-first、去中心化编排**的 HTTP/SSE 引擎为骨架，搭配可插拔的技能与工具体系，面向不同行业组装为生产力工具。

核心目标：**提高每一 token 的 ROI**。避免重复工具 schema、失控工具输出、畸形历史、无效重试，以及任何可以命中却错过的稳定前缀。

> 完整介绍请阅读 **[中文 README](./README.zh.md)** 或 **[English README](./README.en.md)**。

---

## 🚀 快速开始

```bash
pnpm install
pnpm -r run build
node scripts/flatten-dist.mjs

npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --api-key "$API_KEY" \
  --port 8899
```

---

## 📦 Monorepo 包结构

采用 pnpm monorepo 多包结构，共 16 个独立 npm 包。详见 [`docs/packages.zh.md`](./docs/packages.zh.md)。

---

## 📚 相关文档

| 文档 | 位置 |
|------|------|
| **中文 README** | [`README.zh.md`](./README.zh.md) |
| **English README** | [`README.en.md`](./README.en.md) |
| **改造进度** | [`docs/PROGRESS.zh.md`](./docs/PROGRESS.zh.md) |
| **架构总览** | [`docs/architecture-overview.zh.md`](./docs/architecture-overview.zh.md) |
| **包依赖图** | [`docs/package-dependencies.zh.md`](./docs/package-dependencies.zh.md) |
| **各包说明** | [`docs/packages.zh.md`](./docs/packages.zh.md) |
| **设计规范** | [`docs/superpowers/specs/`](./docs/superpowers/specs/) |

---

<p align="center">
  <sub>Built with ❤️ for the Agent era · 穷奇非凶，乃破局之锐</sub>
</p>
