# @qiongqi/cli

> `qiongqi` 命令行入口：`serve` / `run` / `chat` / `exec` / `worker`。
> Layer 9 — 依赖：`@qiongqi/http`、`@qiongqi/contracts`、`@qiongqi/adapter-tools`、`@qiongqi/ports`、`@qiongqi/loop`、`@qiongqi/preset-coding`。

---

## 中文

### 1. 职责

`@qiongqi/cli` 是 Qiongqi 的**用户入口**。`qiongqi` 二进制（`./dist/serve-entry.js`）解析 argv 并分发到 5 个子命令：

- **`qiongqi serve`** —— 启动 HTTP/SSE 运行时（默认子命令）
- **`qiongqi run <prompt>`** —— 单次 agent turn，stdout 流式输出
- **`qiongqi chat`** —— TTY 交互式（`/exit` / `/quit` 退出）
- **`qiongqi exec <tool>`** —— 直接调用工具（`--list-tools` / `--args <json>`）
- **`qiongqi worker`** —— 不启动 HTTP server 的 evented_v2 worker 入口，驱动 outbox reconciler 与 remote agent scheduler；支持 `--once`、daemon、shard、pool supervisor 与 `--deployment-plan`

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `main(argv)` | function (async) | `serve-entry.ts` | CLI 主入口；返回 exit code |
| `QIONGQI_READY_PREFIX` | const | `serve-entry.ts` | `'QIONGQI_READY '`（GUI 握手）|
| `QIONGQI_CLI_USAGE` | const | `agent-cli.ts` | 完整 usage 字符串 |
| `parseServeOptionsSafe(argv, env)` | function | `serve.ts` | Zod 验证的 serve 选项解析 |
| `SERVE_USAGE` | const | `serve.ts` | serve 子命令 usage |
| `qiongqiRuntimeListeningMessage(host, port)` | function | `serve.ts` | "listening on..." 字符串 |
| `ServeExitCode` | const / enum | `serve.ts` | `ok=0` / `usage=64` / `config=78` / `runtime=70` |
| `runAgentCommand(command, args, ctx)` | function | `agent-cli.ts` | 调度 run/chat/exec |
| `splitQiongqiCliCommand(argv)` | function | `agent-cli.ts` | argv → `{ command, args, error? }` |
| `ServeOptionsSchema` / `ServeOptions` | zod / type | `cli-options.ts` | serve 选项 schema |
| `SERVE_PRESETS` / `ServePreset` | const / type | `cli-options.ts` | `['coding', 'generic']` |
| `DEFAULT_SERVE_PORT` | const | `cli-options.ts` | `8899` |
| `DEFAULT_SERVE_MODEL` | const | `cli-options.ts` | `DEFAULT_QIONGQI_MODEL` |

### 3. 关键不变量

- **默认 preset = `coding`**：阶段 1.5 决策；`--preset generic` 用中性 `createQiongqiServeRuntime`。
- **`apiKey` + `baseUrl` 必填**：阶段 1.5 移除默认值；缺失时 exit code 78 + 友好提示（指明 CLI flag / 环境变量 / config 文件三选一）。
- **`apiKey` / `baseUrl` 来源优先级**（在 `parseServeOptionsSafe` 中）：
  1. CLI flag (`--api-key` / `--base-url`)
  2. 环境变量 (`QIONGQI_API_KEY` / `QIONGQI_BASE_URL`)
  3. config 文件
