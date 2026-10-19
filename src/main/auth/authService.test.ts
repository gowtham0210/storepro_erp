import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { useMigratedDb } from '../db/test/testDb'
import { createTestbed, OWNER, TEST_HASH_PARAMS } from './test/testbed'

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('AuthService', () => {
  const getDb = useMigratedDb()

  it('asks for the first administrator, then only once', async () => {
    const { auth } = createTestbed(getDb())
    expect(auth.getState()).toEqual({ status: 'setup-required' })
    const user = await auth.createInitialAdmin(OWNER)
    expect(user).toMatchObject({
      username: 'owner',
      roleCode: 'administrator',
      mustChangePassword: false
    })
    expect(auth.getState()).toEqual({ status: 'signed-in', user })
    expect((await rejection(auth.createInitialAdmin({ ...OWNER, username: 'other' }))).code).toBe(
      'CONFLICT'
    )
  })

  it('signs in with the right password, case-insensitively by username, and audits it', async () => {
    const { auth, audit, users } = createTestbed(getDb())
    await auth.createInitialAdmin(OWNER)
    auth.signOut()
    expect(auth.getState()).toEqual({ status: 'signed-out' })
    const user = await auth.signIn({ username: 'OWNER', password: OWNER.password })
    expect(user.username).toBe('owner')
    expect(users.findById(user.userId)?.lastSignInAt).not.toBeNull()
    expect(audit().map((a) => a.action)).toEqual([
      'user.created',
      'user.sign_in',
      'user.sign_out',
      'user.sign_in'
    ])
  })

  it('gives the same answer for a wrong password and an unknown username', async () => {
    const { auth, audit } = createTestbed(getDb())
    await auth.createInitialAdmin(OWNER)
    auth.signOut()
    const wrongPassword = await rejection(
      auth.signIn({ username: 'owner', password: 'not-the-password' })
    )
    const unknownUser = await rejection(
      auth.signIn({ username: 'nobody', password: 'not-the-password' })
    )
    expect(wrongPassword.code).toBe('UNAUTHENTICATED')
    expect(unknownUser.message).toBe(wrongPassword.message)
    expect(audit().filter((a) => a.action === 'user.sign_in_failed')).toHaveLength(2)
    expect(JSON.stringify(audit())).not.toContain('not-the-password')
  })

  it('blocks guessing after five failures, even with the right password, until the wait is over', async () => {
    const { auth, clock } = createTestbed(getDb())
    await auth.createInitialAdmin(OWNER)
    auth.signOut()
    for (let i = 0; i < 4; i++)
      await rejection(auth.signIn({ username: 'owner', password: `guess-${i}-xyz` }))
    const fifth = await rejection(auth.signIn({ username: 'owner', password: 'guess-5-xyz' }))
    expect(fifth.details).toEqual({ retryAfterMs: 30_000 })
    const blocked = await rejection(auth.signIn(OWNER))
    expect(blocked.code).toBe('RATE_LIMITED')
    clock.time += 30_001
    await expect(auth.signIn(OWNER)).resolves.toMatchObject({ username: 'owner' })
  })

  it('locks and unlocks the session, refusing work while locked', async () => {
    const { auth } = createTestbed(getDb())
    await auth.createInitialAdmin(OWNER)
    auth.lock()
    expect(auth.getState()).toMatchObject({ status: 'locked', user: { username: 'owner' } })
    expect(() => auth.requireUser()).toThrow(AppError)
    expect((await rejection(auth.unlock('wrong-password-1'))).message).toBe(
      'The password is incorrect.'
    )
    await auth.unlock(OWNER.password)
    expect(auth.requireUser().username).toBe('owner')
  })

  it('changes the password after checking the current one', async () => {
    const { auth } = createTestbed(getDb())
    await auth.createInitialAdmin(OWNER)
    const wrong = await rejection(
      auth.changePassword({ currentPassword: 'nope-nope-1', newPassword: 'new-shop-pass-9' })
    )
    expect(wrong.code).toBe('UNAUTHENTICATED')
    const weak = await rejection(
      auth.changePassword({ currentPassword: OWNER.password, newPassword: 'owner-is-me' })
    )
    expect(weak.details).toEqual([
      { path: 'newPassword', message: "Don't include your username in the password" }
    ])
    await auth.changePassword({ currentPassword: OWNER.password, newPassword: 'new-shop-pass-9' })
    auth.signOut()
    await expect(
      auth.signIn({ username: 'owner', password: 'new-shop-pass-9' })
    ).resolves.toBeTruthy()
  })

  it('upgrades weak stored hashes at the next sign-in', async () => {
    const db = getDb()
    const before = createTestbed(db) // hashes with ln=10
    await before.auth.createInitialAdmin(OWNER)
    expect(before.users.findByUsername('owner')?.passwordHash).toMatch(/^\$scrypt\$ln=10,/)

    // A later version of the app uses stronger parameters.
    const after = createTestbed(db, { ...TEST_HASH_PARAMS, ln: 11 })
    await after.auth.signIn(OWNER)
    expect(after.users.findByUsername('owner')?.passwordHash).toMatch(/^\$scrypt\$ln=11,/)
    after.auth.signOut()
    await expect(after.auth.signIn(OWNER)).resolves.toMatchObject({ username: 'owner' })
  })

  it('ends the session as soon as the user is deactivated', async () => {
    const db = getDb()
    const { auth } = createTestbed(db)
    const owner = await auth.createInitialAdmin(OWNER)
    db.run('UPDATE users SET archived_at = 1 WHERE user_id = ?', [owner.userId])
    expect(auth.getState()).toEqual({ status: 'signed-out' })
    expect(() => auth.requireUser()).toThrow('Sign in to continue.')
  })
})
