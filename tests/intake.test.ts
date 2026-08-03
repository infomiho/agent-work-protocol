import { describe, expect, it, expectTypeOf } from 'vitest'
import { assessed, createRevisionIntake, noErrors, type RevisionStore, type WorkModel } from '../src/server'

type Document = { name: string }
type Artifacts = { slug: string }

const model: WorkModel<Document, Artifacts> = {
  id: 'theme', version: '1',
  schema: {
    decoder: {
      '~standard': {
        version: 1, vendor: 'test',
        validate: async (value) => typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string'
          ? { value: { name: (value as Document).name.trim() } }
          : { issues: [{ message: 'name must be a string', path: ['name'] }] },
      },
    },
    jsonSchema: { type: 'object' },
  },
  assess: (document) => ({ diagnostics: [], artifacts: { slug: document.name.toLowerCase() } }),
  authoring: { title: 'Theme', diagnostics: [] },
}

const store = (document: Document = { name: 'Before' }) => {
  const commits: unknown[] = []
  const value: RevisionStore<Document, string> = {
    read: async () => ({ kind: 'read', revision: 4, document }),
    commit: async (command) => { commits.push(command); return { kind: 'committed', revision: 5 } },
  }
  return { value, commits }
}

describe('revision intake', () => {
  it('awaits schema transforms, preserves typed artifacts, and commits canonical work', async () => {
    const revisions = store()
    const policy = (assessment: { diagnostics: readonly unknown[]; artifacts?: Artifacts }) => {
      expectTypeOf(assessment.artifacts).toEqualTypeOf<Artifacts | undefined>()
      return true
    }
    const outcome = await createRevisionIntake({ model, store: revisions.value, policy }).commit({
      target: { model: 'theme', version: '1', document: '1' }, authority: 's', expectedRevision: 4,
      edit: { kind: 'replace', document: { name: '  After  ' } },
    })

    expect(outcome).toEqual({ kind: 'committed', revision: 5, document: { name: 'After' }, assessment: { diagnostics: [], artifacts: { slug: 'after' } } })
    expect(revisions.commits).toMatchObject([{ expectedRevision: 4, document: { name: 'After' }, authority: 's', now: expect.any(Date) }])
  })

  it('checks authority before reporting a stale revision', async () => {
    const revisions: RevisionStore<Document, string> = {
      read: async () => ({ kind: 'authority-rejected', reason: 'revoked' }),
      commit: async () => { throw new Error('must not commit') },
    }
    const outcome = await createRevisionIntake({ model, store: revisions, policy: assessed }).commit({
      target: { model: 'theme', version: '1', document: '1' }, authority: 's', expectedRevision: 1,
      edit: { kind: 'replace', document: { name: 'After' } },
    })
    expect(outcome).toEqual({ kind: 'authority-rejected', reason: 'revoked' })
  })

  it('allows assessed documents and blocks domain errors under noErrors', async () => {
    const errorModel: WorkModel<Document> = {
      ...model,
      assess: () => ({ diagnostics: [{ severity: 'error', code: 'name', message: 'Reserved.', pointer: '/name' }] }),
    }
    expect((await createRevisionIntake({ model: errorModel, store: store().value, policy: assessed }).commit({
      target: { model: 'theme', version: '1', document: '1' }, authority: 's', expectedRevision: 4, edit: { kind: 'replace', document: { name: 'x' } },
    })).kind).toBe('committed')
    const revisions = store()
    expect((await createRevisionIntake({ model: errorModel, store: revisions.value, policy: noErrors }).commit({
      target: { model: 'theme', version: '1', document: '1' }, authority: 's', expectedRevision: 4, edit: { kind: 'replace', document: { name: 'x' } },
    })).kind).toBe('work-rejected')
    expect(revisions.commits).toEqual([])
  })
})
