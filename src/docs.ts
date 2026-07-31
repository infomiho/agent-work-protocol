import {
  protocolErrors,
  sessionLifetimeMs,
  structuralDiagnosticCode,
  type DocumentSpec,
  type ProtocolResponse,
} from './contract'

export const docsPath = 'agent/docs'

export type DocsDeps = {
  spec: Pick<DocumentSpec<unknown>, 'name' | 'jsonSchema' | 'rules'>
  serverUrl: string
  productName?: string
  ttlMs?: number
}

export type DocsRequest = {
  doc: string
}

export const createDocs = (deps: DocsDeps) => {
  const files = new Map<string, DocContent>([
    ['api.md', { type: 'markdown', body: renderApiDoc(deps) }],
    ['schema.md', { type: 'markdown', body: renderSchemaDoc(deps) }],
    ['schema.json', { type: 'json', body: deps.spec.jsonSchema }],
  ])

  const handleDocsRequest = ({ doc }: DocsRequest): ProtocolResponse => {
    const content = files.get(doc)
    if (!content) {
      return {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
        content: { type: 'json', body: { error: 'not_found', message: 'Unknown document.' } },
      }
    }
    return { status: 200, headers: { ...publicHeaders }, content }
  }

  return { handleDocsRequest }
}

export const renderApiDoc = ({ spec, serverUrl, productName, ttlMs }: DocsDeps) => {
  const errorRows = protocolErrors
    .map((entry) => `| ${entry.status} | \`${entry.code}\` | ${entry.meaning} |`)
    .join('\n')

  return `# ${productName ?? 'Agent'} submission API

The temporary session URL is scoped to one draft and expires after ${formatTtl(ttlMs ?? sessionLifetimeMs)}. Never send it to another host.

## Workflow

1. Open the session URL and read both linked references:
   - ${serverUrl}/${docsPath}/api.md (this document)
   - ${serverUrl}/${docsPath}/schema.md (the ${spec.name} reference)
2. \`GET {sessionUrl}/draft\` and use its current document as the starting point.
3. Ask the user to describe the intended direction before changing the draft.
4. Change the document and write it back: \`PUT\` the complete document, or \`PATCH\` only the fields that change. Send the current \`baseRevision\` either way.
5. Open the returned \`previewUrl\` in a browser and visually inspect the result after every accepted update.

Use HTTP tools, not repository edits.

## Read the draft

\`GET {sessionUrl}/draft\`

The response contains \`workId\`, \`name\`, \`revision\`, \`document\`, and \`previewUrl\`.

## Replace the draft

\`PUT {sessionUrl}/draft\`

Send \`Content-Type: application/json\` with the complete document:

\`\`\`json
{
  "baseRevision": 0,
  "document": {}
}
\`\`\`

Set \`baseRevision\` to the revision returned by the latest GET. A successful update returns the next \`revision\` and \`previewUrl\`.

## Patch the draft

\`PATCH {sessionUrl}/draft\`

Send \`Content-Type: application/json\` with only the fields that change (JSON Merge Patch, RFC 7396):

\`\`\`json
{
  "baseRevision": 0,
  "patch": { "name": "Renamed" }
}
\`\`\`

The patch is applied to the stored draft, then the merged result is validated as a complete document. Objects merge recursively. Arrays are replaced wholesale, so send the full array when changing one entry. A \`null\` removes a key, and removing a required field makes the result invalid. Prefer PATCH for small edits and PUT when restructuring the whole document.

## Preview

Open the \`previewUrl\` returned by the draft and update endpoints.

## Responses

| Status | Code | What to do |
| --- | --- | --- |
${errorRows}

Validation failures return \`diagnostics\`. Entries with code \`${structuralDiagnosticCode}\` come from the published JSON Schema (${serverUrl}/${docsPath}/schema.json); every other code is documented in the schema reference. A rejected update does not advance the revision. Successful responses may carry non-blocking \`warnings\` in the same diagnostic shape.

A successful PUT or PATCH confirms schema validity, not visual quality.`
}

export const renderSchemaDoc = ({ spec, serverUrl }: DocsDeps) => {
  const ruleSections = spec.rules
    .map((rule) => `## ${rule.title}

Diagnostic codes start with \`${rule.code}\`.

${rule.description}`)
    .join('\n\n')

  return `# ${spec.name} reference

The JSON Schema is published at ${serverUrl}/${docsPath}/schema.json. Matching it is necessary but not sufficient: the rules below are enforced on top of it. Structural violations are reported as diagnostics with code \`${structuralDiagnosticCode}\`; every other diagnostic code belongs to one of the rules below.

${ruleSections}`
}

const formatTtl = (ttlMs: number) => {
  const hours = ttlMs / (60 * 60 * 1000)
  if (Number.isInteger(hours)) return hours === 1 ? '1 hour' : `${hours} hours`
  return `${Math.round(ttlMs / (60 * 1000))} minutes`
}

type DocContent =
  | { type: 'markdown'; body: string }
  | { type: 'json'; body: unknown }

const publicHeaders = {
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*',
} as const
