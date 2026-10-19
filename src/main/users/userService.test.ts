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
    const { userService, actor, audit } = await asOwner()
    const cashier = await userService.create(actor(), CASHIER)
    expect(cashier).toMatchObject({ username: 'cashier1', roleCode: 'cashier', active: true })
    expect(cashier).not.toHaveProperty('passwordHash')
    const updated = userService.update(actor(), {
      userId: cashier.userId,
      displayName: 'Meena S',
      roleCode: 'manager'
    })
    expect(updated).toMatchObject({ displayName: 'Meena S', roleCode: 'manager' })
    expect(userService.list(actor()).map((u) => u.username)).toEqual(['cashier1', 'owner'])
    expect(
      audit()
        .map((a) => a.action)
        .slice(-2)
    ).toEqual(['user.created', 'user.updated'])
  })

  it('rejects a username that is taken, ignoring case', async () => {
    const { userService, actor } = await asOwner()
    const error = await rejection(userService.create(actor(), { ...CASHIER, username: 'OWNER' }))
    expect(error.code).toBe('CONFLICT')
    expect(error.details).toEqual([{ path: 'username', message: 'That username is already taken' }])
  })

  it('is for administrators only', async () => {
    const { userService, actor, auth } = await asOwner()
    await userService.create(actor(), CASHIER)
    auth.signOut()
    await auth.signIn(CASHIER)
    expect((await rejection(() => userService.list(actor()))).code).toBe('FORBIDDEN')
    auth.signOut()
    expect((await rejection(() => userService.list(actor()))).code).toBe('UNAUTHENTICATED')
  })

  it('never leaves the store without an active administrator', async () => {
    const { userService, actor, owner, users } = await asOwner()
    const lastAdmin = await rejection(() =>
      userService.update(actor(), {
        userId: owner.userId,
        displayName: 'Ravi',
        roleCode: 'manager'
      })
    )
    expect(lastAdmin.message).toMatch(/at least one active administrator/)
    const self = await rejection(() =>
      userService.setActive(actor(), { userId: owner.userId, active: false })
    )
    expect(self.message).toMatch(/your own account/)

    await userService.create(actor(), { ...CASHIER, username: 'admin2', roleCode: 'administrator' })
    userService.update(actor(), { userId: owner.userId, displayName: 'Ravi', roleCode: 'manager' }) // now allowed
    expect(users.findById(owner.userId)?.roleCode).toBe('manager')
    // The change applies at once: as a manager they can't make anyone an administrator.
    const promote = await rejection(
      userService.create(actor(), { ...CASHIER, username: 'admin3', roleCode: 'administrator' })
    )
    expect(promote.code).toBe('FORBIDDEN')
  })

  it('deactivates users so they cannot sign in, and reactivates them', async () => {
    const { userService, actor, auth } = await asOwner()
    const cashier = await userService.create(actor(), CASHIER)
    expect(userService.setActive(actor(), { userId: cashier.userId, active: false }).active).toBe(
      false
    )
    auth.signOut()
    expect((await rejection(auth.signIn(CASHIER))).code).toBe('UNAUTHENTICATED')
    await auth.signIn(OWNER)
    userService.setActive(actor(), { userId: cashier.userId, active: true })
    auth.signOut()
    await expect(auth.signIn(CASHIER)).resolves.toMatchObject({ username: 'cashier1' })
  })

  it('resets a password: the user must change it, and any sign-in block is lifted', async () => {
    const { userService, actor, auth, throttle } = await asOwner()
    const cashier = await userService.create(actor(), CASHIER)
    for (let i = 0; i < 6; i++) throttle.recordFailure('cashier1')
    const reset = await userService.resetPassword(actor(), {
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
  describe('the no-escalation rule (M06)', () => {
    async function asManager() {
      const bed = await asOwner()
      await bed.userService.create(bed.actor(), {
        ...CASHIER,
        username: 'arjun',
        displayName: 'Arjun',
        roleCode: 'manager'
      })
      bed.auth.signOut()
      await bed.auth.signIn({ username: 'arjun', password: CASHIER.password })
      return bed
    }

    it('lets a manager manage cashiers and other managers', async () => {
      const { userService, actor } = await asManager()
      const cashier = await userService.create(actor(), CASHIER)
      await userService.resetPassword(actor(), {
        userId: cashier.userId,
        newPassword: 'temporary-pass-1'
      })
      const promoted = userService.update(actor(), {
        userId: cashier.userId,
        displayName: 'Meena',
        roleCode: 'manager'
      })
      expect(promoted.roleCode).toBe('manager')
      expect(userService.setActive(actor(), { userId: cashier.userId, active: false }).active).toBe(
        false
      )
    })

    it("stops a manager giving out or touching an administrator's access", async () => {
      const { userService, actor, owner, audit } = await asManager()
      const before = audit().length
      const create = await rejection(
        userService.create(actor(), { ...CASHIER, roleCode: 'administrator' })
      )
      expect(create).toMatchObject({
        code: 'FORBIDDEN',
        message: "You can't give someone more access than you have."
      })

      const cashier = await userService.create(actor(), CASHIER)
      const promote = await rejection(() =>
        userService.update(actor(), {
          userId: cashier.userId,
          displayName: 'Meena',
          roleCode: 'administrator'
        })
      )
      expect(promote.code).toBe('FORBIDDEN')

      for (const attempt of [
        () =>
          userService.update(actor(), {
            userId: owner.userId,
            displayName: 'X',
            roleCode: 'cashier'
          }),
        () => userService.setActive(actor(), { userId: owner.userId, active: false }),
        () =>
          userService.resetPassword(actor(), {
            userId: owner.userId,
            newPassword: 'taken-over-123'
          })
      ]) {
        const error = await rejection(attempt)
        expect(error.code).toBe('FORBIDDEN')
        expect(error.message).toMatch(/only an administrator can change their account/)
      }
      // Only the cashier's creation was recorded.
      expect(
        audit()
          .slice(before)
          .map((a) => a.action)
      ).toEqual(['user.created'])
    })

    it('shows every role with what it allows', async () => {
      const { userService, actor } = await asManager()
      const roles = userService.listRoles(actor())
      expect(roles.find((r) => r.roleCode === 'cashier')?.permissions).toContain('sale.create')
      expect(roles.find((r) => r.roleCode === 'administrator')?.permissions).toContain(
        'settings.edit'
      )
    })
  })
})