- **退出码**：`ok=0` / `usage=64`（参数错） / `config=78`（配置错） / `runtime=70`（运行时错）。
- **`qiongqi serve` 默认子命令**：argv 第一个参数是 flag 或为空时默认 `serve`。
- **`QIONGQI_READY` 握手**：`serve` 启动后 stdout 写 `QIONGQI_READY <JSON>\n<JSON pretty>\n`；GUI 用此判断就绪。
- **SIGINT/SIGTERM 优雅关闭**：`serve` 注册 `process.once('SIGTERM' | 'SIGINT', () => handle.close())`。
- **TTY-aware chat**：`agent-cli.ts` 用 `process.stdin.isTTY` 判断是否交互；非 TTY 时拒绝 `/chat` 启动。
- **环境变量优先列表**：`QIONGQI_API_KEY` / `QIONGQI_BASE_URL`（首选）+ 旧名 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`（兼容）。
- **`run` 流式输出 `assistant_text_delta`**：实时写 stdout，不缓冲。
- **`exec --list-tools` 列出所有可用工具**（用 in-memory runtime 构建）。
- **`worker --deployment-plan` 不创建 runtime**：只输出稳定 supervisor 命令、shard worker 命令与 probe/metrics 路径，供生产编排模板消费。

### 4. 行为规约

来自 `tests/serve.test.ts` / `tests/agent-cli.test.ts`：

- `qiongqi --help prints SERVE_USAGE and exits 0`
- `qiongqi serve --help prints SERVE_USAGE and exits 0`
- `qiongqi run with missing prompt prints QIONGQI_CLI_USAGE and exits 64`
- `qiongqi serve without --api-key prints friendly error and exits 78`
- `qiongqi serve with --api-key and --base-url starts the HTTP server`
- `qiongqi serve defaults to preset=coding (agentName='Qiongqi Coding')`
- `qiongqi serve --preset generic uses createAgent (agentName='Qiongqi')`
- `qiongqi serve starts within QIONGQI_READY handshake`
- `qiongqi run streams assistant_text_delta to stdout`
- `qiongqi run --json outputs structured events as JSON`
- `qiongqi chat requires TTY; refuses to start in non-interactive mode`
- `qiongqi exec --list-tools lists all available tools`
- `qiongqi worker --once runs evented_v2 outbox and remote-agent scheduler flushes without starting the HTTP server`
- `qiongqi worker --shard-index/--shard-count filters eventedV2AgentPeers before runtime creation for multi-worker agent sharding`
- `qiongqi worker --pool-size starts a local worker supervisor and spawns one child worker per shard`
- `qiongqi worker --deployment-plan prints production worker supervisor commands, shard worker commands, and probe paths without creating runtimes`

### 5. 使用示例

```bash
# 1. 启动运行时
qiongqi serve \
  --data-dir ~/.qiongqi/data \
  --api-key "$DEEPSEEK_API_KEY" \
  --port 8899

# 2. 启动（用 generic preset，agentName='Qiongqi'）
qiongqi serve --preset generic --api-key "$KEY" --base-url "$URL"

# 3. 单次 turn
qiongqi run --api-key "$KEY" --base-url "$URL" "Refactor the auth module"

# 4. JSON 输出
qiongqi run --json --api-key "$KEY" "List files in /work"

# 5. 交互
qiongqi chat --api-key "$KEY"

# 6. 直接工具调用
qiongqi exec --list-tools
qiongqi exec read --args '{"path":"/work/README.md"}'

# 7. evented_v2 worker 部署计划
qiongqi worker \
  --deployment-plan \
  --json \
  --config ./config.json \
  --pool-size auto \
  --restart-backoff-ms 1000 \
  --max-restarts 5
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 9 CLI 层）
- 消费方：用户 / GUI 通过 `qiongqi` 二进制交互
- 源文件：[`serve-entry.ts`](../../packages/cli-layer/cli/src/serve-entry.ts)、[`serve.ts`](../../packages/cli-layer/cli/src/serve.ts)、[`agent-cli.ts`](../../packages/cli-layer/cli/src/agent-cli.ts)、[`cli-options.ts`](../../packages/cli-layer/cli/src/cli-options.ts)、[`index.ts`](../../packages/cli-layer/cli/src/index.ts)
- 测试：[`../../tests/serve.test.ts`](../../tests/serve.test.ts)、[`../../tests/agent-cli.test.ts`](../../tests/agent-cli.test.ts)
