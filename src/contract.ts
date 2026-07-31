import type { StandardSchemaV1 } from '@standard-schema/spec'

export const sessionLifetimeMs = 24 * 60 * 60 * 1000

export type DocumentSpec<TDocument> = {
  name: string
  // Checked before validate() runs.
  schema: StandardSchemaV1
  // Generate from schema (e.g. z.toJSONSchema), never hand-write; served at
  // the docs endpoint.
  jsonSchema: Record<string, unknown>
  // Rules the schema can't express; use the same codes validate() emits.
  rules: readonly DocRule[]
  // Receives the schema's output, not the raw input.
  validate: (input: unknown) => DocumentValidation<TDocument> | Promise<DocumentValidation<TDocument>>
}

export type DocRule = {
  code: string
  title: string
  description: string
}

// Diagnostics returned with a non-null document reach agents as warnings.
export type DocumentValidation<TDocument> = {
  document: TDocument | null
  diagnostics: readonly Diagnostic[]
}

export type Diagnostic = {
  severity: 'error' | 'warning'
  code: string
  path?: string
  message: string
}

export const structuralDiagnosticCode = 'document.structure'

export const protocolErrors = [
  {
    code: 'invalid_request',
    status: 400,
    meaning: 'The request envelope is malformed. Send exactly the documented fields.',
  },
  {
    code: 'not_found',
    status: 404,
    meaning: 'The session URL is wrong or the session never existed.',
  },
  {
    code: 'draft_not_found',
    status: 404,
    meaning: 'The session is valid but its draft is gone. Ask the user for a new prompt.',
  },
  {
    code: 'method_not_allowed',
    status: 405,
    meaning: 'The draft endpoint accepts only GET, HEAD, PUT, and PATCH.',
  },
  {
    code: 'draft_revision_conflict',
    status: 409,
    meaning: 'Someone else changed the draft. Refetch it and reapply your change to the returned currentRevision.',
  },
  {
    code: 'agent_session_expired',
    status: 410,
    meaning: 'The session expired or was revoked. Ask the user for a new prompt.',
  },
  {
    code: 'document_invalid',
    status: 422,
    meaning: 'The document failed validation. Fix every diagnostic and resubmit.',
  },
  {
    code: 'stored_draft_invalid',
    status: 500,
    meaning: 'The stored draft no longer validates. Ask the user to fix the draft in the app.',
  },
] as const

export type ProtocolErrorCode = (typeof protocolErrors)[number]['code']

export type ProtocolError = {
  error: ProtocolErrorCode
  message: string
  currentRevision?: number
  diagnostics?: readonly Diagnostic[]
}

export type ProtocolRequest = {
  method: string
  capability: string
  body?: unknown
}

export type ProtocolResponse = {
  status: number
  headers: Record<string, string>
  content:
    | { type: 'json'; body: unknown }
    | { type: 'markdown'; body: string }
}

export type DraftDto<TDocument> = {
  workId: string
  name: string
  revision: number
  document: TDocument
  previewUrl: string
  warnings?: readonly Diagnostic[]
}

export type CommitDto = {
  revision: number
  previewUrl: string
  warnings?: readonly Diagnostic[]
}

export type ReplaceDraftInput = {
  baseRevision: number
  document: unknown
}

export type PatchDraftInput = {
  baseRevision: number
  patch: Record<string, unknown>
}

// Hand-written so the package has zero dependencies. The strictness is part
// of the wire contract.
export const parseCapabilityParam = (value: unknown): string | null =>
  typeof value === 'string'
    && value.length >= capabilityLength.min
    && value.length <= capabilityLength.max
    ? value
    : null

export const parseReplaceDraftInput = (body: unknown): ReplaceDraftInput | null => {
  if (!isPlainObject(body) || !hasExactKeys(body, ['baseRevision', 'document'])) return null
  if (!isRevision(body.baseRevision)) return null
  return { baseRevision: body.baseRevision, document: body.document }
}

export const parsePatchDraftInput = (body: unknown): PatchDraftInput | null => {
  if (!isPlainObject(body) || !hasExactKeys(body, ['baseRevision', 'patch'])) return null
  if (!isRevision(body.baseRevision) || !isPlainObject(body.patch)) return null
  return { baseRevision: body.baseRevision, patch: body.patch }
}

const capabilityLength = { min: 32, max: 128 } as const

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value)
