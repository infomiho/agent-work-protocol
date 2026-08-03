import {
  assessmentOutcome,
  formatRevisionEtag,
  parseRevisionPrecondition,
  type JsonValue,
  type ProtocolRequest,
  type ProtocolResponse,
  type RevisionPrecondition,
  type WorkAssessment,
  type WorkModel,
} from './contract'
import { createRevisionIntake, type CommitPolicy } from './intake'
import type { JsonPatchLimits } from './json-patch'
import { cloneJson, isJsonValue } from './json'
import { createModelDocs } from './docs'
import { renderSessionBriefing } from './handoff'
import { privateResponseHeaders, protocolProblem } from './problems'
import type { JsonPatchOperation, RevisionStore, RevisionTarget } from './revision'
import {
  buildSessionUrl,
  mintCapability,
  resolveSession,
  sessionLifetimeMs,
  type CapabilitySession,
  type SessionStore,
} from './session'

export const createAgentWorkProtocol = <TDocument extends JsonValue, TArtifacts, TAuthority>(options: {
  model: WorkModel<TDocument, TArtifacts>
  sessions: SessionStore<TAuthority>
  revisions: RevisionStore<TDocument, TAuthority>
  policy: CommitPolicy<TArtifacts>
  serverUrl: string
  productName?: string
  previewUrl?: (capability: string) => string
  sessionTtlMs?: number
  patchLimits?: Partial<JsonPatchLimits>
  revisionCommitted?: (event: {
    target: RevisionTarget
    revision: number
    document: TDocument
    assessment: WorkAssessment<TArtifacts>
  }) => void | Promise<void>
  authoringGuidance?: string
}) => {
  const serverUrl = options.serverUrl.replace(/\/$/, '')
  const intake = createRevisionIntake({
    model: options.model,
    store: options.revisions,
    policy: options.policy,
    patchLimits: options.patchLimits,
  })
  const docs = createModelDocs({
    model: options.model,
    serverUrl,
    productName: options.productName,
    authoringGuidance: options.authoringGuidance,
  })

  const resolve = async (capability: string) => {
    if (!isCapability(capability)) return { ok: false, response: protocolProblem('session-not-found') } as const
    const resolved = await resolveSession(options.sessions, capability)
    if (resolved.kind === 'not-found') return { ok: false, response: protocolProblem('session-not-found') } as const
    if (resolved.kind === 'expired') return { ok: false, response: protocolProblem('session-expired') } as const
    if (resolved.session.target.model !== options.model.id || resolved.session.target.version !== options.model.version) {
      return { ok: false, response: protocolProblem('work-not-found', { detail: 'The session does not target this model.' }) } as const
    }
    return { ok: true, session: resolved.session } as const
  }

  const readAuthorized = async (session: CapabilitySession<TAuthority>) => {
    const current = await intake.read({ target: session.target, authority: session.authority })
    if (current.kind === 'authority-rejected') return { ok: false, response: authorityProblem(current.reason) } as const
    if (current.kind === 'target-not-found') return { ok: false, response: protocolProblem('work-not-found') } as const
    if (current.kind === 'stored-work-unreadable') {
      return {
        ok: false,
        response: protocolProblem('stored-work-unreadable', { extensions: { diagnostics: wireDiagnostics(current.diagnostics) } }),
      } as const
    }
    return { ok: true, current } as const
  }

  const handleSessionRequest = async (request: { capability: string }): Promise<ProtocolResponse> => {
    const active = await resolve(request.capability)
    if (!active.ok) return active.response
    const readable = await readAuthorized(active.session)
    if (!readable.ok) return readable.response
    return {
      status: 200,
      headers: privateResponseHeaders({ 'Content-Type': 'text/markdown; charset=utf-8' }),
      content: {
        type: 'markdown',
        body: renderSessionBriefing({
          productName: options.productName ?? options.model.authoring.title,
          sessionUrl: buildSessionUrl(serverUrl, request.capability),
          expiresAt: active.session.expiresAt,
          docs: docs.paths,
        }),
      },
    }
  }

  const handleWorkRequest = async (request: ProtocolRequest): Promise<ProtocolResponse> => {
    const method = request.method.toUpperCase()
    if (!['GET', 'HEAD', 'PUT', 'PATCH'].includes(method)) {
      return protocolProblem('method-not-allowed', { headers: { Allow: 'GET, HEAD, PUT, PATCH' } })
    }
    const active = await resolve(request.capability)
    if (!active.ok) return active.response
    const { session } = active

    if (method === 'GET' || method === 'HEAD') {
      const readable = await readAuthorized(session)
      if (!readable.ok) return readable.response
      await options.sessions.touch(session.id)
      const { current } = readable
      const headers = privateResponseHeaders({ ETag: formatRevisionEtag(current.revision), 'Content-Type': 'application/json' })
      if (method === 'HEAD') return { status: 200, headers, content: { type: 'none' } }
      return {
        status: 200,
        headers,
        content: {
          type: 'json',
          body: {
            model: session.target.model,
            version: session.target.version,
            documentId: session.target.document,
            revision: current.revision,
            document: cloneJson(current.document),
            assessment: wireAssessment(current.assessment),
            ...preview(options.previewUrl, request.capability),
          },
        },
      }
    }

    const representationProblem = validateRepresentation(method, request)
    if (representationProblem) return representationProblem
    const expectedRevision = readIfMatch(request.headers)
    if (expectedRevision === undefined) return protocolProblem('if-match-required')
    if (expectedRevision === null) return protocolProblem('invalid-if-match')

    const outcome = await intake.commit({
      target: session.target,
      authority: session.authority,
      expectedRevision,
      edit: method === 'PUT'
        ? { kind: 'replace', document: request.body as TDocument }
        : { kind: 'patch', operations: request.body as JsonPatchOperation[] },
    })
    if (outcome.kind === 'conflict') {
      return protocolProblem('revision-conflict', {
        extensions: outcome.currentRevision === null ? {} : { currentRevision: outcome.currentRevision },
      })
    }
    if (outcome.kind === 'target-not-found') return protocolProblem('work-not-found')
    if (outcome.kind === 'authority-rejected') return authorityProblem(outcome.reason)
    if (outcome.kind === 'stored-work-unreadable') {
      return protocolProblem('stored-work-unreadable', { extensions: { diagnostics: wireDiagnostics(outcome.diagnostics) } })
    }
    if (outcome.kind === 'schema-rejected') {
      return protocolProblem('schema-rejected', { extensions: { diagnostics: wireDiagnostics(outcome.diagnostics) } })
    }
    if (outcome.kind === 'work-rejected') {
      return protocolProblem('work-rejected', { extensions: { assessment: wireAssessment(outcome.assessment) } })
    }
    if (outcome.kind === 'edit-rejected') {
      return protocolProblem('patch-rejected', {
        detail: outcome.error.message,
        extensions: {
          patchCode: outcome.error.code,
          ...(outcome.error.operation === undefined ? {} : { operation: outcome.error.operation }),
        },
      })
    }

    notifyObserver(options.revisionCommitted, {
      target: session.target,
      revision: outcome.revision,
      document: outcome.document,
      assessment: outcome.assessment,
    })
    return {
      status: 200,
      headers: privateResponseHeaders({ ETag: formatRevisionEtag(outcome.revision), 'Content-Type': 'application/json' }),
      content: {
        type: 'json',
        body: {
          revision: outcome.revision,
          document: cloneJson(outcome.document),
          assessment: wireAssessment(outcome.assessment),
          ...preview(options.previewUrl, request.capability),
        },
      },
    }
  }

  return {
    mintSession: (now?: Date) => mintCapability(serverUrl, now, options.sessionTtlMs ?? sessionLifetimeMs),
    handleSessionRequest,
    handleWorkRequest,
    handleDocsRequest: docs.handleDocsRequest,
    buildSessionUrl: (capability: string) => buildSessionUrl(serverUrl, capability),
  }
}

