import type { StandardSchemaV1 } from '@standard-schema/spec'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  pointer: string
  help?: string
}

export type DiagnosticDefinition = {
  code: string
  title: string
  description: string
}

export type WorkAssessment<TArtifacts = never> = {
  diagnostics: readonly Diagnostic[]
  artifacts?: TArtifacts
}

export type WorkModel<TDocument extends JsonValue, TArtifacts = never> = {
  id: string
  version: string
  schema: {
    decoder: StandardSchemaV1<unknown, TDocument>
    jsonSchema: Record<string, unknown>
  }
  assess: (document: TDocument) => WorkAssessment<TArtifacts> | Promise<WorkAssessment<TArtifacts>>
  authoring: {
    title: string
    description?: string
    examples?: readonly TDocument[]
    diagnostics: readonly DiagnosticDefinition[]
  }
}

export type WireAssessment = {
  outcome: 'pass' | 'fail'
  diagnostics: readonly Diagnostic[]
}

export type WorkResponse<TDocument extends JsonValue = JsonValue> = {
  model: string
  version: string
  documentId: string
  revision: number
  document: TDocument
  assessment: WireAssessment
  previewUrl?: string
}

export type CommitResponse<TDocument extends JsonValue = JsonValue> = {
  revision: number
  document: TDocument
  assessment: WireAssessment
  previewUrl?: string
}

export type ProblemDetails = {
  type: string
  title: string
  status: number
  detail: string
  code: string
  [extension: string]: JsonValue | undefined
}

export type ProtocolRequest = {
  method: string
  capability: string
  headers?: Record<string, string | undefined>
  contentType?: string
  body?: unknown
}

export type ProtocolResponse = {
  status: number
  headers: Record<string, string>
  content:
    | { type: 'json'; body: unknown }
    | { type: 'problem'; body: ProblemDetails }
    | { type: 'markdown'; body: string }
    | { type: 'none' }
}

export const structuralDiagnosticCode = 'work.structure'

export const assessmentOutcome = (assessment: Pick<WorkAssessment<unknown>, 'diagnostics'>): 'pass' | 'fail' =>
  assessment.diagnostics.some(({ severity }) => severity === 'error') ? 'fail' : 'pass'

export const isRevision = (revision: unknown): revision is number =>
  typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0

export const formatRevisionEtag = (revision: number) => {
  if (!isRevision(revision)) throw new RangeError('Revision must be a non-negative safe integer.')
  return `"${revision}"`
}

export const parseRevisionEtag = (value: string | undefined): number | null => {
  if (!value) return null
  const match = /^"(0|[1-9]\d*)"$/.exec(value.trim())
  if (!match) return null
  const revision = Number(match[1])
  return isRevision(revision) ? revision : null
}

export type RevisionPrecondition = '*' | readonly number[]

export const parseRevisionPrecondition = (value: string): RevisionPrecondition | null => {
  const trimmed = value.trim()
  if (trimmed === '*') return '*'
  if (!trimmed) return null
  const revisions: number[] = []
  for (const etag of trimmed.split(',')) {
    const revision = parseRevisionEtag(etag)
    if (revision === null) return null
    revisions.push(revision)
  }
  return revisions
}
