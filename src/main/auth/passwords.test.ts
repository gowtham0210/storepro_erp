import { describe, expect, it } from 'vitest'
import { PasswordHasher } from './passwords'
import { TEST_HASH_PARAMS } from './test/testbed'

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher(TEST_HASH_PARAMS)

  it('produces salted, self-describing hashes that verify', async () => {
    const first = await hasher.hash('correct horse battery')
    const second = await hasher.hash('correct horse battery')
    expect(first).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(first).not.toBe(second) // random salt
    expect(await hasher.verify('correct horse battery', first)).toBe(true)
    expect(await hasher.verify('correct horse batterY', first)).toBe(false)
  })

  it('treats canonically equivalent Unicode as the same password', async () => {
    const stored = await hasher.hash('café 2026') // e + combining accent
    expect(await hasher.verify('café 2026', stored)).toBe(true)
  })

  it('never verifies malformed or tampered hashes', async () => {
    const stored = await hasher.hash('a long password')
    expect(await hasher.verify('a long password', 'plain-text')).toBe(false)
    expect(await hasher.verify('a long password', stored.replace('ln=10', 'ln=30'))).toBe(false)
    expect(await hasher.verify('a long password', stored.slice(0, -4) + 'AAAA')).toBe(false)
  })

  it('asks for a rehash when parameters were weaker than the current ones', async () => {
    const strong = new PasswordHasher({ ln: 11, r: 8, p: 1 })
    const weak = await hasher.hash('a long password')
    expect(strong.needsRehash(weak)).toBe(true)
    expect(strong.needsRehash(await strong.hash('a long password'))).toBe(false)
    expect(strong.needsRehash('garbage')).toBe(true)
  })
})
