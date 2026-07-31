import { describe, expect, it } from 'vitest'
import { mintCapability } from '../src/session'

describe('minting', () => {
  it('mints a 24h capability whose hash never equals the secret', () => {
    const now = new Date('2026-07-30T12:00:00Z')

    const minted = mintCapability('http://api.test/', now)

    expect(minted.capability).not.toBe(minted.capabilityHash)
    expect(minted.capability.length).toBeGreaterThanOrEqual(32)
    expect(minted.capabilityHash).toMatch(/^[a-f0-9]{64}$/)
    expect(minted.expiresAt.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(minted.sessionUrl).toBe(`http://api.test/agent/sessions/${minted.capability}`)
  })

  it('mints unique capabilities', () => {
    const first = mintCapability('http://api.test')
    const second = mintCapability('http://api.test')

    expect(first.capability).not.toBe(second.capability)
  })
})
