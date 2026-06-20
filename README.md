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
  <a href="#-quick-start">快速开始</a> ·
  <a href="#-philosophy">设计哲学</a> ·
  <a href="#-architecture">架构</a> ·
  <a href="#-features">特性</a> ·
  <a href="#-configuration">配置</a> ·
  <a href="#-ecosystem">生态</a>
</p>

---

> **穷奇非凶，乃破局之锐。** Qiongqi 取意于《山海经》《神异经》《左传》中的"穷奇"——一头"状如虎，有翼"、"知人言语"、敢"毁信废忠"的凶兽。引擎拒绝中央调度寡头，每个 Agent 都是忠于任务的少昊氏不才子；单兵可独立闭环作战，多个 Agent 则在解耦的引擎骨架与外部技能血肉之间自协商达成共识。完整设计哲学见 [`qiongqi/DESIGN.md`](./qiongqi/DESIGN.md)。

---

## 📖 什么是 Qiongqi？

**Qiongqi** 是一个**独立的多 Agent 框架**，以 **cache-first、去中心化编排**的 HTTP/SSE 引擎为骨架，搭配可插拔的技能与工具体系，面向不同行业组装为生产力工具。

> 穷奇"状如虎，有翼"、"知人言语"——骨架不变，血肉万变。

它不是把模型回复包一层 UI 的薄壳，也不是绑定某个 IDE 的附属品。Qiongqi 让 Agent 能够：

- **长期携带项目上下文**，跨会话维持记忆与状态
- **稳定调用工具**，通过 MCP、内置工具、技能系统形成能力矩阵
- **恢复会话**，通过追加式 JSONL 日志与原子化索引实现回放
- **复用同一套 Agent Loop**，在桌面 IDE、写作、手机连接和定时任务之间无缝切换

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

> 设计哲学完整阐述与现状自评见 **[`qiongqi/DESIGN.md`](./qiongqi/DESIGN.md)**。



---

## 🚀 Quick Start

### 依赖

- Node.js 20+
- npm

### 安装与构建

```bash
cd qiongqi
npm install
npm run build
```

### 启动运行时

```bash
qiongqi serve \
  --data-dir ~/.kcoder/qiongqi \
  --api-key "$DEEPSEEK_API_KEY" \
  --port 8899
```

启动后可通过 `http://127.0.0.1:8899` 访问 HTTP API。

### 脚本速查

```bash
# 类型检查
npm run typecheck

# 运行测试（Vitest）
npm run test

# 构建
npm run build

# 开发模式（监听重建）
npm run dev
```

> 详细 CLI 用法、配置项与环境变量请参考 **[`qiongqi/README.md`](./qiongqi/README.md)**。

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────┐
│                    Client (GUI / CLI)            │
└────────────────────┬────────────────────────────┘
                     │ HTTP / SSE
