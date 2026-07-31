import {
  parseCapabilityParam,
  parsePatchDraftInput,
  parseReplaceDraftInput,
  sessionLifetimeMs,
  type CommitDto,
  type Diagnostic,
  type DocumentSpec,
  type DraftDto,
  type ProtocolError,
  type ProtocolRequest,
  type ProtocolResponse,
} from './contract'
import { createDocs, docsPath } from './docs'
import { renderSessionBriefing } from './handoff'
import { applyJsonMergePatch } from './merge-patch'
import {
  buildSessionUrl,
  mintCapability,
  resolveSession,
  type MintedCapability,
  type SessionStore,
  type SessionView,
} from './session'
import { checkDocument, sanitizeDocument } from './validation'

export const createSubmissionProtocol = <TDocument>(options: SubmissionProtocolOptions<TDocument>) => {
  const serverUrl = options.serverUrl.replace(/\/$/, '')
  const ttlMs = options.sessionTtlMs ?? sessionLifetimeMs
  const docs = {
    api: `${serverUrl}/${docsPath}/api.md`,
    schema: `${serverUrl}/${docsPath}/schema.md`,
  }
  const { handleDocsRequest } = createDocs({
    spec: options.spec,
    serverUrl,
    productName: options.productName,
    ttlMs,
  })

  const mintSession = (now?: Date): MintedCapability => mintCapability(serverUrl, now, ttlMs)

  const handleSessionRequest = async (request: Pick<ProtocolRequest, 'capability'>): Promise<ProtocolResponse> => {
    const active = await resolveActiveSession(request.capability)
    if (!active.ok) return active.response
    return markdown(renderSessionBriefing({
      productName: options.productName,
      sessionUrl: buildSessionUrl(serverUrl, request.capability),
      expiresAt: active.view.session.expiresAt,
      docs,
    }))
  }

  const handleDraftRequest = async (request: ProtocolRequest): Promise<ProtocolResponse> => {
    const method = request.method.toUpperCase()
    if (!['GET', 'HEAD', 'PUT', 'PATCH'].includes(method)) {
      return error(405, {
        error: 'method_not_allowed',
        message: 'Use GET, HEAD, PUT, or PATCH on the draft.',
      }, { Allow: 'GET, HEAD, PUT, PATCH' })
    }
    const active = await resolveActiveSession(request.capability)
    if (!active.ok) return active.response
    if (method === 'GET' || method === 'HEAD') return getDraft(request.capability, active.view)
    if (method === 'PUT') return replaceDraft(request.capability, active.view, request.body)
    return patchDraft(request.capability, active.view, request.body)
  }

  const getDraft = async (capability: string, view: SessionView): Promise<ProtocolResponse> => {
    const stored = await readStoredDraft(view)
    if (!stored.ok) return stored.response
    await options.sessions.touch(view.session.id)
    const body: DraftDto<TDocument> = {
      workId: view.session.workId,
      name: view.workName,
      revision: stored.revision,
      document: stored.document,
      previewUrl: options.previewUrl(capability),
      ...withWarnings(stored.warnings),
    }
    return json(200, body)
  }

  const replaceDraft = async (
    capability: string,
    view: SessionView,
    body: unknown,
  ): Promise<ProtocolResponse> => {
    const input = parseReplaceDraftInput(body)
    if (!input) {
      return error(400, { error: 'invalid_request', message: 'Invalid draft update request.' })
    }
    const check = await checkDocument(options.spec, input.document)
    if ('diagnostics' in check) {
      return invalidDocument(check.diagnostics, 'Fix the diagnostics and submit the complete document again.')
    }
    return commit(capability, view, input.baseRevision, check.document, check.warnings)
  }

  const patchDraft = async (
    capability: string,
    view: SessionView,
    body: unknown,
  ): Promise<ProtocolResponse> => {
    const input = parsePatchDraftInput(body)
    if (!input) {
      return error(400, { error: 'invalid_request', message: 'Invalid draft update request.' })
    }
    const stored = await readStoredDraft(view)
    if (!stored.ok) return stored.response
    const merged = applyJsonMergePatch(stored.document, input.patch)
    const check = await checkDocument(options.spec, merged)
    if ('diagnostics' in check) {
      return invalidDocument(check.diagnostics, 'Fix the diagnostics and retry the patch.')
    }
    return commit(capability, view, input.baseRevision, check.document, check.warnings)
  }

  const commit = async (
    capability: string,
    view: SessionView,
    baseRevision: number,
    document: TDocument,
    warnings: readonly Diagnostic[],
  ): Promise<ProtocolResponse> => {
    const outcome = await options.drafts.commit({
      workId: view.session.workId,
      sessionId: view.session.id,
      requiredGeneration: view.session.generation,
      now: new Date(),
      expectedRevision: baseRevision,
      nextRevision: baseRevision + 1,
      document: sanitizeDocument(document),
      attribution: `agent:${view.session.id}`,
    })
    if (outcome.kind === 'expired') return sessionExpired()
    if (outcome.kind === 'conflict') {
      return error(409, {
        error: 'draft_revision_conflict',
        message: 'Refetch the current draft and retry your changes.',
        ...(outcome.currentRevision === null ? {} : { currentRevision: outcome.currentRevision }),
      })
    }
    // The commit already happened; a broken hook must not hide that.
    try {
      void Promise.resolve(options.onAccepted?.({ workId: view.session.workId, revision: outcome.revision }))
        .catch(() => {})
    } catch {}
    const body: CommitDto = {
      revision: outcome.revision,
      previewUrl: options.previewUrl(capability),
      ...withWarnings(warnings),
    }
    return json(200, body)
  }

  const readStoredDraft = async (
    view: SessionView,
  ): Promise<
    | { ok: false; response: ProtocolResponse }
    | { ok: true; revision: number; document: TDocument; warnings: readonly Diagnostic[] }
  > => {
    const draft = view.draft
    if (!draft) {
      return { ok: false, response: draftNotFound() }
    }
    const check = await checkDocument(options.spec, draft.document)
    if ('diagnostics' in check) {
      return {
        ok: false,
        response: error(500, { error: 'stored_draft_invalid', message: 'Stored draft is invalid.' }),
      }
    }
    return { ok: true, revision: draft.revision, document: sanitizeDocument(check.document), warnings: check.warnings }
  }

  const resolveActiveSession = async (
    capability: string,
  ): Promise<{ ok: false; response: ProtocolResponse } | { ok: true; view: SessionView }> => {
    const parsed = parseCapabilityParam(capability)
    if (!parsed) return { ok: false, response: notFound() }
    const resolved = await resolveSession(options.sessions, parsed)
    if (resolved.kind === 'not-found') return { ok: false, response: notFound() }
    if (resolved.kind === 'expired') return { ok: false, response: sessionExpired() }
    if (!resolved.view.draft) return { ok: false, response: draftNotFound() }
    return { ok: true, view: resolved.view }
  }

  const sessionExpired = () => error(410, {
    error: 'agent_session_expired',
    message: options.productName
      ? `Ask the user for a new ${options.productName} agent prompt.`
      : 'Ask the user for a new agent prompt.',
  })

  const notFound = () => error(404, { error: 'not_found', message: 'Agent session not found.' })

  const draftNotFound = () => error(404, { error: 'draft_not_found', message: 'Work draft not found.' })

  const invalidDocument = (diagnostics: readonly Diagnostic[], retryHint: string) => error(422, {
    error: 'document_invalid',
    message: retryHint,
    diagnostics,
  })

  return {
    mintSession,
    handleSessionRequest,
    handleDraftRequest,
    handleDocsRequest,
  }
}

