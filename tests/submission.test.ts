import { describe, expect, it, vi } from 'vitest'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { structuralDiagnosticCode, type ProtocolResponse } from '../src/contract'
import { createSubmissionProtocol } from '../src/submission'
import { createWorld, toyDocument, toySpec, type ToyDocument, type World } from './fakes'

const previewUrl = (capability: string) => `http://front.test/agent-preview/${capability}`

const createProtocol = (world: World, onAccepted = vi.fn()) => ({
  protocol: createSubmissionProtocol<ToyDocument>({
    sessions: world.sessions,
    drafts: world.drafts,
    spec: toySpec,
    serverUrl: 'http://api.test/',
    previewUrl,
    productName: 'toyshop.dev',
    onAccepted,
  }),
  onAccepted,
})

const jsonBody = (response: ProtocolResponse): unknown => {
  if (response.content.type !== 'json') throw new Error(`expected json content, got ${response.content.type}`)
  return response.content.body
}

describe('capability resolution', () => {
  it('looks up only the capability hash, never the raw capability', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    await protocol.handleDraftRequest({ method: 'GET', capability: world.capability })

    expect(world.state.lookups).toHaveLength(1)
    expect(world.state.lookups[0]!).not.toBe(world.capability)
    expect(world.state.lookups[0]!).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([[31], [129]])('rejects a %i-character capability without a store lookup', async (length) => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'GET', capability: 'a'.repeat(length) })

    expect(response.status).toBe(404)
    expect(jsonBody(response)).toMatchObject({ error: 'not_found' })
    expect(world.state.lookups).toHaveLength(0)
  })

  it('returns 404 for an unknown capability', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'GET', capability: 'b'.repeat(64) })

    expect(response.status).toBe(404)
    expect(jsonBody(response)).toMatchObject({ error: 'not_found' })
  })

  it('returns 410 with the product name for an expired session', async () => {
    const world = createWorld()
    world.state.session.expiresAt = new Date(Date.now() - 1)
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'GET', capability: world.capability })

    expect(response.status).toBe(410)
    expect(jsonBody(response)).toMatchObject({
      error: 'agent_session_expired',
      message: 'Ask the user for a new toyshop.dev agent prompt.',
    })
  })

  it('returns 410 when the work generation moved past the session', async () => {
    const world = createWorld()
    world.state.workGeneration = 1
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'GET', capability: world.capability })

    expect(response.status).toBe(410)
    expect(jsonBody(response)).toMatchObject({ error: 'agent_session_expired' })
  })

  it('sets private headers on every response', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'GET', capability: world.capability })

    expect(response.headers['Cache-Control']).toBe('no-store')
    expect(response.headers['Referrer-Policy']).toBe('no-referrer')
  })
})

describe('reading the draft', () => {
  it('returns the draft DTO and touches the session', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'GET', capability: world.capability })

    expect(response.status).toBe(200)
    expect(jsonBody(response)).toEqual({
      workId: 'work-1',
      name: 'Signal study',
      revision: 1,
      document: toyDocument(),
      previewUrl: previewUrl(world.capability),
    })
    expect(world.state.touched).toEqual(['session-1'])
  })

  it('carries stored-draft validation warnings in the read response', async () => {
    const world = createWorld()
    world.state.draft = { revision: 1, document: { ...toyDocument(), name: 'Loud!' } }
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'GET', capability: world.capability })

    expect(response.status).toBe(200)
    expect(jsonBody(response)).toMatchObject({
      warnings: [expect.objectContaining({ code: 'doc.loud-name' })],
    })
  })

  it('serves HEAD like GET', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'HEAD', capability: world.capability })

    expect(response.status).toBe(200)
    expect(world.state.touched).toEqual(['session-1'])
  })

  it('returns 404 when the draft is missing', async () => {
    const world = createWorld()
    world.state.draft = null
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'GET', capability: world.capability })

    expect(response.status).toBe(404)
    expect(jsonBody(response)).toMatchObject({ error: 'draft_not_found' })
  })

  it('returns 500 when the stored draft no longer validates', async () => {
    const world = createWorld()
    world.state.draft = { revision: 1, document: { corrupt: true } }
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method: 'GET', capability: world.capability })

    expect(response.status).toBe(500)
    expect(jsonBody(response)).toMatchObject({ error: 'stored_draft_invalid' })
    expect(world.state.touched).toHaveLength(0)
  })
})

