import { createHash, randomBytes } from 'node:crypto'
import { sessionLifetimeMs } from './contract'

export const mintCapability = (
  serverUrl: string,
  now = new Date(),
  ttlMs = sessionLifetimeMs,
): MintedCapability => {
  const capability = createCapabilitySecret()
  return {
    capability,
    capabilityHash: hashCapability(capability),
    expiresAt: new Date(now.getTime() + ttlMs),
    sessionUrl: buildSessionUrl(serverUrl, capability),
  }
}

export type MintedCapability = {
  capability: string
  capabilityHash: string
  expiresAt: Date
  sessionUrl: string
}

export const resolveSession = async (
  store: SessionStore,
  capability: string,
  now = new Date(),
): Promise<ResolvedSession> => {
  const view = await store.findByCapabilityHash(hashCapability(capability))
  if (!view) return { kind: 'not-found' }
  if (view.session.expiresAt <= now || view.session.generation !== view.workGeneration) {
    return { kind: 'expired' }
  }
  return { kind: 'active', view }
}

export type ResolvedSession =
  | { kind: 'not-found' }
  | { kind: 'expired' }
  | { kind: 'active'; view: SessionView }

export type SessionStore = {
  findByCapabilityHash: (capabilityHash: string) => Promise<SessionView | null>
  touch: (sessionId: string) => Promise<void>
}

export type SessionView = {
  session: CapabilitySession
  workName: string
  // The work's current generation; a session with an older generation was revoked.
  workGeneration: number
  draft: { revision: number; document: unknown } | null
}

export type CapabilitySession = {
  id: string
  workId: string
  generation: number
  expiresAt: Date
}

export const sessionPath = 'agent/sessions'

export const buildSessionUrl = (serverUrl: string, capability: string) =>
  buildCapabilityUrl(serverUrl, sessionPath, capability)

export const buildCapabilityUrl = (baseUrl: string, path: string, capability: string) =>
  new URL(`${path}/${encodeURIComponent(capability)}`, `${baseUrl.replace(/\/$/, '')}/`).toString()

// Stored only as a hash, so a database leak cannot be replayed against the API.
const createCapabilitySecret = () => randomBytes(32).toString('base64url')

export const hashCapability = (capability: string) =>
  createHash('sha256').update(capability).digest('hex')