export type SubmissionProtocol<TDocument> = ReturnType<typeof createSubmissionProtocol<TDocument>>

export type SubmissionProtocolOptions<TDocument> = {
  sessions: SessionStore
  drafts: DraftStore<TDocument>
  spec: DocumentSpec<TDocument>
  serverUrl: string
  previewUrl: (capability: string) => string
  productName?: string
  sessionTtlMs?: number
  // Fires after the store accepts a commit, before the transport writes the
  // response.
  onAccepted?: (event: { workId: string; revision: number }) => void
}

export type DraftStore<TDocument> = {
  commit: (command: CommitCommand<TDocument>) => Promise<CommitOutcome>
}

// One atomic conditional write. Apply only if the session row matches
// {sessionId, requiredGeneration, not expired at now} (touch lastUsedAt while
// checking, else 'expired') and the work's draft revision equals
// expectedRevision (else 'conflict' with the current revision). Then store
// document at nextRevision, recording attribution as the author.
export type CommitCommand<TDocument> = {
  workId: string
  sessionId: string
  requiredGeneration: number
  now: Date
  expectedRevision: number
  nextRevision: number
  document: TDocument
  attribution: string
}

export type CommitOutcome =
  | { kind: 'expired' }
  | { kind: 'conflict'; currentRevision: number | null }
  | { kind: 'accepted'; revision: number }

const withWarnings = (warnings: readonly Diagnostic[]) =>
  warnings.length > 0 ? { warnings } : {}

const privateHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const

const json = (status: number, body: unknown, headers: Record<string, string> = {}): ProtocolResponse => ({
  status,
  headers: { ...privateHeaders, ...headers },
  content: { type: 'json', body },
})

const markdown = (body: string): ProtocolResponse => ({
  status: 200,
  headers: { ...privateHeaders },
  content: { type: 'markdown', body },
})

const error = (status: number, body: ProtocolError, headers: Record<string, string> = {}) =>
  json(status, body, headers)
