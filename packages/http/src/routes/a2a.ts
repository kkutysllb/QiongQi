import { PeerArtifactSchema, PeerTaskSchema } from '@qiongqi/contracts'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Stage 2: A2A (Agent-to-Agent) task submission endpoint.
 *
 * Receives a {@link PeerTask} from a remote peer and executes it by
 * creating a new thread + running one turn against this agent's
 * runtime. Returns a {@link PeerArtifact} with the turn result.
 *
 * The endpoint is **authenticated** (unlike the AgentCard discovery
 * endpoint) — only trusted peers should be able to consume agent
 * resources. Authentication is the same bearer-token scheme used by
 * all `/v1/*` endpoints.
 *
 * ## Protocol contract
 *
 * - **Request**: `POST /a2a` with JSON body conforming to
 *   {@link PeerTaskSchema}.
 * - **Response**: `200` with {@link PeerArtifactSchema} on success;
 *   `400` on invalid body; `503` when runTurn is unavailable.
 */
export async function a2aTaskHandler(
  runtime: ServerRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) {
    return { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'invalid request body' }) }
  }
  const parsedTask = PeerTaskSchema.safeParse(body.value)
  if (!parsedTask.success) {
    return {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'invalid peer task',
        issues: parsedTask.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      })
    }
  }
  const task = parsedTask.data

  if (!runtime.runTurn) {
    return {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'turn execution unavailable' })
    }
  }

  try {
    // Create a temporary thread for the peer's task, run one turn,
    // and collect the result. The thread is intentionally short-lived —
    // peers don't persist state across A2A calls (they bring their own).
    const thread = await runtime.threadService.create({
      title: task.label ?? `A2A peer task: ${task.prompt.slice(0, 60)}`,
      workspace: task.workspace ?? '~',
      model: task.model ?? runtime.info().model ?? 'default',
      mode: 'agent',
      approvalPolicy: runtime.info().approvalPolicy ?? 'auto',
      sandboxMode: runtime.info().sandboxMode
    })

    const started = await runtime.turnService.startTurn({
      threadId: thread.id,
      request: {
        prompt: task.prompt,
        model: task.model,
        mode: 'agent'
      }
    })

    const status = await runtime.runTurn(thread.id, started.turnId)

    // Collect the assistant text from the turn's items for the summary.
    const items = await runtime.sessionStore.loadItems(thread.id)
    const turnItems = items.filter((item) => item.turnId === started.turnId)
    const summary = turnItems
      .filter((item): item is Extract<typeof turnItems[0], { kind: 'assistant_text' }> => item.kind === 'assistant_text')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n\n')
      .trim() || undefined

    const errorItem = turnItems.find(
      (item): item is Extract<typeof turnItems[0], { kind: 'error' }> => item.kind === 'error'
    )

    const artifact = PeerArtifactSchema.parse({
      peerCardId: runtime.agentCard?.id ?? 'unknown',
      status,
      ...(summary ? { summary } : {}),
      ...(errorItem ? { error: errorItem.message } : {}),
      ...(status === 'failed' && !errorItem ? { error: 'Turn failed without error item' } : {})
    })

    return jsonResponse(artifact)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: message })
    }
  }
}
