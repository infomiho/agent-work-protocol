import { describe, expect, it } from 'vitest'
import { createModelDocs, problemDefinitions } from '../src/server'
import { model } from './support'

describe('versioned model docs', () => {
  it('publishes versioned protocol, model, and schema docs with the public contract', () => {
    const docs = createModelDocs({ model, serverUrl: 'https://api.test', authoringGuidance: 'Keep names concise.' })
    const protocol = docs.handleDocsRequest({ model: 'theme', version: '1', document: 'protocol.md' })
    const work = docs.handleDocsRequest({ model: 'theme', version: '1', document: 'work.md' })
    const schema = docs.handleDocsRequest({ model: 'theme', version: '1', document: 'schema.json' })

    expect(protocol).toMatchObject({ status: 200, headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } })
    expect(protocol.content).toMatchObject({ type: 'markdown', body: expect.stringContaining('standard strong ETag lists or `*`') })
    expect(protocol.content).toMatchObject({ type: 'markdown', body: expect.stringContaining('`__proto__`, `prototype`, and `constructor`') })
    for (const [code, definition] of Object.entries(problemDefinitions)) {
      expect((protocol.content as { body: string }).body).toContain(`| ${definition.status} | \`${code}\``)
      for (const extension of definition.extensions) expect((protocol.content as { body: string }).body).toContain(`\`${extension}\``)
    }
    expect(work.content).toMatchObject({ type: 'markdown', body: expect.stringContaining('Keep names concise.') })
    expect(schema.content).toEqual({ type: 'json', body: model.schema.jsonSchema })
  })

  it.each([
    { model: 'other', version: '1', document: 'protocol.md' },
    { model: 'theme', version: '2', document: 'protocol.md' },
    { model: 'theme', version: '1', document: 'missing.md' },
  ])('returns a private stable 404 for unknown docs', (request) => {
    const response = createModelDocs({ model, serverUrl: 'https://api.test' }).handleDocsRequest(request)
    expect(response).toMatchObject({
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/problem+json' },
      content: { type: 'problem', body: { code: 'docs-not-found' } },
    })
  })
})
