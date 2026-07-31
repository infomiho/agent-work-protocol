import type { Request, Response } from 'express'
import type { ProtocolResponse } from '../contract'
import type { SubmissionProtocol } from '../submission'

export const createExpressHandlers = <TDocument>(protocol: SubmissionProtocol<TDocument>) => ({
  session: async (req: Request, res: Response) => {
    send(res, await protocol.handleSessionRequest({ capability: routeParam(req.params.capability) }))
  },
  draft: async (req: Request, res: Response) => {
    send(res, await protocol.handleDraftRequest({
      method: req.method,
      capability: routeParam(req.params.capability),
      body: req.body,
    }))
  },
  docs: (req: Request, res: Response) => {
    send(res, protocol.handleDocsRequest({ doc: routeParam(req.params.doc) }))
  },
})

const send = (res: Response, response: ProtocolResponse) => {
  for (const [name, value] of Object.entries(response.headers)) {
    res.set(name, value)
  }
  res.status(response.status)
  if (response.content.type === 'markdown') {
    res.type('text/markdown').send(response.content.body)
  } else {
    res.json(response.content.body)
  }
}

// Express 5 types params as string | string[]. A repeated param is never
// valid here, so treat it as empty.
const routeParam = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : ''
