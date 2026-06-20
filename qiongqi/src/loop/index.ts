export * from './turn-orchestrator.js'
export * from './inflight-tracker.js'
export * from './steering-queue.js'
export * from './context-compactor.js'
export * from './context-estimator.js'
export * from './model-context-profile.js'
export * from './token-economy.js'
export * from './request-history-hygiene.js'
export * from './tool-storm-breaker.js'
export * from './loop-helpers.js'
export * from './loop-events.js'
export * from './tool-call-coordinator.js'
export * from './model-step-runner.js'
export * from './prompt-builder.js'
export * from './continuation-policy.js'

/**
 * @deprecated Use `TurnOrchestrator` directly. The `AgentLoop` alias is kept
 * only so embedders that import it from the package public surface can switch
 * over without a hard break. It will be removed in a follow-up cleanup.
 */
export {
  TurnOrchestrator as AgentLoop,
  type TurnOrchestratorOptions as AgentLoopOptions
} from './turn-orchestrator.js'
