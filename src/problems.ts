import type { JsonValue, ProblemDetails, ProtocolResponse } from './contract'

export const problemDefinitions = {
  'malformed-request': { status: 400, title: 'Malformed request.', detail: 'The request representation is malformed.', extensions: [] },
  'invalid-if-match': { status: 400, title: 'Invalid If-Match.', detail: 'If-Match must contain strong revision ETags or *.', extensions: [] },
  'session-not-found': { status: 404, title: 'Session not found.', detail: 'The capability is unknown.', extensions: [] },
  'work-not-found': { status: 404, title: 'Work not found.', detail: 'The targeted work no longer exists.', extensions: [] },
  'docs-not-found': { status: 404, title: 'Documentation not found.', detail: 'The requested model documentation does not exist.', extensions: [] },
  'method-not-allowed': { status: 405, title: 'Method not allowed.', detail: 'Use GET, HEAD, PUT, or PATCH.', extensions: [] },
  'session-expired': { status: 410, title: 'Session expired.', detail: 'Ask the user for a new agent prompt.', extensions: [] },
  'session-revoked': { status: 410, title: 'Session revoked.', detail: 'Ask the user for a new agent prompt.', extensions: [] },
  'revision-conflict': { status: 412, title: 'Revision conflict.', detail: 'Refetch the work and retry.', extensions: ['currentRevision'] },
  'payload-too-large': { status: 413, title: 'Payload too large.', detail: 'The request exceeds the host application body limit.', extensions: [] },
  'unsupported-media-type': { status: 415, title: 'Unsupported media type.', detail: 'Use the media type required for this method.', extensions: [] },
  'schema-rejected': { status: 422, title: 'Schema rejected.', detail: 'The document does not match the model schema.', extensions: ['diagnostics'] },
  'work-rejected': { status: 422, title: 'Work rejected.', detail: 'The commit policy rejected the assessment.', extensions: ['assessment'] },
  'patch-rejected': { status: 422, title: 'Patch rejected.', detail: 'The JSON Patch could not be applied.', extensions: ['patchCode', 'operation'] },
  'if-match-required': { status: 428, title: 'If-Match required.', detail: 'Send the ETag from the latest GET.', extensions: [] },
  'stored-work-unreadable': { status: 500, title: 'Stored work is unreadable.', detail: 'The stored work does not match its model.', extensions: ['diagnostics'] },
} as const

export type ProblemCode = keyof typeof problemDefinitions

const privateHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const

export const privateResponseHeaders = (headers: Record<string, string> = {}) => ({ ...privateHeaders, ...headers })

export const protocolProblem = (
  code: ProblemCode,
  options: {
    detail?: string
    headers?: Record<string, string>
    extensions?: Record<string, JsonValue | undefined>
  } = {},
): ProtocolResponse => {
  const definition = problemDefinitions[code]
  const body: ProblemDetails = {
    type: `https://agentworkprotocol.dev/problems/${code}`,
    title: definition.title,
    status: definition.status,
    detail: options.detail ?? definition.detail,
    code,
    ...options.extensions,
  }
  return {
    status: definition.status,
    headers: privateResponseHeaders({ 'Content-Type': 'application/problem+json', ...options.headers }),
    content: { type: 'problem', body },
  }
}
