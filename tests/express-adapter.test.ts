import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { createExpressHandlers } from '../src/adapters/express'

const response = () => ({
  set: vi.fn(), status: vi.fn(), send: vi.fn(), json: vi.fn(), end: vi.fn(),
})
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Express adapter', () => {
  it('passes transport fields to work and sends its response', async () => {
    const handleWorkRequest = vi.fn(async () => ({
      status: 200, headers: { ETag: '"2"' }, content: { type: 'json' as const, body: { revision: 2 } },
    }))
    const handlers = createExpressHandlers({ handleSessionRequest: vi.fn(), handleWorkRequest, handleDocsRequest: vi.fn() })
    const res = response()
    handlers.work({
      method: 'PATCH', params: { capability: 'capability' }, headers: { 'if-match': '"1"' },
      body: [{ op: 'remove', path: '/old' }], get: () => 'application/json-patch+json',
    } as unknown as Request, res as unknown as Response, vi.fn())
    await flush()

    expect(handleWorkRequest).toHaveBeenCalledWith({
      method: 'PATCH', capability: 'capability', headers: { 'if-match': '"1"' },
      contentType: 'application/json-patch+json', body: [{ op: 'remove', path: '/old' }],
    })
    expect(res.json).toHaveBeenCalledWith({ revision: 2 })
  })

  it('ends bodyless responses and rejects repeated route params', async () => {
    const handleWorkRequest = vi.fn(async () => ({ status: 200, headers: {}, content: { type: 'none' as const } }))
    const handlers = createExpressHandlers({ handleSessionRequest: vi.fn(), handleWorkRequest, handleDocsRequest: vi.fn() })
    const res = response()
    handlers.work({ method: 'HEAD', params: { capability: ['one', 'two'] }, headers: {}, get: () => undefined } as unknown as Request, res as unknown as Response, vi.fn())
    await flush()

    expect(handleWorkRequest).toHaveBeenCalledWith(expect.objectContaining({ capability: '' }))
    expect(res.end).toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  it.each(['session', 'work', 'docs'] as const)('forwards rejected or thrown %s handlers to next', async (name) => {
    const error = new Error(`${name} failed`)
    const protocol = {
      handleSessionRequest: vi.fn(async () => { throw error }),
      handleWorkRequest: vi.fn(async () => { throw error }),
      handleDocsRequest: vi.fn(() => { throw error }),
    }
    const handlers = createExpressHandlers(protocol)
    const next = vi.fn()
    const req = { method: 'GET', params: {}, headers: {}, get: () => undefined } as unknown as Request
    handlers[name](req, response() as unknown as Response, next as NextFunction)
    await flush()
    expect(next).toHaveBeenCalledWith(error)
  })
})
