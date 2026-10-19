import { describe, expect, it } from 'vitest'
import { passwordProblem } from './passwordPolicy'

describe('passwordProblem', () => {
  it('accepts long passwords and passphrases with any characters', () => {
    expect(passwordProblem('counter-top-42')).toBeNull()
    expect(passwordProblem('मेरी दुकान 2026')).toBeNull()
    expect(passwordProblem('blue tea kettle morning')).toBeNull()
  })

  it('rejects short, overlong, common and repetitive passwords', () => {
    expect(passwordProblem('short1')).toBe('Use at least 8 characters')
    expect(passwordProblem('x'.repeat(129))).toBe('Use at most 128 characters')
    expect(passwordProblem('Password123')).toMatch(/too common/)
    expect(passwordProblem('storepro123')).toMatch(/too common/)
    expect(passwordProblem('aaaaaaaaaa')).toBe('Avoid repeating one character')
  })

  it('rejects passwords containing the username', () => {
    expect(passwordProblem('cashier1-is-me', 'Cashier1')).toBe(
      "Don't include your username in the password"
    )
  })

  it('counts characters, not UTF-16 units', () => {
    expect(passwordProblem('😀😀😀😀😀😀😀')).toBe('Use at least 8 characters')
  })
})
