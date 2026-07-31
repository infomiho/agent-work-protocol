import type { StandardSchemaV1 } from '@standard-schema/spec'
import { structuralDiagnosticCode, type Diagnostic, type DocumentSpec } from './contract'

export type DocumentCheck<TDocument> =
  | { document: TDocument; warnings: readonly Diagnostic[] }
  | { diagnostics: readonly Diagnostic[] }

export const checkDocument = async <TDocument>(
  spec: DocumentSpec<TDocument>,
  input: unknown,
): Promise<DocumentCheck<TDocument>> => {
  const structural = await spec.schema['~standard'].validate(input)
  if (structural.issues) {
    return { diagnostics: structuralDiagnostics(structural.issues) }
  }
  const result = await spec.validate(structural.value)
  if (!result.document) {
    return { diagnostics: result.diagnostics }
  }
  return { document: result.document, warnings: result.diagnostics }
}

// Strips prototypes and non-JSON values before a document reaches a store.
export const sanitizeDocument = <TDocument>(document: TDocument): TDocument =>
  JSON.parse(JSON.stringify(document)) as TDocument

const structuralDiagnostics = (issues: readonly StandardSchemaV1.Issue[]): Diagnostic[] =>
  issues.map((issue) => ({
    severity: 'error',
    code: structuralDiagnosticCode,
    path: issuePath(issue),
    message: issue.message,
  }))

// JSON Pointer (RFC 6901); root-level issues carry no path.
const issuePath = (issue: StandardSchemaV1.Issue) =>
  issue.path?.length
    ? `/${issue.path
      .map((segment) => escapePointerSegment(String(typeof segment === 'object' ? segment.key : segment)))
      .join('/')}`
    : undefined

const escapePointerSegment = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1')
