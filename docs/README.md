# Integration guide

## Model

`WorkModel<TDocument extends JsonValue, TArtifacts>` defines one versioned canonical JSON model:

```ts
const model = {
  id: 'theme',
  version: '1',
  schema: {
    decoder,    // Standard Schema decoder
    jsonSchema, // generated from the same schema source
  },
  assess: (document) => ({ diagnostics, artifacts }),
  authoring: { title, description, examples, diagnostics: definitions },
}
```

The decoder runs before assessment. Diagnostics use `{ severity, code, message, pointer, help? }`, where `pointer` is an RFC 6901 JSON Pointer. An assessment fails when any diagnostic has severity `error`. Artifacts stay host-side and are available to `revisionCommitted`; they are never included in protocol responses.

Use `assessed` to commit every structurally decoded document, including documents with domain errors. Use `noErrors` to reject assessments containing errors.

## Storage

`SessionStore<TAuthority>` resolves only a SHA-256 capability hash. Its session result contains an expiry, one `RevisionTarget`, and an opaque host-defined authority value. The package does not prescribe generation counters or ownership models. Capability secrets must remain between 32 and 128 characters; invalid lengths never reach the store.

`RevisionStore<TDocument, TAuthority>` has two operations:

```ts
type RevisionStore<TDocument, TAuthority> = {
  read(command: {
    target: RevisionTarget
    authority: TAuthority
    now: Date
  }): Promise<
    | { kind: 'read'; revision: number; document: TDocument }
    | { kind: 'target-not-found' }
    | { kind: 'authority-rejected'; reason: 'expired' | 'revoked' | 'forbidden' }
  >
  commit(command): Promise<
    | { kind: 'committed'; revision: number }
    | { kind: 'conflict'; currentRevision: number | null }
    | { kind: 'target-not-found' }
    | { kind: 'authority-rejected'; reason: 'expired' | 'revoked' | 'forbidden' }
  >
}
```

Both operations must verify the opaque authority at `now` before returning work or its revision. Return `expired` or `revoked` when consumers should receive 410. Return `forbidden` to conceal an inaccessible target behind 404. Revisions are non-negative safe integers.

`commit` receives `{ target, authority, now, expectedRevision, document }` and is one atomic compare-and-swap. In the same transaction, verify authority, compare `expectedRevision`, compute and persist the next revision, and return that revision. The package performs an authorized early revision check for patch safety; the store remains responsible for the final authority check and CAS.

`revisionCommitted` is explicitly best-effort. It runs only after a committed outcome. Thrown errors and rejected promises do not alter the HTTP response.

## Routes

| Route | Methods | Handler |
| --- | --- | --- |
| `/agent/sessions/:capability` | GET | `handlers.session` |
| `/agent/sessions/:capability/work` | GET, HEAD, PUT, PATCH | `handlers.work` |
| `/agent/docs/:model/:version/:document` | GET | `handlers.docs` |

PUT accepts the complete canonical document as `application/json`. PATCH accepts `add`, `remove`, `replace`, `move`, `copy`, and `test` operations as `application/json-patch+json`. Both require `If-Match`, which accepts strong revision ETag lists such as `"3", "4"` and the standard `*` wildcard. Weak ETags are rejected. Representation and content-type errors take precedence over a missing precondition.

The JSON member names and pointer segments `__proto__`, `prototype`, and `constructor` are reserved. This is a deliberate secure subset of RFC 6902, not unrestricted JSON Patch. Configure the host JSON parser's body limit; an exceeded host limit should use the stable `payload-too-large` problem with status 413.

Capability routes send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Disable access logging for capability URLs.

Generated versioned docs are `protocol.md`, `work.md`, and `schema.json`. Pass product-specific instructions through `authoringGuidance`; the package does not invent host authoring guidance.

Problem responses use `application/problem+json`. Generated `protocol.md` is sourced from the same definitions as runtime responses and lists every code and status. Important extensions are `currentRevision`, `diagnostics`, `assessment`, `patchCode`, and the zero-based patch `operation` index.
