import type { JsonValue, ProtocolResponse, WorkModel } from './contract'
import { problemDefinitions, protocolProblem } from './problems'

export const docsPath = 'agent/docs'

export const createModelDocs = <TDocument extends JsonValue>(options: {
  model: Pick<WorkModel<TDocument, unknown>, 'id' | 'version' | 'schema' | 'authoring'>
  serverUrl: string
  productName?: string
  authoringGuidance?: string
}) => {
  const base = `${options.serverUrl.replace(/\/$/, '')}/${docsPath}/${encodeURIComponent(options.model.id)}/${encodeURIComponent(options.model.version)}`
  const paths = {
    protocol: `${base}/protocol.md`,
    work: `${base}/work.md`,
    schema: `${base}/schema.json`,
  }
  const files = new Map<string, ProtocolResponse['content']>([
    ['protocol.md', { type: 'markdown', body: renderProtocolDoc(options, paths) }],
    ['work.md', { type: 'markdown', body: renderWorkDoc(options, paths) }],
    ['schema.json', { type: 'json', body: options.model.schema.jsonSchema }],
  ])

  const handleDocsRequest = (request: { model: string; version: string; document: string }): ProtocolResponse => {
    if (request.model !== options.model.id || request.version !== options.model.version) return docsNotFound()
    const content = files.get(request.document)
    if (!content) return docsNotFound()
    const contentType = content.type === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/schema+json'
    return {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
        'Content-Type': contentType,
      },
      content,
    }
  }

  return { paths, handleDocsRequest }
}

const renderProtocolDoc = <TDocument extends JsonValue>(
  options: { model: Pick<WorkModel<TDocument, unknown>, 'id' | 'version' | 'authoring'>; productName?: string },
  paths: { work: string; schema: string },
) => {
  const problems = Object.entries(problemDefinitions)
    .map(([code, definition]) => `| ${definition.status} | \`${code}\` | ${definition.detail} | ${definition.extensions.length ? definition.extensions.map((extension) => `\`${extension}\``).join(', ') : ''} |`)
    .join('\n')
  return `# ${options.productName ?? options.model.authoring.title} agent work protocol

This capability URL grants temporary access to one work target. Never send it to another host.

1. Read ${paths.work} and ${paths.schema}.
2. GET {sessionUrl}/work and retain its ETag.
3. PUT the complete canonical JSON document with Content-Type: application/json and If-Match.
4. Or PATCH with a JSON Patch operation array, Content-Type: application/json-patch+json, and If-Match.
5. Refetch after a 412 response before retrying.

GET and HEAD expose a strong revision ETag such as \`"4"\`. PUT and PATCH require \`If-Match\` and accept standard strong ETag lists or \`*\`. Weak ETags and non-revision entity tags are invalid. Successful responses contain the committed revision, canonical document, and assessment. Assessment contains \`outcome\` and \`diagnostics\`; outcome is fail when any diagnostic has severity error, otherwise pass.

## JSON Patch profile

The protocol supports the RFC 6902 \`add\`, \`remove\`, \`replace\`, \`move\`, \`copy\`, and \`test\` operations, including array indices and \`-\` append. To keep documents safe with ordinary JavaScript objects, the JSON member names and pointer segments \`__proto__\`, \`prototype\`, and \`constructor\` are reserved and rejected.

Patch failures include \`patchCode\` and, when tied to an operation, its zero-based \`operation\` index. Schema failures include \`diagnostics\`; policy failures include \`assessment\`; conflicts may include \`currentRevision\` when the store can provide it.

## Problems

Problems use \`application/problem+json\`.

| Status | Code | Meaning | Extensions |
| --- | --- | --- | --- |
${problems}`
}

const renderWorkDoc = <TDocument extends JsonValue>(
  options: {
    model: Pick<WorkModel<TDocument, unknown>, 'id' | 'version' | 'authoring'>
    authoringGuidance?: string
  },
  paths: { schema: string },
) => {
  const examples = options.model.authoring.examples?.length
    ? `\n\n## Examples\n\n${options.model.authoring.examples.map((example) => `\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\``).join('\n\n')}`
    : ''
  const diagnostics = options.model.authoring.diagnostics.length
    ? `\n\n## Diagnostics\n\n${options.model.authoring.diagnostics.map((definition) => `- \`${definition.code}\` ${definition.title}: ${definition.description}`).join('\n')}`
    : ''
  const guidance = options.authoringGuidance ? `\n\n## Authoring guidance\n\n${options.authoringGuidance}` : ''
  return `# ${options.model.authoring.title}\n\n${options.model.authoring.description ?? ''}\n\nModel: \`${options.model.id}\` version \`${options.model.version}\`\n\nJSON Schema: ${paths.schema}${guidance}${examples}${diagnostics}`
}

const docsNotFound = (): ProtocolResponse => protocolProblem('docs-not-found')
