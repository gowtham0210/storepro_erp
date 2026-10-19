import { describe, expect, it } from 'vitest'
import { OVERRIDE_TTL_MS, OverrideGrants } from './overrideGrants'

function setup() {
  const clock = { time: 1_000_000, now: () => clock.time }
  return { clock, grants: new OverrideGrants(clock) }
}

const GRANT = { permission: 'sale.void', requestedBy: 3, approvedBy: 1 } as const

describe('OverrideGrants', () => {
  it('issues a random, single-use approval', () => {
    const { grants } = setup()
    const first = grants.issue(GRANT)
    expect(first.overrideId).toMatch(/^[0-9a-f-]{36}$/)
    expect(grants.issue(GRANT).overrideId).not.toBe(first.overrideId)
    expect(grants.take(first.overrideId, 3, 'sale.void')).toMatchObject({ approvedBy: 1 })
    expect(grants.take(first.overrideId, 3, 'sale.void')).toBeNull()
  })

  it('only covers the user and permission it was given for', () => {
    const { grants } = setup()
    const { overrideId } = grants.issue(GRANT)
    expect(grants.take(overrideId, 4, 'sale.void')).toBeNull()
    expect(grants.take(overrideId, 3, 'stock.adjust')).toBeNull()
    // A mismatched attempt doesn't use it up.
    expect(grants.take(overrideId, 3, 'sale.void')).not.toBeNull()
  })

  it('expires', () => {
    const { grants, clock } = setup()
    const { overrideId, expiresAt } = grants.issue(GRANT)
    expect(expiresAt).toBe(clock.time + OVERRIDE_TTL_MS)
    clock.time = expiresAt
    expect(grants.take(overrideId, 3, 'sale.void')).toBeNull()
  })

  it('forgets every approval when cleared', () => {
    const { grants } = setup()
    const { overrideId } = grants.issue(GRANT)
    grants.clear()
    expect(grants.take(overrideId, 3, 'sale.void')).toBeNull()
  })
})
