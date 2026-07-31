import { describe, expect, it, vi } from 'vitest'
import { createExpressHandlers } from '../src/adapters/express'
import { createSubmissionProtocol } from '../src/submission'
import { createWorld, toySpec, type ToyDocument, type World } from './fakes'

const createHandlers = (world: World) => createExpressHandlers(createSubmissionProtocol<ToyDocument>({
  sessions: world.sessions,
  drafts: world.drafts,
  spec: toySpec,
  serverUrl: 'http://api.test',
  previewUrl: (capability) => `http://front.test/agent-preview/${capability}`,
}))

const createResponse = () => {
  const response = {
    set: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
    type: vi.fn(),
    send: vi.fn(),
  }
  response.type.mockReturnValue(response)
  return response
}

describe('express adapter', () => {
  it('serves the draft with private headers through the draft handler', async () => {
    const world = createWorld()
    const response = createResponse()

    await createHandlers(world).draft(
      { method: 'GET', params: { capability: world.capability }, body: undefined } as never,
      response as never,
    )

    expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store')
    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ workId: 'work-1' }))
  })

  it('serves markdown docs through the docs handler', async () => {
    const world = createWorld()
    const response = createResponse()

    createHandlers(world).docs({ params: { doc: 'api.md' } } as never, response as never)

    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.type).toHaveBeenCalledWith('text/markdown')
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('submission API'))
  })

  it('treats a repeated capability param as unresolvable', async () => {
    const world = createWorld()
    const response = createResponse()

    await createHandlers(world).draft(
      { method: 'GET', params: { capability: [world.capability, world.capability] }, body: undefined } as never,
      response as never,
    )

    expect(response.status).toHaveBeenCalledWith(404)
    expect(world.state.lookups).toHaveLength(0)
  })
})
