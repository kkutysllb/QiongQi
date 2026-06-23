import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { VirtualPathResolver } from '@qiongqi/attachments'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

export async function listThreadArtifacts(
  runtime: ServerRuntime,
  threadId: string
): Promise<JsonResponse> {
  const resolver = resolverForThread(runtime, threadId)
  const outputsDir = join(threadRoot(runtime, threadId), 'outputs')
  const entries = await readdir(outputsDir, { withFileTypes: true }).catch(() => [])
  const artifacts = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const absolutePath = join(outputsDir, entry.name)
    const info = await stat(absolutePath).catch(() => null)
    const virtualPath = await resolver.toVirtualPath(absolutePath)
    if (!info || !virtualPath) continue
    artifacts.push({
      name: entry.name,
      byteSize: info.size,
      virtualPath,
      updatedAt: info.mtime.toISOString()
    })
  }
  artifacts.sort((a, b) => a.name.localeCompare(b.name))
  return jsonResponse({ threadId, artifacts })
}

export async function readThreadArtifact(
  runtime: ServerRuntime,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const path = new URL(request.url).searchParams.get('path')
  if (!path) return ERRORS.validation('artifact path is required')
  const resolver = resolverForThread(runtime, threadId)
  try {
    const resolved = await resolver.resolve(path)
    if (resolved.mount !== 'outputs' && resolved.mount !== 'artifacts' && resolved.mount !== 'uploads') {
      return ERRORS.forbidden('artifact path must target uploads, outputs, or artifacts')
    }
    const data = await readFile(resolved.absolutePath)
    return new Response(data, {
      status: 200,
      headers: {
        'content-type': contentTypeForPath(resolved.absolutePath),
        'content-disposition': `inline; filename="${basename(resolved.absolutePath).replace(/"/g, '')}"`
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/escapes|unsupported/i.test(message)) return ERRORS.forbidden(message)
    return ERRORS.notFound(message)
  }
}

function resolverForThread(runtime: ServerRuntime, threadId: string): VirtualPathResolver {
  const root = threadRoot(runtime, threadId)
  return new VirtualPathResolver({
    workspaceDir: join(root, 'workspace'),
    uploadsDir: join(root, 'uploads'),
    outputsDir: join(root, 'outputs'),
    artifactsDir: join(root, 'artifacts')
  })
}

function threadRoot(runtime: ServerRuntime, threadId: string): string {
  return join(runtime.info().dataDir, 'threads', threadId)
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  if (lower.endsWith('.md')) return 'text/markdown; charset=utf-8'
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'text/plain; charset=utf-8'
}
