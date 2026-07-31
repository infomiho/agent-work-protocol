import { describe, expect, it } from 'vitest'
import { protocolErrors, structuralDiagnosticCode } from '../src/contract'
import { createDocs, renderApiDoc, renderSchemaDoc } from '../src/docs'
import { toySpec } from './fakes'

const deps = { spec: toySpec, serverUrl: 'http://api.test', productName: 'toyshop.dev' }

describe('rendered docs', () => {
  it('documents every protocol error code in the api doc', () => {
    const apiDoc = renderApiDoc(deps)
    for (const entry of protocolErrors) {
      expect(apiDoc).toContain(`\`${entry.code}\``)
      expect(apiDoc).toContain(String(entry.status))
    }
  })

  it('documents the structural diagnostic code and the schema.json URL in the api doc', () => {
    const apiDoc = renderApiDoc(deps)
    expect(apiDoc).toContain(structuralDiagnosticCode)
    expect(apiDoc).toContain('http://api.test/agent/docs/schema.json')
  })

  it('documents every rule with its code in the schema doc', () => {
    const schemaDoc = renderSchemaDoc(deps)
    for (const rule of toySpec.rules) {
      expect(schemaDoc).toContain(rule.title)
      expect(schemaDoc).toContain(`\`${rule.code}\``)
    }
  })

  it('states that the JSON Schema is necessary but not sufficient', () => {
    expect(renderSchemaDoc(deps)).toContain('necessary but not sufficient')
  })

  it.each([
    [undefined, '24 hours'],
    [60 * 60 * 1000, '1 hour'],
    [30 * 60 * 1000, '30 minutes'],
  ])('renders a ttl of %s as %s', (ttlMs, rendered) => {
    expect(renderApiDoc({ ...deps, ...(ttlMs === undefined ? {} : { ttlMs }) })).toContain(`expires after ${rendered}`)
  })
})

describe('docs endpoint', () => {
  const { handleDocsRequest } = createDocs(deps)

  it('serves markdown docs with public caching', () => {
    const response = handleDocsRequest({ doc: 'api.md' })

    expect(response.status).toBe(200)
    expect(response.content.type).toBe('markdown')
    expect(response.headers['Cache-Control']).toBe('public, max-age=300')
    expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('serves the JSON Schema verbatim', () => {
    const response = handleDocsRequest({ doc: 'schema.json' })

    expect(response.status).toBe(200)
    expect(response.content).toEqual({ type: 'json', body: toySpec.jsonSchema })
  })

  it('answers an unknown document with an uncached 404', () => {
    const response = handleDocsRequest({ doc: 'secrets.md' })

    expect(response.status).toBe(404)
    expect(response.headers['Cache-Control']).toBe('no-store')
    expect(response.content).toMatchObject({ type: 'json', body: { error: 'not_found' } })
  })
})