describe('method dispatch', () => {
  it.each([['POST'], ['DELETE'], ['OPTIONS']])('answers %s with 405 and an Allow header', async (method) => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({ method, capability: world.capability })

    expect(response.status).toBe(405)
    expect(response.headers.Allow).toBe('GET, HEAD, PUT, PATCH')
    expect(jsonBody(response)).toMatchObject({ error: 'method_not_allowed' })
  })
})

describe('replacing the draft', () => {
  it('accepts a valid replace, commits the sanitized document, and fires onAccepted', async () => {
    const world = createWorld()
    const { protocol, onAccepted } = createProtocol(world)
    const document = { ...toyDocument(), name: 'Replaced' }

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document },
    })

    expect(response.status).toBe(200)
    expect(jsonBody(response)).toEqual({ revision: 2, previewUrl: previewUrl(world.capability) })
    expect(world.state.commits).toHaveLength(1)
    expect(world.state.commits[0]).toMatchObject({
      workId: 'work-1',
      sessionId: 'session-1',
      requiredGeneration: 0,
      expectedRevision: 1,
      nextRevision: 2,
      attribution: 'agent:session-1',
    })
    expect(world.state.commits[0]!.document.name).toBe('Replaced')
    expect(onAccepted).toHaveBeenCalledWith({ workId: 'work-1', revision: 2 })
  })

  it('passes validation warnings through to the commit response', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document: { ...toyDocument(), name: 'Loud!' } },
    })

    expect(response.status).toBe(200)
    expect(jsonBody(response)).toMatchObject({
      revision: 2,
      warnings: [expect.objectContaining({ severity: 'warning', code: 'doc.loud-name' })],
    })
  })

  it('feeds the schema output into validation, so schema transforms apply', async () => {
    const world = createWorld()
    const trimmingSchema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'toy',
        validate: (value) => {
          const document = value as ToyDocument
          return { value: { ...document, name: document.name.trim() } }
        },
      },
    }
    const protocol = createSubmissionProtocol<ToyDocument>({
      sessions: world.sessions,
      drafts: world.drafts,
      spec: { ...toySpec, schema: trimmingSchema },
      serverUrl: 'http://api.test',
      previewUrl,
    })

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document: { ...toyDocument(), name: '  Padded  ' } },
    })

    expect(response.status).toBe(200)
    expect(world.state.commits[0]!.document.name).toBe('Padded')
  })

  it('returns 404 when the draft is missing, before envelope validation', async () => {
    const world = createWorld()
    world.state.draft = null
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: -1 },
    })

    expect(response.status).toBe(404)
    expect(jsonBody(response)).toMatchObject({ error: 'draft_not_found' })
    expect(world.state.commits).toHaveLength(0)
  })

  it('rejects an invalid document with diagnostics and without committing', async () => {
    const world = createWorld()
    const { protocol, onAccepted } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document: { ...toyDocument(), name: '' } },
    })

    expect(response.status).toBe(422)
    expect(jsonBody(response)).toMatchObject({
      error: 'document_invalid',
      diagnostics: [expect.objectContaining({ code: 'doc.empty-name' })],
    })
    expect(world.state.commits).toHaveLength(0)
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('rejects a structurally invalid document with a document.structure diagnostic', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document: { ...toyDocument(), name: 7 } },
    })

    expect(response.status).toBe(422)
    expect(jsonBody(response)).toMatchObject({
      error: 'document_invalid',
      diagnostics: [expect.objectContaining({ code: structuralDiagnosticCode, path: '/name' })],
    })
  })

  it('awaits an async structural schema', async () => {
    const world = createWorld()
    const asyncSchema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'toy',
        validate: async (value) => toySpec.schema['~standard'].validate(value),
      },
    }
    const protocol = createSubmissionProtocol<ToyDocument>({
      sessions: world.sessions,
      drafts: world.drafts,
      spec: { ...toySpec, schema: asyncSchema },
      serverUrl: 'http://api.test',
      previewUrl,
    })

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document: { ...toyDocument(), name: 7 } },
    })

    expect(response.status).toBe(422)
  })

  it('reports the current revision when the commit loses a race', async () => {
    const world = createWorld()
    world.state.commitOverride = { kind: 'conflict', currentRevision: 4 }
    const { protocol, onAccepted } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document: toyDocument() },
    })

    expect(response.status).toBe(409)
    expect(jsonBody(response)).toMatchObject({ error: 'draft_revision_conflict', currentRevision: 4 })
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('omits currentRevision when the store cannot provide one', async () => {
    const world = createWorld()
    world.state.commitOverride = { kind: 'conflict', currentRevision: null }
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document: toyDocument() },
    })

    expect(response.status).toBe(409)
    expect(jsonBody(response)).not.toHaveProperty('currentRevision')
  })

  it('still confirms the commit when the onAccepted hook throws', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world, vi.fn(() => {
      throw new Error('listener exploded')
    }))

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document: toyDocument() },
    })

    expect(response.status).toBe(200)
    expect(jsonBody(response)).toEqual({ revision: 2, previewUrl: previewUrl(world.capability) })
  })

  it('expires the session when the commit finds it gone', async () => {
    const world = createWorld()
    world.state.commitOverride = { kind: 'expired' }
    const { protocol, onAccepted } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PUT',
      capability: world.capability,
      body: { baseRevision: 1, document: toyDocument() },
    })

    expect(response.status).toBe(410)
    expect(jsonBody(response)).toMatchObject({ error: 'agent_session_expired' })
    expect(onAccepted).not.toHaveBeenCalled()
  })
})

