# Integration guide

The library implements an HTTP protocol that lets AI agents edit work stored in your app. You implement a document definition and two storage callbacks. The library implements capability sessions, draft reads and writes, conflict detection, validation errors, and the documentation agents read.

The end user flow:

1. The user clicks a button in your app and receives a prompt containing a temporary session link.
2. The user pastes the prompt into any agent that can make HTTP requests.
3. The agent opens the link, reads the served docs, fetches the current draft, and submits changes with PUT or PATCH.
4. The user reviews the updated draft in your app, requests more changes, or saves.

The reference integration is [codeshot.dev](https://codeshot.dev) ([source](https://github.com/infomiho/code-screenshot/tree/main/src/ambient/management/agent)), where agents design code screenshot themes.

## Wiring

```ts
import { createSubmissionProtocol } from '@infomiho/agent-work-protocol/server'
import { createExpressHandlers } from '@infomiho/agent-work-protocol/adapters/express'

const protocol = createSubmissionProtocol({
  spec,           // DocumentSpec
  sessions,       // SessionStore
  drafts,         // DraftStore
  serverUrl,      // base URL for session and docs URLs
  previewUrl,     // (capability) => URL where the agent can view its work
  productName,    // optional, used in rendered docs and messages
  sessionTtlMs,   // optional, default 24h
  onAccepted,     // optional, called after a commit lands
})

const handlers = createExpressHandlers(protocol)
```

| Route | Methods | Handler |
| --- | --- | --- |
| `/agent/sessions/:capability` | GET | `handlers.session` |
| `/agent/sessions/:capability/draft` | GET, HEAD, PUT, PATCH | `handlers.draft` |
| `/agent/docs/:doc` | GET | `handlers.docs` |

The path segments are exported as `sessionPath` and `docsPath`. Set the JSON body limit to fit your documents. Disable request logging on these routes because the capability is part of the URL.

Reference: [agent-api.ts](https://github.com/infomiho/code-screenshot/blob/main/src/ambient/management/agent/agent-api.ts), [agent.wasp.ts](https://github.com/infomiho/code-screenshot/blob/main/src/ambient/management/agent/agent.wasp.ts).

## Sessions

`protocol.mintSession()` returns `{ capability, capabilityHash, expiresAt, sessionUrl }`. Store the hash and expiry, never the capability. Give `sessionUrl` to the user inside a prompt built with `buildAgentPrompt` from the root entry.

Revocation uses a generation counter on the work: creating access increments the counter, expires existing session rows, and inserts a row with the new hash and the current generation. Incrementing the counter again invalidates the link immediately. Reference: [`createAgentAccess`](https://github.com/infomiho/code-screenshot/blob/main/src/ambient/management/ambient-operations.ts).

## SessionStore

```ts
type SessionStore = {
  findByCapabilityHash: (hash: string) => Promise<SessionView | null>
  touch: (sessionId: string) => Promise<void>   // stamps lastUsedAt on reads
}

type SessionView = {
  session: { id: string; workId: string; generation: number; expiresAt: Date }
  workName: string
  workGeneration: number    // the work's current generation
  draft: { revision: number; document: unknown } | null
}
```

The library compares generation and expiry. The store only fetches.

## DraftStore

```ts
type DraftStore<TDocument> = {
  commit: (command: CommitCommand<TDocument>) => Promise<CommitOutcome>
}
```

`commit` is one transaction with two condition checks, all inputs provided in the command:

1. The session row still matches `{ sessionId, requiredGeneration, expiresAt > now }`. Stamp `lastUsedAt` in the same update. On zero rows return `{ kind: 'expired' }`.
2. The draft revision still equals `expectedRevision`. On zero rows read the current revision in the same transaction and return `{ kind: 'conflict', currentRevision }`.
3. Write `document` at `nextRevision` with `attribution` as the author and return `{ kind: 'accepted', revision: nextRevision }`.

Skipping check 1 allows revoked sessions to keep writing. Test all three outcomes: [agent-prisma-binding.test.ts](https://github.com/infomiho/code-screenshot/blob/main/tests/unit/agent-prisma-binding.test.ts).

## DocumentSpec

```ts
type DocumentSpec<TDocument> = {
  name: string
  schema: StandardSchemaV1              // zod, valibot, arktype
  jsonSchema: Record<string, unknown>   // derive from schema, e.g. z.toJSONSchema
  rules: readonly DocRule[]             // constraints the schema can't express
  validate: (input: unknown) => DocumentValidation<TDocument>
}
```

Constraints:

- `schema` runs before `validate` and must never reject a document `validate` would accept. When `validate` is the stricter authority, keep the schema looser.
- `validate` receives the schema's output, so schema defaults and transforms apply.
- Rules are `{ code, title, description }`. Use the code families your diagnostics carry and the rendered docs document every rejection an agent can see.
- Diagnostics are `{ severity, code, path?, message }` with JSON Pointer paths. Diagnostics returned with a valid document reach the agent as warnings.

Reference: [document-spec.ts](https://github.com/infomiho/code-screenshot/blob/main/src/ambient/document-spec.ts).

## Served documentation

The server renders `api.md`, `schema.md`, and `schema.json` at `{serverUrl}/agent/docs/` from the spec and the error taxonomy. The session endpoint returns a briefing that links them. There are no protocol docs to write or host separately.
