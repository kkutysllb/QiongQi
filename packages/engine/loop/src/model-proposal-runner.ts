import type { ModelClient, ModelRequest, ModelStreamChunk } from '@qiongqi/ports'
import type { ModelProposal } from '@qiongqi/contracts'
import { makeModelProposal, normalizeModelCompletion } from './model-protocol-normalizer.js'

export type ModelProposalRunnerOptions = {
  client: ModelClient
  provider?: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
  onDelta?: (chunk: ModelStreamChunk, request: ModelRequest) => Promise<void> | void
}

export class ModelProposalRunner {
  constructor(private readonly options: ModelProposalRunnerOptions) {}

  async run(request: ModelRequest): Promise<ModelProposal> {
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of this.options.client.stream(request)) {
      chunks.push(chunk)
      await this.options.onDelta?.(chunk, request)
    }
    const completion = await normalizeModelCompletion(chunks, {
      provider: this.options.provider ?? this.options.client.provider,
      model: this.options.client.model,
      endpointFormat: this.options.endpointFormat
    })
    return makeModelProposal(completion, { model: this.options.client.model })
  }
}