describe('patching the draft', () => {
  it('merges nested fields and replaces arrays wholesale', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PATCH',
      capability: world.capability,
      body: { baseRevision: 1, patch: { name: 'Renamed', colors: { accent: '#00ff99' }, tags: ['fresh', 'loud'] } },
    })

    expect(response.status).toBe(200)
    const written = world.state.commits[0]!.document
    expect(written.name).toBe('Renamed')
    expect(written.colors).toEqual({ primary: '#111111', accent: '#00ff99' })
    expect(written.tags).toEqual(['fresh', 'loud'])
  })

  it('returns 500 when the stored draft no longer validates', async () => {
    const world = createWorld()
    world.state.draft = { revision: 1, document: { corrupt: true } }
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PATCH',
      capability: world.capability,
      body: { baseRevision: 1, patch: { name: 'Renamed' } },
    })

    expect(response.status).toBe(500)
    expect(jsonBody(response)).toMatchObject({ error: 'stored_draft_invalid' })
    expect(world.state.commits).toHaveLength(0)
  })

  it('rejects a patch that removes a required field', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleDraftRequest({
      method: 'PATCH',
      capability: world.capability,
      body: { baseRevision: 1, patch: { name: null } },
    })

    expect(response.status).toBe(422)
    expect(jsonBody(response)).toMatchObject({ error: 'document_invalid' })
    expect(world.state.commits).toHaveLength(0)
  })

  it('never pollutes prototypes and drops proto keys from the committed document', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)
    const patch = JSON.parse('{"__proto__": {"polluted": true}, "name": "Renamed"}')

    const response = await protocol.handleDraftRequest({
      method: 'PATCH',
      capability: world.capability,
      body: { baseRevision: 1, patch },
    })

    expect(response.status).toBe(200)
    expect(Object.prototype).not.toHaveProperty('polluted')
    const written = world.state.commits[0]!.document as Record<string, unknown>
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype)
    expect(written.polluted).toBeUndefined()
    expect(written.name).toBe('Renamed')
  })
})

