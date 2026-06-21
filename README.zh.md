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
  <a href="./README.en.md">English</a> ·
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-设计哲学">设计哲学</a> ·
  <a href="#-架构">架构</a> ·
  <a href="#-monorepo-包结构">包结构</a> ·
  <a href="./docs/PROGRESS.zh.md">改造进度</a>
</p>

---

> **穷奇非凶，乃破局之锐。** Qiongqi 取意于《山海经》《神异经》《左传》中的"穷奇"——一头"状如虎，有翼"、"知人言语"、敢"毁信废忠"的凶兽。引擎拒绝中央调度寡头，每个 Agent 都是忠于任务的少昊氏不才子；单兵可独立闭环作战，多个 Agent 则在解耦的引擎骨架与外部技能血肉之间自协商达成共识。

---

## 📖 什么是 Qiongqi？

**Qiongqi** 是一个**领域中立的独立多 Agent 框架**，以 **cache-first、去中心化编排**的 HTTP/SSE 引擎为骨架，搭配可插拔的技能与工具体系，面向不同行业组装为生产力工具。

> 穷奇"状如虎，有翼"、"知人言语"——骨架不变，血肉万变。

核心目标：**提高每一 token 的 ROI**。避免重复工具 schema、失控工具输出、畸形历史、无效重试，以及任何可以命中却错过的稳定前缀。

---

## 🐯 设计哲学

三头凶兽，三重主张：

### 1️⃣ 核心哲学：打破"中央集权"的叛逆者

> *"毁信废忠，崇饰恶言。"* ——《左传·文公十八年》

Qiongqi 不设中央调度寡头。回合编排、工具协调、上下文压缩——每个环节都是可替换的 port/adapter 合约。Engine 只是骨架，血肉由外部技能与工具注入。

### 2️⃣ 个体能力：独当一面的"虎翼"

> *"状如虎，有翼，食人。"* ——《山海经·海内北经》

每个 Agent 都是端到端独立的执行单元。单 Agent 可从 prompt 到工具调用到结果返回闭环完成。Skill 系统支持任意粒度的能力封装。

### 3️⃣ 群体智能：懂"人话"的自协商组织

> *"知人言语，闻人斗辄食直者，闻人忠信辄食其鼻。"* ——《神异经》

多 Agent 之间通过解耦的引擎骨架（EventBus、Store、Gate）自协商，而非中央编排。Subagent 委派机制支持分层共识。

---

## 🚀 快速开始

### 依赖

- Node.js 20+
- pnpm 10+

### 安装与构建

```bash
pnpm install
pnpm -r run build
node scripts/flatten-dist.mjs  # 拍平构建产物
```

### 启动运行时

```bash
npx tsx packages/cli/src/serve-entry.ts serve \
  --data-dir ~/.qiongqi/data \
  --api-key "$DEEPSEEK_API_KEY" \
  --port 8899
```

启动后可通过 `http://127.0.0.1:8899` 访问 HTTP API。

### 脚本速查

```bash
pnpm -r run build          # 构建全部 16 个包
pnpm test                  # 全量测试（Vitest）
pnpm test:unit             # 单元测试
pnpm test:integration      # 集成测试
pnpm test:fast             # 快速测试子集
```

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────┐
│                    Client (GUI / CLI)            │
└────────────────────┬────────────────────────────┘
                     │ HTTP / SSE
