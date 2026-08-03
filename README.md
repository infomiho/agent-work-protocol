# agent-work-protocol

Capability-scoped HTTP protocol for agents editing assessed, revisioned JSON work.

## Install

```sh
npm install @infomiho/agent-work-protocol
```

## Usage

```ts
import { assessed, createAgentWorkProtocol } from '@infomiho/agent-work-protocol/server'
import { createExpressHandlers } from '@infomiho/agent-work-protocol/adapters/express'

const protocol = createAgentWorkProtocol({
  model,
  sessions,
  revisions,
  policy: assessed,
  serverUrl: 'https://api.example.com',
})

const handlers = createExpressHandlers(protocol)
```

Mount `handlers.session`, `handlers.work`, and `handlers.docs` on the routes documented in the [integration guide](docs/README.md).

## Entries

- `@infomiho/agent-work-protocol`: browser-safe wire types, diagnostics, JSON Patch types, ETag helpers, and prompt helpers
- `@infomiho/agent-work-protocol/server`: capability crypto, session resolution, revision intake, protocol, and generated docs
- `@infomiho/agent-work-protocol/adapters/express`: thin Express handlers

Canonical documents are `JsonValue`. The protocol reserves the JSON keys `__proto__`, `prototype`, and `constructor`; see the integration guide for storage authority and HTTP details.
