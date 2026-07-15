import type { ExecutionGraph } from './execution-graph.js'

export function productionKernelV3Graph(): ExecutionGraph {
  return {
    version: 'kernel-v3-production-v1',
    startNodeId: 'prepare-turn',
    predicates: [
      'next',
      'final',
      'tools',
      'recover',
      'wait',
      'fatal',
      'tools_committed',
      'recovered'
    ],
    nodes: [
      { id: 'prepare-turn', kind: 'prepare_turn', effect: 'state', checkpoint: 'both' },
      { id: 'restore-task', kind: 'restore_task', effect: 'state', checkpoint: 'both' },
      { id: 'build-context', kind: 'build_context', effect: 'pure', checkpoint: 'after' },
      { id: 'invoke-model', kind: 'invoke_model', effect: 'model', checkpoint: 'both' },
      { id: 'normalize-proposal', kind: 'normalize_proposal', effect: 'pure', checkpoint: 'after' },
      { id: 'evaluate', kind: 'evaluate', effect: 'pure', checkpoint: 'after' },
      { id: 'commit-assistant', kind: 'commit_assistant', effect: 'state', terminal: true, checkpoint: 'both' },
      { id: 'prepare-tools', kind: 'prepare_tools', effect: 'state', checkpoint: 'both' },
      { id: 'commit-tools', kind: 'commit_tools', effect: 'tool', checkpoint: 'both' },
      { id: 'recover-context', kind: 'recover_context', effect: 'state', checkpoint: 'both' },
      { id: 'wait-user', kind: 'wait_user', effect: 'state', terminal: true, checkpoint: 'both' },
      { id: 'fail', kind: 'fail', effect: 'state', terminal: true, checkpoint: 'both' }
    ],
    edges: [
      { from: 'prepare-turn', to: 'restore-task', when: 'next' },
      { from: 'restore-task', to: 'build-context', when: 'next' },
      { from: 'build-context', to: 'invoke-model', when: 'next' },
      { from: 'invoke-model', to: 'normalize-proposal', when: 'next' },
      { from: 'normalize-proposal', to: 'evaluate', when: 'next' },
      { from: 'evaluate', to: 'commit-assistant', when: 'final' },
      { from: 'evaluate', to: 'prepare-tools', when: 'tools' },
      { from: 'evaluate', to: 'recover-context', when: 'recover' },
      { from: 'evaluate', to: 'wait-user', when: 'wait' },
      { from: 'evaluate', to: 'fail', when: 'fatal' },
      { from: 'prepare-tools', to: 'commit-tools', when: 'next' },
      { from: 'commit-tools', to: 'build-context', when: 'tools_committed', loop: true },
      { from: 'recover-context', to: 'build-context', when: 'recovered', loop: true }
    ]
  }
}