describe('envelope strictness', () => {
  const put = async (world: World, body: unknown) => {
    const { protocol } = createProtocol(world)
    return protocol.handleDraftRequest({ method: 'PUT', capability: world.capability, body })
  }
  const patch = async (world: World, body: unknown) => {
    const { protocol } = createProtocol(world)
    return protocol.handleDraftRequest({ method: 'PATCH', capability: world.capability, body })
  }

  const expectInvalidRequest = (world: World, response: ProtocolResponse) => {
    expect(response.status).toBe(400)
    expect(jsonBody(response)).toMatchObject({ error: 'invalid_request' })
    expect(world.state.commits).toHaveLength(0)
  }

  it.each([
    ['an unknown envelope key', { baseRevision: 1, document: toyDocument(), documents: true }],
    ['a missing document key', { baseRevision: 1 }],
    ['a negative baseRevision', { baseRevision: -1, document: toyDocument() }],
    ['a fractional baseRevision', { baseRevision: 1.5, document: toyDocument() }],
    ['a string baseRevision', { baseRevision: '1', document: toyDocument() }],
  ])('PUT rejects %s', async (_label, body) => {
    const world = createWorld()
    expectInvalidRequest(world, await put(world, body))
  })

  it.each([
    ['an unknown envelope key', { baseRevision: 1, patch: {}, extra: true }],
    ['a missing patch key', { baseRevision: 1 }],
    ['an array patch', { baseRevision: 1, patch: [] }],
    ['a null patch', { baseRevision: 1, patch: null }],
    ['a string patch', { baseRevision: 1, patch: 'name' }],
    ['a negative baseRevision', { baseRevision: -1, patch: {} }],
    ['a fractional baseRevision', { baseRevision: 1.5, patch: {} }],
    ['a string baseRevision', { baseRevision: '1', patch: {} }],
  ])('PATCH rejects %s', async (_label, body) => {
    const world = createWorld()
    expectInvalidRequest(world, await patch(world, body))
  })
})

describe('minting on the instance', () => {
  it('mints with the configured ttl and one server url', () => {
    const world = createWorld()
    const protocol = createSubmissionProtocol<ToyDocument>({
      sessions: world.sessions,
      drafts: world.drafts,
      spec: toySpec,
      serverUrl: 'http://api.test/',
      previewUrl,
      sessionTtlMs: 60 * 60 * 1000,
    })
    const now = new Date('2026-07-30T12:00:00Z')

    const minted = protocol.mintSession(now)

    expect(minted.expiresAt.getTime() - now.getTime()).toBe(60 * 60 * 1000)
    expect(minted.sessionUrl).toBe(`http://api.test/agent/sessions/${minted.capability}`)
  })
})

describe('session briefing', () => {
  it('serves markdown pointing at the session and both docs', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleSessionRequest({ capability: world.capability })

    expect(response.status).toBe(200)
    expect(response.content.type).toBe('markdown')
    const body = response.content.body as string
    expect(body).toContain('# toyshop.dev agent session')
    expect(body).toContain(`http://api.test/agent/sessions/${world.capability}`)
    expect(body).toContain(world.state.session.expiresAt.toISOString())
    expect(body).toContain('http://api.test/agent/docs/api.md')
    expect(body).toContain('http://api.test/agent/docs/schema.md')
  })

  it('answers an unknown capability with 404', async () => {
    const world = createWorld()
    const { protocol } = createProtocol(world)

    const response = await protocol.handleSessionRequest({ capability: 'b'.repeat(64) })

    expect(response.status).toBe(404)
  })

  it('answers an expired session with 410', async () => {
    const world = createWorld()
    world.state.session.expiresAt = new Date(Date.now() - 1)
    const { protocol } = createProtocol(world)

    const response = await protocol.handleSessionRequest({ capability: world.capability })

    expect(response.status).toBe(410)
    expect(jsonBody(response)).toMatchObject({ error: 'agent_session_expired' })
  })

  it('answers a session without a draft with 404', async () => {
    const world = createWorld()
    world.state.draft = null
    const { protocol } = createProtocol(world)

    const response = await protocol.handleSessionRequest({ capability: world.capability })

    expect(response.status).toBe(404)
    expect(jsonBody(response)).toMatchObject({ error: 'draft_not_found' })
  })
})