┌────────────────────▼────────────────────────────┐
│                 Server Layer                      │
│   Router · Auth · SSE · Runtime Factory          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              Turn Orchestrator                    │
│  ┌──────────┐  ┌──────────────┐                 │
│  │ Prompt   │→ │ Model Step   │→ Continuation   │
│  │ Builder  │  │ Runner       │   Policy         │
│  └──────────┘  └──────┬───────┘                 │
│                        │                         │
│  ┌─────────────────────▼──────────────────┐     │
│  │         Tool Call Coordinator           │     │
│  │  MCP · Built-in · Web · Skills · Agents │     │
│  └─────────────────────────────────────────┘     │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              Ports & Adapters                     │
│  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐  │
│  │Model   │ │Thread    │ │Session   │ │Event │  │
│  │Client  │ │Store     │ │Store     │ │Bus   │  │
│  └────────┘ └──────────┘ └──────────┘ └──────┘  │
│  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐  │
│  │Tool    │ │Approval  │ │UserInput │ │Work-  │  │
│  │Host    │ │Gate      │ │Gate      │ │space  │  │
│  └────────┘ └──────────┘ └──────────┘ └──────┘  │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              Infrastructure                       │
│  Cache · Telemetry · Services · Memory · Skills  │
└───────────────────────────────────────────────────┘
```

### 模块分层

| 层级 | 目录 | 职责 |
|------|------|------|
| **Contracts** | `src/contracts/` | HTTP/SSE 合约的 Zod schema 与派生类型 |
| **Domain** | `src/domain/` | Thread、Turn、Item、Event、Approval、Usage 实体 |
| **Ports** | `src/ports/` | ModelClient、ToolHost、Stores、EventBus、Gates |
| **Adapters** | `src/adapters/` | DeepSeek 模型客户端、工具宿主、存储实现 |
| **Loop** | `src/loop/` | Cache-first Agent Loop、编排、压缩、token 经济 |
| **Server** | `src/server/` | HTTP 路由、鉴权、SSE 流、运行时工厂 |
| **Services** | `src/services/` | 线程/回合/用量/审查服务 |
| **Cache** | `src/cache/` | LRU/TTL 缓存、不可变前缀、工具指纹 |
| **Skills** | `src/skills/` | Skill 运行时（支持 skill.json / SKILL.md） |
| **Telemetry** | `src/telemetry/` | 用量、缓存与成本指标 |

---

## ✨ 特性

### 🔧 Agent Loop
- **Cache-first 编排**：不可变 prompt 前缀 + 边界受限的 TTL/LRU 缓存 + inflight 跟踪
- **上下文压缩**：软/硬阈值触发摘要压缩，保留目标、约束、决策和未解决事项
- **Token 经济**：压缩工具描述与结果，去除重复 schema 和失控输出
- **Tool Storm Breaker**：抑制同回合重复工具调用，防止死循环烧 token
- **Continuation Policy**：智能决策停止/继续/失败/计划物化

### 🔌 能力矩阵
- **MCP 客户端**：stdio / streamable-http / SSE 传输，支持 BM25 工具搜索
- **Web 工具**：内置 HTTP(S) 抓取，可扩展搜索 provider
- **Skills 系统**：基于 `skill.json` / `SKILL.md` 的插件化能力注入
- **Subagent 委派**：带并发控制的分层 Agent 调用
- **记忆系统**：跨会话持久化，按作用域检索并注入上下文
- **附件管理**：图片二进制剥离，视觉/文本模型双通道处理

### 🌐 服务器
- **HTTP/SSE API**：完整的 `/v1/*` RESTful 路由
- **运行时诊断**：能力清单 (`/v1/runtime/info`) 与工具诊断 (`/v1/runtime/tools`)
- **线程管理**：创建、Fork、Side 线程、事件回放
- **审批门控**：支持 `auto` / `on-request` / `untrusted` / `never` / `suggest` 策略

### 📦 存储
- **混合存储**：JSONL 追加日志 + SQLite 索引的双引擎模式
- **原子写入**：index / thread / session JSON 的原子更新
- **可回放性**：即使包含部分格式错误行，JSONL 也可跳过继续回放

---

## ⚙️ 配置

Qiongqi 使用 JSON 配置文件管理运行时行为，配置优先级：

```
内置默认值 < JSON 配置文件 < 环境变量 < CLI 参数
```

```bash
# 通过 CLI 启动时指定配置
qiongqi serve --config ~/.kcoder/qiongqi/config.json

# 通过环境变量
QIONGQI_CONFIG=~/.kcoder/qiongqi/config.json qiongqi serve
```

> 完整配置项说明见 **[`qiongqi/README.md`](./qiongqi/README.md#配置文件)**，示例文件见 **[`qiongqi/config.example.json`](./qiongqi/config.example.json)**。

---

## 🌿 生态

### 内置 Skills

Qiongqi 自带一套开箱即用的技能，涵盖日常开发工作流：

| 技能 | 目录 | 用途 |
|------|------|------|
| **Code Review** | `skills/code-review/` | 代码变更审查 |
| **Debugging** | `skills/debugging/` | 系统化问题定位 |
| **Planning** | `skills/planning/` | 多步骤任务规划 |
| **TDD** | `skills/tdd/` | 测试驱动开发 |
| **Refactoring** | `skills/refactoring/` | 代码重构 |
| **Security Review** | `skills/security-review/` | 安全审计 |
| **Web** | `skills/web/` | Web 应用构建 |
| **Todo** | `skills/todo/` | 任务管理 |
| **Goal** | `skills/goal/` | 目标驱动开发 |
| **Git Worktrees** | `skills/git-worktrees/` | Git 工作树管理 |

### 集成方式

- **IDE 集成**：通过 GUI 主进程启动 Qiongqi 运行时
- **独立运行**：`qiongqi run` / `qiongqi chat` / `qiongqi exec`
- **远程连接**：通过 HTTP/SSE 协议远程调用

---

## 📁 项目结构

```
.
├── assets/
│   └── qiongqi.png          # 项目封面图
├── docs/superpowers/specs/  # 设计规范文档
└── qiongqi/                 # 核心包
    ├── src/                 # 源代码
    │   ├── cli/             # 命令行入口
    │   ├── contracts/       # HTTP 合约（Zod）
    │   ├── domain/          # 领域实体
    │   ├── ports/           # 端口定义
    │   ├── adapters/        # 适配器实现
    │   ├── services/        # 编排服务
    │   ├── loop/            # Agent Loop
    │   ├── cache/           # 缓存工具
    │   ├── server/          # HTTP 服务器
    │   ├── skills/          # Skill 运行时
    │   ├── telemetry/       # 遥测指标
    │   ├── memory/          # 记忆系统
    │   └── attachments/     # 附件管理
    ├── tests/               # 测试套件
    └── scripts/             # 辅助脚本
```

---

## 📚 相关文档

| 文档 | 位置 |
|------|------|
| **完整用户手册**（CLI、配置、API、存储布局） | [`qiongqi/README.md`](./qiongqi/README.md) |
| **设计哲学**（神话原型、主张映射、差距待办） | [`qiongqi/DESIGN.md`](./qiongqi/DESIGN.md) |
| **设计规范** | [`docs/superpowers/specs/`](./docs/superpowers/specs/) |
| **配置示例** | [`qiongqi/config.example.json`](./qiongqi/config.example.json) |

---

<p align="center">
  <sub>Built with ❤️ for the Agent era · 穷奇非凶，乃破局之锐</sub>
</p>
