import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { useMigratedDb } from '../db/test/testDb'

async function rejection(promise: Promise<unknown> | (() => unknown)): Promise<AppError> {
  try {
    await (typeof promise === 'function' ? promise() : promise)
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

const CASHIER = {
  username: 'cashier1',
  displayName: 'Meena',
  roleCode: 'cashier' as const,
  password: 'till-drawer-77'
}

describe('UserService', () => {
  const getDb = useMigratedDb()

  async function asOwner() {
    const bed = createTestbed(getDb())
    const owner = await bed.auth.createInitialAdmin(OWNER)
    return { ...bed, owner }
  }

  it('lets an administrator add, list and edit users', async () => {
    const { userService, audit } = await asOwner()
    const cashier = await userService.create(CASHIER)
    expect(cashier).toMatchObject({ username: 'cashier1', roleCode: 'cashier', active: true })
    expect(cashier).not.toHaveProperty('passwordHash')
    const updated = userService.update({
      userId: cashier.userId,
      displayName: 'Meena S',
      roleCode: 'manager'
    })
    expect(updated).toMatchObject({ displayName: 'Meena S', roleCode: 'manager' })
    expect(userService.list().map((u) => u.username)).toEqual(['cashier1', 'owner'])
    expect(
      audit()
        .map((a) => a.action)
        .slice(-2)
    ).toEqual(['user.created', 'user.updated'])
  })

  it('rejects a username that is taken, ignoring case', async () => {
    const { userService } = await asOwner()
    const error = await rejection(userService.create({ ...CASHIER, username: 'OWNER' }))
    expect(error.code).toBe('CONFLICT')
    expect(error.details).toEqual([{ path: 'username', message: 'That username is already taken' }])
  })

  it('is for administrators only', async () => {
    const { userService, auth } = await asOwner()
    await userService.create(CASHIER)
    auth.signOut()
    await auth.signIn(CASHIER)
    expect((await rejection(() => userService.list())).code).toBe('FORBIDDEN')
    auth.signOut()
    expect((await rejection(() => userService.list())).code).toBe('UNAUTHENTICATED')
  })

  it('never leaves the store without an active administrator', async () => {
    const { userService, owner, users } = await asOwner()
    const lastAdmin = await rejection(() =>
      userService.update({ userId: owner.userId, displayName: 'Ravi', roleCode: 'manager' })
    )
    expect(lastAdmin.message).toMatch(/at least one active administrator/)
    const self = await rejection(() =>
      userService.setActive({ userId: owner.userId, active: false })
    )
    expect(self.message).toMatch(/your own account/)

    await userService.create({ ...CASHIER, username: 'admin2', roleCode: 'administrator' })
    userService.update({ userId: owner.userId, displayName: 'Ravi', roleCode: 'manager' }) // now allowed
    expect(users.findById(owner.userId)?.roleCode).toBe('manager')
    // The change applies at once: the former administrator can no longer manage users.
    expect((await rejection(() => userService.list())).code).toBe('FORBIDDEN')
  })

  it('deactivates users so they cannot sign in, and reactivates them', async () => {
    const { userService, auth } = await asOwner()
    const cashier = await userService.create(CASHIER)
    expect(userService.setActive({ userId: cashier.userId, active: false }).active).toBe(false)
    auth.signOut()
    expect((await rejection(auth.signIn(CASHIER))).code).toBe('UNAUTHENTICATED')
    await auth.signIn(OWNER)
    userService.setActive({ userId: cashier.userId, active: true })
    auth.signOut()
    await expect(auth.signIn(CASHIER)).resolves.toMatchObject({ username: 'cashier1' })
  })

  it('resets a password: the user must change it, and any sign-in block is lifted', async () => {
    const { userService, auth, throttle } = await asOwner()
    const cashier = await userService.create(CASHIER)
    for (let i = 0; i < 6; i++) throttle.recordFailure('cashier1')
    const reset = await userService.resetPassword({
      userId: cashier.userId,
      newPassword: 'temporary-pass-1'
    })
    expect(reset.mustChangePassword).toBe(true)
    expect(throttle.retryAfterMs('cashier1')).toBe(0)

    auth.signOut()
    const user = await auth.signIn({ username: 'cashier1', password: 'temporary-pass-1' })
    expect(user.mustChangePassword).toBe(true)
    // Nothing else works until the password is changed.
    expect(() => auth.requireUser()).toThrow('Choose a new password to continue.')
    const changed = await auth.changePassword({
      currentPassword: 'temporary-pass-1',
      newPassword: 'my-own-pass-55'
    })
    expect(changed.mustChangePassword).toBe(false)
    expect(auth.requireUser().username).toBe('cashier1')
  })
})
