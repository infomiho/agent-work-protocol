import type { StandardSchemaV1 } from '@standard-schema/spec'
import { isRevision, type Diagnostic, type JsonValue, type RevisionPrecondition, type WorkAssessment, type WorkModel } from './contract'
import type { RevisionEdit, RevisionStore, RevisionTarget } from './revision'
import { applyJsonPatch, type JsonPatchLimits } from './json-patch'
import { canonicalJson, cloneJson } from './json'

export type CommitPolicy<TArtifacts = never> = (assessment: WorkAssessment<TArtifacts>) => boolean

export const assessed = <TArtifacts>(_assessment: WorkAssessment<TArtifacts>) => true
export const noErrors = <TArtifacts>(assessment: WorkAssessment<TArtifacts>) =>
  !assessment.diagnostics.some(({ severity }) => severity === 'error')

export type RevisionIntakeCommand<TAuthority> = {
  target: RevisionTarget
  authority: TAuthority
  now?: Date
  expectedRevision: RevisionPrecondition | number
  edit: RevisionEdit
}

export type RevisionIntakeReadOutcome<TDocument extends JsonValue, TArtifacts> =
  | { kind: 'read'; revision: number; document: TDocument; assessment: WorkAssessment<TArtifacts> }
  | { kind: 'target-not-found' }
  | { kind: 'stored-work-unreadable'; diagnostics: readonly Diagnostic[] }
  | { kind: 'authority-rejected'; reason: 'expired' | 'revoked' | 'forbidden' }

export type RevisionIntakeOutcome<TDocument extends JsonValue, TArtifacts> =
  | { kind: 'committed'; revision: number; document: TDocument; assessment: WorkAssessment<TArtifacts> }
  | { kind: 'conflict'; currentRevision: number | null }
  | { kind: 'target-not-found' }
  | { kind: 'authority-rejected'; reason: 'expired' | 'revoked' | 'forbidden' }
  | { kind: 'stored-work-unreadable'; diagnostics: readonly Diagnostic[] }
  | { kind: 'edit-rejected'; error: { code: string; message: string; operation?: number } }
  | { kind: 'schema-rejected'; diagnostics: readonly Diagnostic[] }
  | { kind: 'work-rejected'; assessment: WorkAssessment<TArtifacts> }

export const createRevisionIntake = <TDocument extends JsonValue, TArtifacts, TAuthority>(options: {
  model: WorkModel<TDocument, TArtifacts>
  store: RevisionStore<TDocument, TAuthority>
  policy: CommitPolicy<TArtifacts>
  patchLimits?: Partial<JsonPatchLimits>
}) => {
  const decodeStored = async (current: { revision: number; document: TDocument }) => {
    if (!isRevision(current.revision)) {
      return { kind: 'stored-work-unreadable', diagnostics: [invalidStoredRevision] } as const
    }
    const decoded = await options.model.schema.decoder['~standard'].validate(current.document)
    if (decoded.issues) {
      return { kind: 'stored-work-unreadable', diagnostics: structuralDiagnostics(decoded.issues) } as const
    }
    const document = canonicalJson<TDocument>(decoded.value)
    if (!document.ok) return { kind: 'stored-work-unreadable', diagnostics: [document.diagnostic] } as const
    return {
      kind: 'read',
      revision: current.revision,
      document: document.value,
      assessment: await options.model.assess(cloneJson(document.value)),
    } as const
  }

  const read = async (command: { target: RevisionTarget; authority: TAuthority; now?: Date }): Promise<RevisionIntakeReadOutcome<TDocument, TArtifacts>> => {
    const current = await options.store.read({ target: command.target, authority: command.authority, now: command.now ?? new Date() })
    if (current.kind !== 'read') return current
    return decodeStored(current)
  }

  const commit = async (
    command: RevisionIntakeCommand<TAuthority>,
  ): Promise<RevisionIntakeOutcome<TDocument, TArtifacts>> => {
    const now = command.now ?? new Date()
    const current = await options.store.read({ target: command.target, authority: command.authority, now })
    if (current.kind !== 'read') return current
    if (!matchesRevision(command.expectedRevision, current.revision)) {
      return { kind: 'conflict', currentRevision: current.revision } as const
    }
    const stored = await decodeStored(current)
    if (stored.kind !== 'read') return stored
    const edited = command.edit.kind === 'replace'
      ? { ok: true, document: command.edit.document } as const
      : applyJsonPatch(stored.document, command.edit.operations, options.patchLimits)
    if (!edited.ok) return { kind: 'edit-rejected', error: edited } as const
    const decoded = await options.model.schema.decoder['~standard'].validate(edited.document)
    if (decoded.issues) {
      return { kind: 'schema-rejected', diagnostics: structuralDiagnostics(decoded.issues) } as const
    }
    const document = canonicalJson<TDocument>(decoded.value)
    if (!document.ok) return { kind: 'schema-rejected', diagnostics: [document.diagnostic] } as const
    const assessment = await options.model.assess(cloneJson(document.value))
    if (!options.policy(assessment)) {
      return { kind: 'work-rejected', assessment } as const
    }
    const outcome = await options.store.commit({
      target: command.target,
      authority: command.authority,
      now,
      expectedRevision: current.revision,
      document: cloneJson(document.value),
    })
    if (outcome.kind !== 'committed') return outcome
    return { kind: 'committed', revision: outcome.revision, document: cloneJson(document.value), assessment } as const
  }

  return { read, commit }
}

const matchesRevision = (expected: RevisionPrecondition | number, current: number) =>
  expected === '*' || (typeof expected === 'number' ? expected === current : expected.includes(current))

const invalidStoredRevision: Diagnostic = {
  severity: 'error',
  code: 'work.structure',
  message: 'The stored revision must be a non-negative safe integer.',
  pointer: '',
}

const structuralDiagnostics = (issues: readonly StandardSchemaV1.Issue[]): Diagnostic[] =>
  issues.map((issue) => ({
    severity: 'error',
    code: 'work.structure',
    message: issue.message,
    pointer: issue.path?.length
      ? `/${issue.path.map((segment) => escapePointer(String(typeof segment === 'object' ? segment.key : segment))).join('/')}`
      : '',
  }))

const escapePointer = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1')
