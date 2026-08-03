import type { NextFunction, Request, Response } from 'express'
import type { ProtocolRequest, ProtocolResponse } from '../contract'

export type ExpressProtocol = {
  handleSessionRequest: (request: { capability: string }) => Promise<ProtocolResponse>
  handleWorkRequest: (request: ProtocolRequest) => Promise<ProtocolResponse>
  handleDocsRequest: (request: { model: string; version: string; document: string }) => ProtocolResponse
}

export const createExpressHandlers = (protocol: ExpressProtocol) => ({
  session: (req: Request, res: Response, next: NextFunction) => forward(next, async () => {
    send(res, await protocol.handleSessionRequest({ capability: routeParam(req.params.capability) }))
  }),
  work: (req: Request, res: Response, next: NextFunction) => forward(next, async () => {
    send(res, await protocol.handleWorkRequest({
      method: req.method,
      capability: routeParam(req.params.capability),
      headers: { 'if-match': header(req.headers['if-match']) },
      contentType: req.get('content-type'),
      body: req.body,
    }))
  }),
  docs: (req: Request, res: Response, next: NextFunction) => forward(next, () => {
    send(res, protocol.handleDocsRequest({
      model: routeParam(req.params.model),
      version: routeParam(req.params.version),
      document: routeParam(req.params.document),
    }))
  }),
})

const forward = (next: NextFunction, run: () => void | Promise<void>) => {
  try {
    void Promise.resolve(run()).catch(next)
  } catch (error) {
    next(error)
  }
}

const send = (res: Response, response: ProtocolResponse) => {
  for (const [name, value] of Object.entries(response.headers)) res.set(name, value)
  res.status(response.status)
  if (response.content.type === 'none') {
    res.end()
  } else if (response.content.type === 'markdown') {
    res.send(response.content.body)
  } else {
    res.json(response.content.body)
  }
}

const routeParam = (value: string | string[] | undefined) => typeof value === 'string' ? value : ''
const header = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined
