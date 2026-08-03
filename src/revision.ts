import type { JsonValue } from './contract'

export type RevisionTarget = {
  model: string
  version: string
  document: string
}

export type RevisionEdit =
  | { kind: 'replace'; document: JsonValue }
  | { kind: 'patch'; operations: readonly JsonPatchOperation[] }

export type JsonPatchOperation =
  | { op: 'add' | 'replace' | 'test'; path: string; value: JsonValue }
  | { op: 'remove'; path: string }
  | { op: 'move' | 'copy'; from: string; path: string }

export type StoredRevision<TDocument extends JsonValue> = {
  revision: number
  document: TDocument
}

export type RevisionRead<TAuthority> = {
  target: RevisionTarget
  authority: TAuthority
  now: Date
}

export type RevisionReadOutcome<TDocument extends JsonValue> =
  | { kind: 'read'; revision: number; document: TDocument }
  | { kind: 'target-not-found' }
  | { kind: 'authority-rejected'; reason: 'expired' | 'revoked' | 'forbidden' }

export type RevisionCommit<TDocument extends JsonValue, TAuthority> = {
  target: RevisionTarget
  authority: TAuthority
  now: Date
  expectedRevision: number
  document: TDocument
}

export type RevisionCommitOutcome =
  | { kind: 'committed'; revision: number }
  | { kind: 'conflict'; currentRevision: number | null }
  | { kind: 'target-not-found' }
  | { kind: 'authority-rejected'; reason: 'expired' | 'revoked' | 'forbidden' }

export type RevisionStore<TDocument extends JsonValue, TAuthority> = {
  read: (command: RevisionRead<TAuthority>) => Promise<RevisionReadOutcome<TDocument>>
  commit: (command: RevisionCommit<TDocument, TAuthority>) => Promise<RevisionCommitOutcome>
}