const isCapability = (value: string) => value.length >= 32 && value.length <= 128

const wireAssessment = (assessment: { diagnostics: readonly import('./contract').Diagnostic[] }) => ({
  outcome: assessmentOutcome(assessment),
  diagnostics: wireDiagnostics(assessment.diagnostics),
})

const wireDiagnostics = (diagnostics: readonly import('./contract').Diagnostic[]) => diagnostics.map((diagnostic) => ({
  severity: diagnostic.severity,
  code: diagnostic.code,
  message: diagnostic.message,
  pointer: diagnostic.pointer,
  ...(diagnostic.help === undefined ? {} : { help: diagnostic.help }),
}))

const readIfMatch = (headers: Record<string, string | undefined> | undefined): RevisionPrecondition | null | undefined => {
  const value = headers?.['if-match'] ?? headers?.['If-Match']
  return value === undefined ? undefined : parseRevisionPrecondition(value)
}

const mediaType = (contentType: string | undefined) => contentType?.split(';', 1)[0]?.trim().toLowerCase()

const validateRepresentation = (method: string, request: ProtocolRequest): ProtocolResponse | null => {
  if (method === 'PUT') {
    if (mediaType(request.contentType) !== 'application/json') {
      return protocolProblem('unsupported-media-type', { detail: 'PUT requires application/json.' })
    }
    if (!isJsonValue(request.body)) {
      return protocolProblem('malformed-request', { detail: 'The request body must be one canonical JSON document.' })
    }
    return null
  }
  if (mediaType(request.contentType) !== 'application/json-patch+json') {
    return protocolProblem('unsupported-media-type', { detail: 'PATCH requires application/json-patch+json.' })
  }
  if (!isJsonPatch(request.body)) {
    return protocolProblem('malformed-request', { detail: 'The request body must be a JSON Patch operation array.' })
  }
  return null
}

const isJsonPatch = (value: unknown): value is JsonPatchOperation[] => Array.isArray(value) && value.every((operation) => {
  if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) return false
  const candidate = operation as Record<string, unknown>
  if (typeof candidate.op !== 'string' || typeof candidate.path !== 'string') return false
  if (['add', 'replace', 'test'].includes(candidate.op)) return Object.hasOwn(candidate, 'value') && isJsonValue(candidate.value)
  if (candidate.op === 'remove') return true
  if (['move', 'copy'].includes(candidate.op)) return typeof candidate.from === 'string'
  return false
})

const authorityProblem = (reason: 'expired' | 'revoked' | 'forbidden') => {
  if (reason === 'expired') return protocolProblem('session-expired')
  if (reason === 'revoked') return protocolProblem('session-revoked')
  return protocolProblem('work-not-found', { detail: 'The session cannot access this work.' })
}

const preview = (build: ((capability: string) => string) | undefined, capability: string) => {
  try {
    return build ? { previewUrl: build(capability) } : {}
  } catch {
    return {}
  }
}

const notifyObserver = <TDocument extends JsonValue, TArtifacts>(
  observer: ((event: { target: RevisionTarget; revision: number; document: TDocument; assessment: WorkAssessment<TArtifacts> }) => void | Promise<void>) | undefined,
  event: { target: RevisionTarget; revision: number; document: TDocument; assessment: WorkAssessment<TArtifacts> },
) => {
  if (!observer) return
  try {
    const snapshot = structuredClone(event)
    void Promise.resolve(observer(snapshot)).catch(() => {})
  } catch {}
}
