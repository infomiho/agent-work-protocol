import { describe, expect, it, vi } from 'vitest'
import {
  assessed,
  createAgentWorkProtocol,
  formatRevisionEtag,
  hashCapability,
  type JsonValue,
  type RevisionStore,
  type SessionStore,
  type WorkModel,
} from '../src/server'

type Document = { name: string; tags: string[] }
type Artifacts = { compiled: string }
type Authority = { sessionId: string }

const model: WorkModel<Document, Artifacts> = {
  id: 'theme',
  version: '1',
  schema: {
    decoder: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) => typeof value === 'object' && value !== null
          && typeof (value as { name?: unknown }).name === 'string'
          && Array.isArray((value as { tags?: unknown }).tags)
          && (value as { tags: unknown[] }).tags.every((tag) => typeof tag === 'string')
          ? { value: { name: (value as Document).name.trim(), tags: [...(value as Document).tags] } }
          : { issues: [{ message: 'Invalid theme.' }] },
      },
    },
    jsonSchema: { type: 'object' },
  },
  assess: (document) => ({
    diagnostics: document.name === ''
      ? [{ severity: 'error', code: 'theme.name', message: 'Name is required.', pointer: '/name' }]
      : [],
    artifacts: { compiled: `secret:${document.name}` },
  }),
  authoring: { title: 'Theme', diagnostics: [] },
}

const createWorld = (overrides: {
  authorityRejected?: 'expired' | 'revoked' | 'forbidden'
  expiredSession?: boolean
  missingWork?: boolean
  stored?: JsonValue
  commitOutcome?: 'conflict-with-revision' | 'conflict-without-revision'
  previewUrl?: (capability: string) => string
  revisionCommitted?: (event: {
    target: { model: string; version: string; document: string }
    revision: number
    document: Document
    assessment: { diagnostics: readonly unknown[]; artifacts?: Artifacts }
  }) => void | Promise<void>
} = {}) => {
  const capability = 'c'.repeat(64)
  const state = {
    stored: { revision: 4, document: overrides.stored ?? { name: 'Signal', tags: ['bold'] } },
    lookups: [] as string[],
    reads: 0,
    touches: [] as string[],
    commits: 0,
  }
  const sessions: SessionStore<Authority> = {
    findByCapabilityHash: async (hash) => {
      state.lookups.push(hash)
      if (hash !== hashCapability(capability)) return null
      return {
        id: 'session-1',
        expiresAt: new Date(Date.now() + (overrides.expiredSession ? -60_000 : 60_000)),
        target: { model: 'theme', version: '1', document: 'theme-1' },
        authority: { sessionId: 'session-1' },
      }
    },
    touch: async (id) => { state.touches.push(id) },
  }
  const revisions: RevisionStore<Document, Authority> = {
    read: async () => {
      state.reads += 1
      if (overrides.authorityRejected) return { kind: 'authority-rejected', reason: overrides.authorityRejected }
      if (overrides.missingWork) return { kind: 'target-not-found' }
      return { kind: 'read', revision: state.stored.revision, document: state.stored.document as Document }
    },
    commit: async (command) => {
      state.commits += 1
      if (overrides.authorityRejected) return { kind: 'authority-rejected', reason: overrides.authorityRejected }
      if (overrides.commitOutcome === 'conflict-with-revision') return { kind: 'conflict', currentRevision: 9 }
      if (overrides.commitOutcome === 'conflict-without-revision') return { kind: 'conflict', currentRevision: null }
      if (command.expectedRevision !== state.stored.revision) return { kind: 'conflict', currentRevision: state.stored.revision }
      state.stored = { revision: state.stored.revision + 1, document: command.document }
      return { kind: 'committed', revision: state.stored.revision }
    },
  }
  const protocol = createAgentWorkProtocol({
    model,
    sessions,
    revisions,
    policy: assessed,
    serverUrl: 'https://api.test',
    previewUrl: overrides.previewUrl,
    revisionCommitted: overrides.revisionCommitted,
  })
  return { capability, protocol, state }
}

const put = (world: ReturnType<typeof createWorld>, body: unknown = { name: 'After', tags: [] }, ifMatch = '"4"') =>
  world.protocol.handleWorkRequest({
    method: 'PUT', capability: world.capability, contentType: 'application/json', headers: { 'if-match': ifMatch }, body,
  })

