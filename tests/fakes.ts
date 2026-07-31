import type { Diagnostic, DocumentSpec } from '../src/contract'
import { hashCapability, type SessionStore } from '../src/session'
import type { CommitCommand, CommitOutcome, DraftStore } from '../src/submission'

export type ToyDocument = {
  name: string
  colors: { primary: string; accent: string }
  tags: string[]
}

export const toyDocument = (): ToyDocument => ({
  name: 'Signal study',
  colors: { primary: '#111111', accent: '#ff5500' },
  tags: ['bold'],
})

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const toySpec: DocumentSpec<ToyDocument> = {
  name: 'toy document',
  schema: {
    '~standard': {
      version: 1,
      vendor: 'toy',
      validate: (value) => {
        if (!isObject(value)) return { issues: [{ message: 'document must be an object' }] }
        if (typeof value.name !== 'string') {
          return { issues: [{ message: 'name must be a string', path: ['name'] }] }
        }
        return { value }
      },
    },
  },
  jsonSchema: { type: 'object' },
  rules: [
    { code: 'doc.empty-name', title: 'Name', description: 'name must not be empty' },
    { code: 'doc.forbidden', title: 'Forbidden key', description: 'forbidden is not allowed' },
  ],
  validate: (input) => {
    const document = input as ToyDocument
    const errors: Diagnostic[] = []
    const warnings: Diagnostic[] = []
    if (document.name === '') {
      errors.push({ severity: 'error', code: 'doc.empty-name', path: 'name', message: 'name must not be empty' })
    }
    if ('forbidden' in document) {
      errors.push({ severity: 'error', code: 'doc.forbidden', message: 'forbidden is not allowed' })
    }
    if (document.name.endsWith('!')) {
      warnings.push({ severity: 'warning', code: 'doc.loud-name', path: 'name', message: 'name ends with an exclamation mark' })
    }
    if (errors.length > 0) return { document: null, diagnostics: errors }
    return { document: JSON.parse(JSON.stringify(document)) as ToyDocument, diagnostics: warnings }
  },
}

export type World = ReturnType<typeof createWorld>

type StoredDraft = { revision: number; document: unknown }

type WorldState = {
  capabilityHash: string
  session: { id: string; workId: string; generation: number; expiresAt: Date }
  workName: string
  workGeneration: number
  draft: StoredDraft | null
  touched: string[]
  commits: CommitCommand<ToyDocument>[]
  commitOverride: CommitOutcome | undefined
  lookups: string[]
}

export const createWorld = () => {
  const capability = 'c'.repeat(64)
  const state: WorldState = {
    capabilityHash: hashCapability(capability),
    session: {
      id: 'session-1',
      workId: 'work-1',
      generation: 0,
      expiresAt: new Date(Date.now() + 60_000),
    },
    workName: 'Signal study',
    workGeneration: 0,
    draft: { revision: 1, document: toyDocument() },
    touched: [],
    commits: [],
    commitOverride: undefined,
    lookups: [],
  }

  const sessions: SessionStore = {
    findByCapabilityHash: async (hash) => {
      state.lookups.push(hash)
      if (hash !== state.capabilityHash) return null
      return {
        session: { ...state.session },
        workName: state.workName,
        workGeneration: state.workGeneration,
        draft: state.draft ? { ...state.draft } : null,
      }
    },
    touch: async (sessionId) => {
      state.touched.push(sessionId)
    },
  }

  const drafts: DraftStore<ToyDocument> = {
    commit: async (command) => {
      state.commits.push(command)
      if (state.commitOverride) return state.commitOverride
      if (!state.draft || command.expectedRevision !== state.draft.revision) {
        return { kind: 'conflict', currentRevision: state.draft?.revision ?? null }
      }
      state.draft = { revision: command.nextRevision, document: command.document }
      return { kind: 'accepted', revision: command.nextRevision }
    },
  }

  return { capability, state, sessions, drafts }
}