┌────────────────────▼────────────────────────────┐
│                 @qiongqi/http                    │
│   Router · Auth · SSE · Runtime Factory          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              @qiongqi/loop                       │
│  TurnOrchestrator · PromptBuilder · Policy       │
│  ToolCallCoordinator · ContextCompactor          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              @qiongqi/ports                      │
│  ModelClient · ToolHost · Stores · EventBus      │
│  ApprovalGate · UserInputGate · Workspace        │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           Adapters + Extensions                  │
│  adapter-model · adapter-tools · adapter-storage │
│  skills · memory · attachments · delegation      │
└───────────────────────────────────────────────────┘
```

> 详细架构说明见 [`docs/architecture-overview.zh.md`](./docs/architecture-overview.zh.md)

---

## 📦 Monorepo 包结构

Qiongqi 采用 pnpm monorepo 多包结构，共 16 个独立 npm 包：

| 包 | 职责 |
|---|------|
| `@qiongqi/contracts` | Zod schema + 类型（零依赖基础层） |
| `@qiongqi/domain` | Thread/Turn/Item/Event 实体 |
| `@qiongqi/ports` | ModelClient/ToolHost/Stores 接口 |
| `@qiongqi/cache` | LRU/TTL 缓存、不可变前缀 |
| `@qiongqi/loop` | TurnOrchestrator/PromptBuilder/Policy |
| `@qiongqi/services` | Thread/Turn/Usage 服务 |
| `@qiongqi/adapter-model` | OpenAI 兼容模型客户端 |
| `@qiongqi/adapter-tools` | bash/read/edit/grep + MCP provider |
| `@qiongqi/adapter-storage` | File/Hybrid/SQLite 存储 |
| `@qiongqi/skills` | SkillRuntime + PluginHost |
| `@qiongqi/memory` | 跨会话记忆存储 |
| `@qiongqi/attachments` | 附件管理 |
| `@qiongqi/delegation` | 子代理委派运行时 |
| `@qiongqi/http` | HTTP/SSE 服务器 |
| `@qiongqi/cli` | 命令行入口 |
| `@qiongqi/preset-coding` | 编码预设 |

> 完整依赖关系见 [`docs/package-dependencies.zh.md`](./docs/package-dependencies.zh.md)
> 各包详细说明见 [`docs/packages.zh.md`](./docs/packages.zh.md)

---

## ✨ 特性

### 🔧 Agent Loop
- **Cache-first 编排**：不可变 prompt 前缀 + TTL/LRU 缓存 + inflight 跟踪
- **上下文压缩**：软/硬阈值触发摘要压缩
- **Token 经济**：压缩工具描述与结果
- **Tool Storm Breaker**：抑制同回合重复工具调用
- **Continuation Policy**：智能决策停止/继续/失败

### 🔌 能力矩阵
- **MCP 客户端**：stdio / streamable-http / SSE 传输，BM25 工具搜索
- **Skills 系统**：基于 `skill.json` / `SKILL.md` 的插件化能力注入
- **Subagent 委派**：带并发控制的分层 Agent 调用
- **记忆系统**：跨会话持久化，按作用域检索
- **附件管理**：图片二进制剥离，视觉/文本双通道

### 🌐 服务器
- **HTTP/SSE API**：完整的 `/v1/*` RESTful 路由
- **运行时诊断**：能力清单与工具诊断
- **线程管理**：创建、Fork、Side 线程、事件回放
- **审批门控**：支持多种策略

---

## 📁 项目结构

```
.
├── assets/
│   └── qiongqi.png               # 项目封面图
├── docs/                          # 技术文档（中英双语）
│   ├── PROGRESS.zh.md            # 改造进度（中文）
│   ├── PROGRESS.en.md            # Refactoring progress (English)
│   ├── architecture-overview.*   # 架构总览
│   ├── package-dependencies.*    # 包依赖图
│   └── packages.*                # 各包说明
├── packages/                      # 16 个 @qiongqi/* 包
│   ├── contracts/
│   ├── domain/
│   ├── ports/
│   ├── cache/
│   ├── loop/
│   ├── services/
│   ├── adapter-model/
│   ├── adapter-tools/
│   ├── adapter-storage/
│   ├── skills/
│   ├── memory/
│   ├── attachments/
│   ├── delegation/
│   ├── http/
│   ├── cli/
│   └── preset-coding/
├── tests/                         # 全量测试套件（53 文件，433 测试）
├── scripts/                       # 迁移与构建辅助脚本
├── pnpm-workspace.yaml
├── vitest.config.ts
└── package.json
```

---

## 📚 相关文档

| 文档 | 位置 |
|------|------|
| **改造进度** | [`docs/PROGRESS.zh.md`](./docs/PROGRESS.zh.md) |
| **架构总览** | [`docs/architecture-overview.zh.md`](./docs/architecture-overview.zh.md) |
| **包依赖图** | [`docs/package-dependencies.zh.md`](./docs/package-dependencies.zh.md) |
| **各包说明** | [`docs/packages.zh.md`](./docs/packages.zh.md) |
| **设计哲学** | [`docs/superpowers/specs/`](./docs/superpowers/specs/) |
| **英文 README** | [`README.en.md`](./README.en.md) |

---

## 🗺️ 改造路线

Qiongqi 正在进行四阶段架构改造，当前处于阶段 1：

| 阶段 | 目标 | 状态 |
|------|------|------|
| **阶段 1** | SDK 抽离 + monorepo 拆包 | 进行中 |
| **阶段 2** | AgentCard + AgentIdentity | 待开始 |
| **阶段 3** | TurnOrchestrator 事件化 | 待开始 |
| **阶段 4** | A2A 协议端点 | 待开始 |

详细进度见 [`docs/PROGRESS.zh.md`](./docs/PROGRESS.zh.md)。

---

<p align="center">
  <sub>Built with ❤️ for the Agent era · 穷奇非凶，乃破局之锐</sub>
</p>
