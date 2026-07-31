# agent-work-protocol

HTTP protocol for AI agents submitting structured work to your app: short-lived capability sessions, draft PUT/PATCH with optimistic concurrency, schema validation with agent-readable diagnostics, and self-served agent docs.

## Install

```sh
npm install @infomiho/agent-work-protocol
```

## Usage

```ts
import { createSubmissionProtocol } from '@infomiho/agent-work-protocol/server'
import { createExpressHandlers } from '@infomiho/agent-work-protocol/adapters/express'

const protocol = createSubmissionProtocol({
  spec,      // your document: Standard Schema + JSON Schema + rules + validate()
  sessions,  // session lookup and touch
  drafts,    // one atomic conditional write
  serverUrl: 'https://api.example.com',
  previewUrl: (capability) => `https://example.com/preview/${capability}`,
})

const handlers = createExpressHandlers(protocol)
// mount handlers.session, handlers.draft, handlers.docs on your routes,
// hand protocol.mintSession().sessionUrl to an agent
```

## Entries

- `@infomiho/agent-work-protocol`: browser-safe wire contract and prompt helpers
- `@infomiho/agent-work-protocol/server`: the protocol engine (Node)
- `@infomiho/agent-work-protocol/adapters/express`: Express handlers

## Docs

[Integration guide](docs/README.md): implementing the stores, authoring a DocumentSpec, wiring routes.
