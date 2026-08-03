import { createHash, randomBytes } from 'node:crypto'
import type { RevisionTarget } from './revision'

export const sessionLifetimeMs = 24 * 60 * 60 * 1000
export const sessionPath = 'agent/sessions'

export type CapabilitySession<TAuthority> = {
  id: string
  expiresAt: Date
  target: RevisionTarget
  authority: TAuthority
}

export type SessionStore<TAuthority> = {
  findByCapabilityHash: (capabilityHash: string) => Promise<CapabilitySession<TAuthority> | null>
  touch: (sessionId: string) => Promise<void>
}

export type ResolvedSession<TAuthority> =
  | { kind: 'not-found' }
  | { kind: 'expired' }
  | { kind: 'active'; session: CapabilitySession<TAuthority> }

export const resolveSession = async <TAuthority>(
  store: SessionStore<TAuthority>,
  capability: string,
  now = new Date(),
): Promise<ResolvedSession<TAuthority>> => {
  const session = await store.findByCapabilityHash(hashCapability(capability))
  if (!session) return { kind: 'not-found' }
  if (session.expiresAt <= now) return { kind: 'expired' }
  return { kind: 'active', session }
}

export const mintCapability = (
  serverUrl: string,
  now = new Date(),
  ttlMs = sessionLifetimeMs,
): MintedCapability => {
  const capability = randomBytes(32).toString('base64url')
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

export const hashCapability = (capability: string) =>
  createHash('sha256').update(capability).digest('hex')

export const buildSessionUrl = (serverUrl: string, capability: string) =>
  buildCapabilityUrl(serverUrl, sessionPath, capability)

export const buildCapabilityUrl = (baseUrl: string, path: string, capability: string) =>
  new URL(`${path}/${encodeURIComponent(capability)}`, `${baseUrl.replace(/\/$/, '')}/`).toString()
