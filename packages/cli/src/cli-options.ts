import { z } from 'zod'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from '@qiongqi/contracts'
import {
  ContextCompactionConfigSchema,
  DEFAULT_QIONGQI_MODEL,
  DEFAULT_STORAGE_CONFIG,
  ModelConfigSchema,
  RuntimeTuningConfigSchema,
  StorageConfigSchema,
  TokenEconomyConfigSchema
} from '@qiongqi/contracts'
import {
  DEFAULT_QIONGQI_CAPABILITIES_CONFIG,
  QiongqiCapabilitiesConfig
} from '@qiongqi/contracts'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  normalizeModelEndpointFormat
} from '@qiongqi/contracts'

export const DEFAULT_SERVE_PORT = 8899
export const DEFAULT_SERVE_MODEL = DEFAULT_QIONGQI_MODEL

/**
 * Built-in agent presets available via `--preset`.
 *
 * - `coding` — injects the coding-focused system prompt and pinned
 *   constraints from `@qiongqi/preset-coding`. This is the default
 *   because the CLI's primary use case is driving an IDE coding
 *   assistant.
 * - `generic` — uses the plain Qiongqi system prompt with no
 *   industry-specific specialisation. Use this when you want a
 *   domain-neutral agent or when you supply your own `systemPrompt`.
 */
export const SERVE_PRESETS = ['coding', 'generic'] as const
export type ServePreset = (typeof SERVE_PRESETS)[number]

/**
 * Validated CLI options for `qiongqi serve`.
 *
 * `host` and `port` decide the bind address. `dataDir` is the on-disk root
 * for thread JSONL logs and indexes. `runtimeToken` is the bearer token
 * the GUI must send for `/v1/*` requests. The optional `insecure` flag
 * disables the token check (only allowed when the GUI is local).
 */
export const ServeOptionsSchema = z.object({
  configPath: z.string().optional(),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65_535).default(DEFAULT_SERVE_PORT),
  dataDir: z.string().min(1),
  runtimeToken: z.string().default(''),
  apiKey: z.string().default(''),
  baseUrl: z.string().default('https://api.deepseek.com/beta'),
  endpointFormat: z.preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS)).default(DEFAULT_MODEL_ENDPOINT_FORMAT),
  model: z.string().default(DEFAULT_SERVE_MODEL),
  approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY),
  sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE),
  tokenEconomyMode: z.boolean().default(false),
  tokenEconomy: TokenEconomyConfigSchema.optional(),
  insecure: z.boolean().default(false),
  storage: StorageConfigSchema.default(DEFAULT_STORAGE_CONFIG),
  models: ModelConfigSchema.optional(),
  contextCompaction: ContextCompactionConfigSchema.optional(),
  runtime: RuntimeTuningConfigSchema.optional(),
  capabilities: QiongqiCapabilitiesConfig.default(DEFAULT_QIONGQI_CAPABILITIES_CONFIG),
  /**
   * Which built-in preset to use for the system prompt and pinned
   * constraints. Defaults to `'coding'`. See {@link SERVE_PRESETS}.
   */
  preset: z.enum(SERVE_PRESETS).default('coding')
})
export type ServeOptions = z.infer<typeof ServeOptionsSchema>

export const DEFAULT_SERVE_OPTIONS: ServeOptions = {
  host: '127.0.0.1',
  port: DEFAULT_SERVE_PORT,
  dataDir: '',
  runtimeToken: '',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/beta',
  endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
  model: DEFAULT_SERVE_MODEL,
  approvalPolicy: DEFAULT_APPROVAL_POLICY,
  sandboxMode: DEFAULT_SANDBOX_MODE,
  tokenEconomyMode: false,
  insecure: false,
  storage: DEFAULT_STORAGE_CONFIG,
  capabilities: DEFAULT_QIONGQI_CAPABILITIES_CONFIG,
  preset: 'coding'
}
