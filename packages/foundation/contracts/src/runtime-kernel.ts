import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)
export const RunStatusSchema = z.enum(['created', 'running', 'suspended', 'completed', 'degraded', 'failed', 'aborted'])
export type RunStatus = z.infer<typeof RunStatusSchema>
export const RunOutcomeReasonSchema = z.enum([
  'normal_stop', 'awaiting_user_input', 'tool_completed_no_final_text', 'context_recovery_exhausted',
  'loop_capped', 'step_capped', 'token_capped', 'cost_capped', 'provider_safety_stop',
  'provider_protocol_error', 'required_action_missing', 'tool_failed', 'user_aborted', 'runtime_error'
])
export type RunOutcomeReason = z.infer<typeof RunOutcomeReasonSchema>
export const RunIdentitySchema = z.object({
  ownerUserId: NonEmptyString, threadId: NonEmptyString, turnId: NonEmptyString,
  runId: NonEmptyString, workspaceKey: NonEmptyString
}).strict()
export type RunIdentity = z.infer<typeof RunIdentitySchema>
export const ScopePurposeSchema = z.enum(['runtime', 'memory', 'skill', 'tool', 'observability'])
export type ScopePurpose = z.infer<typeof ScopePurposeSchema>
export const ScopeKeySchema = z.object({
  ownerUserId: NonEmptyString, tenantId: NonEmptyString.optional(), workspaceKey: NonEmptyString.optional(),
  threadId: NonEmptyString.optional(), turnId: NonEmptyString.optional(), runId: NonEmptyString.optional(),
  purpose: ScopePurposeSchema
}).strict()
export type ScopeKey = z.infer<typeof ScopeKeySchema>
export const BudgetStateSchema = z.object({
  stepsUsed: z.number().int().nonnegative().default(0), toolCallsUsed: z.number().int().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().default(0), outputTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0)
}).strict()
export type BudgetState = z.infer<typeof BudgetStateSchema>
export const RecoveryStateSchema = z.object({
  attempts: z.number().int().nonnegative().default(0), maxAttempts: z.number().int().nonnegative().default(1),
  lastReason: z.string().optional()
}).strict()
export type RecoveryState = z.infer<typeof RecoveryStateSchema>
export const EffectIntentSchema = z.object({
  idempotencyKey: NonEmptyString, kind: z.enum(['model', 'tool', 'approval', 'user-input', 'item']),
  effect: z.enum(['read', 'idempotent-write', 'non-idempotent-write']), replay: z.enum(['safe', 'verify-first', 'never']),
  target: NonEmptyString, payloadDigest: NonEmptyString, preparedAt: NonEmptyString
}).strict()
export type EffectIntent = z.infer<typeof EffectIntentSchema>
export const CommittedEffectRefSchema = z.object({
  idempotencyKey: NonEmptyString, resultDigest: NonEmptyString,
  status: z.enum(['committed', 'verified', 'failed']), resultRef: z.string().optional(), committedAt: NonEmptyString
}).strict()
export type CommittedEffectRef = z.infer<typeof CommittedEffectRefSchema>
export const MiddlewareStateSchema = z.object({ version: z.number().int().positive(), data: z.unknown() }).strict()
export type MiddlewareState = z.infer<typeof MiddlewareStateSchema>
export const RunOutcomeSchema = z.object({
  status: z.enum(['completed', 'degraded', 'failed', 'aborted', 'suspended']), reason: RunOutcomeReasonSchema,
  userVisibleItemId: NonEmptyString.optional(), retryable: z.boolean(), details: z.record(z.string(), z.unknown()).optional()
}).strict()
export type RunOutcome = z.infer<typeof RunOutcomeSchema>
export const RunStateV3Schema = z.object({
  version: z.literal(3), graphVersion: NonEmptyString, runtimeMode: z.literal('kernel_v3'),
  ownerUserId: NonEmptyString, threadId: NonEmptyString, turnId: NonEmptyString, runId: NonEmptyString,
  parentRunId: NonEmptyString.optional(), workspaceKey: NonEmptyString, status: RunStatusSchema,
  cursor: z.object({ stepIndex: z.number().int().nonnegative(), nodeId: NonEmptyString, attempt: z.number().int().nonnegative(), checkpointSeq: z.number().int().nonnegative() }).strict(),
  budgets: BudgetStateSchema, recovery: RecoveryStateSchema, middleware: z.record(z.string(), MiddlewareStateSchema),
  pendingEffects: z.array(EffectIntentSchema), committedEffects: z.array(CommittedEffectRefSchema), outcome: RunOutcomeSchema.optional(),
  createdAt: NonEmptyString, updatedAt: NonEmptyString
}).strict()
export type RunStateV3 = z.infer<typeof RunStateV3Schema>
export const RunEventEnvelopeSchema = z.object({
  eventId: NonEmptyString, seq: z.number().int().positive(), ownerUserId: NonEmptyString, threadId: NonEmptyString,
  turnId: NonEmptyString, runId: NonEmptyString, stepId: NonEmptyString.optional(), nodeAttemptId: NonEmptyString.optional(),
  eventType: NonEmptyString, idempotencyKey: NonEmptyString.optional(), payload: z.unknown(), timestamp: NonEmptyString
}).strict()
export type RunEventEnvelope = z.infer<typeof RunEventEnvelopeSchema>
export const ToolEffectPolicySchema = z.object({
  effect: z.enum(['read', 'idempotent-write', 'non-idempotent-write']), replay: z.enum(['safe', 'verify-first', 'never']), concurrencyKey: NonEmptyString.optional()
}).strict()
export type ToolEffectPolicy = z.infer<typeof ToolEffectPolicySchema>
export function makeRunIdentity(input: unknown): RunIdentity { return RunIdentitySchema.parse(input) }
export function makeRunOutcome(input: unknown): RunOutcome { return RunOutcomeSchema.parse(input) }
export function encodeScopeKey(input: ScopeKey): string {
  const scope = ScopeKeySchema.parse(input)
  const fields: Array<keyof ScopeKey> = ['ownerUserId', 'tenantId', 'workspaceKey', 'threadId', 'turnId', 'runId', 'purpose']
  return fields.map((field) => `${field}=${encodeURIComponent(scope[field] ?? '')}`).join('|')
}