describe('work HTTP protocol', () => {
  it('uses only a bounded capability hash and touches successful GET and HEAD reads', async () => {
    const world = createWorld()
    const get = await world.protocol.handleWorkRequest({ method: 'GET', capability: world.capability })
    const head = await world.protocol.handleWorkRequest({ method: 'HEAD', capability: world.capability })

    expect(world.state.lookups).toEqual([hashCapability(world.capability), hashCapability(world.capability)])
    expect(world.state.lookups).not.toContain(world.capability)
    expect(world.state.touches).toEqual(['session-1', 'session-1'])
    expect(get).toMatchObject({ status: 200, headers: { ETag: '"4"' }, content: { type: 'json', body: { revision: 4 } } })
    expect(head).toMatchObject({ status: 200, headers: { ETag: '"4"' }, content: { type: 'none' } })

    for (const length of [31, 129]) {
      const outOfBounds = createWorld()
      await outOfBounds.protocol.handleWorkRequest({ method: 'GET', capability: 'x'.repeat(length) })
      expect(outOfBounds.state.lookups).toEqual([])
    }
  })

  it.each(['expired', 'revoked'] as const)('does not disclose work or a revision when authority is %s', async (reason) => {
    const world = createWorld({ authorityRejected: reason })
    const read = await world.protocol.handleWorkRequest({ method: 'GET', capability: world.capability })
    const stale = await put(world, { name: 'Stale', tags: [] }, '"3"')

    expect(read).toMatchObject({ status: 410, content: { type: 'problem', body: { code: `session-${reason}` } } })
    expect(stale).toMatchObject({ status: 410, content: { type: 'problem', body: { code: `session-${reason}` } } })
    expect(read.headers).not.toHaveProperty('ETag')
    expect(JSON.stringify(stale.content)).not.toContain('currentRevision')
    expect(world.state.commits).toBe(0)
  })

  it('preserves a final atomic authority check in commit', async () => {
    let reads = 0
    const world = createWorld()
    const original = world.protocol
    void original
    const capability = 'd'.repeat(64)
    const revisions: RevisionStore<Document, Authority> = {
      read: async () => { reads += 1; return { kind: 'read', revision: 4, document: { name: 'Before', tags: [] } } },
      commit: async () => ({ kind: 'authority-rejected', reason: 'revoked' }),
    }
    const protocol = createAgentWorkProtocol({
      model,
      sessions: {
        findByCapabilityHash: async () => ({ id: 's', expiresAt: new Date(Date.now() + 1000), target: { model: 'theme', version: '1', document: '1' }, authority: { sessionId: 's' } }),
        touch: async () => {},
      },
      revisions,
      policy: assessed,
      serverUrl: 'https://api.test',
    })

    const response = await protocol.handleWorkRequest({ method: 'PUT', capability, contentType: 'application/json', headers: { 'if-match': '"4"' }, body: { name: 'After', tags: [] } })
    expect(reads).toBe(1)
    expect(response).toMatchObject({ status: 410, content: { type: 'problem', body: { code: 'session-revoked' } } })
  })

  it('decodes and canonicalizes stored work before PATCH', async () => {
    const world = createWorld({ stored: { name: '  Signal  ', tags: ['bold'] } })
    const response = await world.protocol.handleWorkRequest({
      method: 'PATCH', capability: world.capability, contentType: 'application/json-patch+json', headers: { 'if-match': '"4"' },
      body: [{ op: 'add', path: '/tags/-', value: 'new' }],
    })

    expect(response).toMatchObject({ status: 200, content: { type: 'json', body: { document: { name: 'Signal', tags: ['bold', 'new'] } } } })
    expect(world.state.stored.document).toEqual({ name: 'Signal', tags: ['bold', 'new'] })
  })

  it('never patches or recommits corrupt stored work', async () => {
    const world = createWorld({ stored: { corrupt: true } })
    const read = await world.protocol.handleWorkRequest({ method: 'GET', capability: world.capability })
    const response = await world.protocol.handleWorkRequest({
      method: 'PATCH', capability: world.capability, contentType: 'application/json-patch+json', headers: { 'if-match': '"4"' },
      body: [{ op: 'add', path: '/name', value: 'Recovered' }],
    })

    expect(read).toMatchObject({ status: 500, content: { type: 'problem', body: { code: 'stored-work-unreadable' } } })
    expect(response).toMatchObject({ status: 500, content: { type: 'problem', body: { code: 'stored-work-unreadable', diagnostics: expect.any(Array) } } })
    expect(world.state.touches).toEqual([])
    expect(world.state.commits).toBe(0)
  })

  it('accepts standard If-Match lists and * and returns consistent strong ETags', async () => {
    const listed = createWorld()
    const listResponse = await put(listed, { name: 'Listed', tags: [] }, '"2", "4", "8"')
    const any = createWorld()
    const anyResponse = await put(any, { name: 'Any', tags: [] }, '*')

    expect(listResponse).toMatchObject({ status: 200, headers: { ETag: formatRevisionEtag(5) } })
    expect(anyResponse).toMatchObject({ status: 200, headers: { ETag: formatRevisionEtag(5) } })
  })

  it.each(['W/"4"', '"4", *', '4', '"9007199254740992"'])('rejects invalid If-Match %s', async (ifMatch) => {
    const world = createWorld()
    expect(await put(world, undefined, ifMatch)).toMatchObject({ status: 400, content: { type: 'problem', body: { code: 'invalid-if-match' } } })
  })

  it('validates representation before reporting a missing precondition', async () => {
    const world = createWorld()
    const media = await world.protocol.handleWorkRequest({ method: 'PUT', capability: world.capability, contentType: 'text/plain', body: {} })
    const body = await world.protocol.handleWorkRequest({ method: 'PUT', capability: world.capability, contentType: 'application/json', body: undefined })

    expect(media).toMatchObject({ status: 415, content: { type: 'problem', body: { code: 'unsupported-media-type' } } })
    expect(body).toMatchObject({ status: 400, content: { type: 'problem', body: { code: 'malformed-request' } } })
  })

  it('reports final CAS races and omits an unavailable current revision', async () => {
    const conflict = createWorld({ commitOutcome: 'conflict-with-revision' })
    const known = await put(conflict)
    const missing = createWorld({ commitOutcome: 'conflict-without-revision' })
    const unknown = await put(missing)

    expect(known).toMatchObject({ status: 412, content: { type: 'problem', body: { currentRevision: 9 } } })
    expect((unknown.content as { body: object }).body).not.toHaveProperty('currentRevision')
  })

  it('keeps a committed response successful when preview generation throws', async () => {
    const world = createWorld({ previewUrl: () => { throw new Error('preview failed') } })
    const response = await put(world)

    expect(response.status).toBe(200)
    expect((response.content as { body: object }).body).not.toHaveProperty('previewUrl')
    expect(world.state.stored.revision).toBe(5)
  })

  it.each(['throw', 'reject'] as const)('treats observer %s as best-effort', async (failure) => {
    const observer = failure === 'throw'
      ? vi.fn(() => { throw new Error('observer failed') })
      : vi.fn(async () => { throw new Error('observer failed') })
    const world = createWorld({ revisionCommitted: observer })
    expect((await put(world)).status).toBe(200)
    await Promise.resolve()
    expect(observer).toHaveBeenCalledOnce()
  })

  it('gives observers defensive snapshots', async () => {
    const world = createWorld({
      revisionCommitted: (event) => {
        event.document.name = 'Mutated'
        event.document.tags.push('observer')
        if (event.assessment.artifacts) event.assessment.artifacts.compiled = 'mutated'
      },
    })
    const response = await put(world, { name: 'Observed', tags: [] })

    expect(response).toMatchObject({ content: { type: 'json', body: { document: { name: 'Observed', tags: [] } } } })
    expect(world.state.stored.document).toEqual({ name: 'Observed', tags: [] })
  })

  it.each(['POST', 'DELETE', 'OPTIONS'])('answers %s with 405 and Allow', async (method) => {
    const world = createWorld()
    const response = await world.protocol.handleWorkRequest({ method, capability: world.capability })
    expect(response).toMatchObject({ status: 405, headers: { Allow: 'GET, HEAD, PUT, PATCH' }, content: { type: 'problem', body: { code: 'method-not-allowed' } } })
  })

  it('uses the shared session briefing renderer and rejects expired sessions before revision reads', async () => {
    const active = createWorld()
    const briefing = await active.protocol.handleSessionRequest({ capability: active.capability })
    expect(briefing.content).toMatchObject({ type: 'markdown', body: expect.stringContaining('Work URL: https://api.test/agent/sessions/') })
    const expired = createWorld({ expiredSession: true })
    expect(await expired.protocol.handleSessionRequest({ capability: expired.capability })).toMatchObject({ status: 410 })
    const expiredRead = await expired.protocol.handleWorkRequest({ method: 'GET', capability: expired.capability })
    expect(expiredRead).toMatchObject({ status: 410, content: { type: 'problem', body: { code: 'session-expired' } } })
    expect(expiredRead.headers).not.toHaveProperty('ETag')
    expect(expired.state.reads).toBe(0)
  })
})
