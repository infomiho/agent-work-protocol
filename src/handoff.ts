export type PromptContent = {
  goal: string
  setup: string
  beforeEditing: string
}

export const buildAgentPrompt = (content: PromptContent, sessionUrl: string) => `${content.goal}

${content.setup}
${sessionUrl}

${content.beforeEditing}
`

export type SessionBriefing = {
  productName?: string
  sessionUrl: string
  expiresAt: Date
  docs: { api: string; schema: string }
}

export const renderSessionBriefing = ({ productName, sessionUrl, expiresAt, docs }: SessionBriefing) =>
  `# ${productName ? `${productName} agent session` : 'Agent session'}

Session URL: ${sessionUrl}
Expires: ${expiresAt.toISOString()}

Read and follow:

- ${docs.api}
- ${docs.schema}`

export const maskAgentAccessUrl = (agentAccessUrl: string) => {
  try {
    const url = new URL(agentAccessUrl)
    const path = url.pathname.replace(/[^/]+\/?$/, '...')
    return `${url.host}${path}`
  } catch {
    return 'Temporary session link hidden'
  }
}
