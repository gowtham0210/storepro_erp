import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { useMigratedDb } from '../db/test/testDb'
import { OVERRIDE_TTL_MS } from './overrideGrants'
import { createTestbed, OWNER } from './test/testbed'

async function rejection(run: Promise<unknown> | (() => unknown)): Promise<AppError> {
  try {
    await (typeof run === 'function' ? run() : run)
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

const CASHIER = {
  username: 'meena',
  displayName: 'Meena',
  roleCode: 'cashier' as const,
  password: 'till-drawer-77'
}
const MANAGER = {
  username: 'arjun',
  displayName: 'Arjun',
  roleCode: 'manager' as const,
  password: 'back-office-31'
}

describe('authorization', () => {
  const getDb = useMigratedDb()

  /** Owner, a manager and a cashier exist; the cashier is signed in. */
  async function atTheCounter() {
    const bed = createTestbed(getDb())
    await bed.auth.createInitialAdmin(OWNER)
    const manager = await bed.userService.create(bed.actor(), MANAGER)
    await bed.userService.create(bed.actor(), CASHIER)
    bed.auth.signOut()
    const cashier = await bed.auth.signIn(CASHIER)
    return { ...bed, manager, cashier }
  }

  it('lets public channels through without a session', () => {
    const { auth } = createTestbed(getDb())
    expect(auth.authorize('public')).toBeNull()
    expect(() => auth.authorize('signed-in')).toThrow('Sign in to continue.')
    expect(() => auth.authorize('user.manage')).toThrow('Sign in to continue.')
  })

  it("resolves the actor with their role's permissions", async () => {
    const { auth, cashier } = await atTheCounter()
    expect(cashier.permissions).toContain('sale.create')
    const actor = auth.authorize('sale.create')
    expect(actor).toMatchObject({ userId: cashier.userId, roleCode: 'cashier', override: null })
    expect(actor?.permissions.has('sale.void')).toBe(false)
  })

  it('refuses a permission the role lacks, says which, and audits the attempt', async () => {
    const { auth, audit, cashier } = await atTheCounter()
    const error = await rejection(() => auth.authorize('sale.void', { overridable: true }))
    expect(error.code).toBe('FORBIDDEN')
    expect(error.message).toBe("Your role doesn't allow this: void a completed sale.")
    expect(error.details).toEqual({ permission: 'sale.void', overridable: true })
    expect(audit().at(-1)).toMatchObject({
      action: 'access.denied',
      user_id: cashier.userId,
      details: JSON.stringify({ permission: 'sale.void' })
    })
  })

  it('allows only a password change while a new password is required', async () => {
    const { auth, userService, actor, cashier } = await atTheCounter()
    auth.signOut()
    await auth.signIn(OWNER)
    await userService.resetPassword(actor(), {
      userId: cashier.userId,
      newPassword: 'temporary-pass-1'
    })
    auth.signOut()
    await auth.signIn({ username: CASHIER.username, password: 'temporary-pass-1' })
    expect(auth.authorize('password-change')?.username).toBe('meena')
    expect(() => auth.authorize('signed-in')).toThrow('Choose a new password to continue.')
  })

  it('applies role changes to the very next request', async () => {
    const { auth, userService, actor, cashier } = await atTheCounter()
    auth.signOut()
    await auth.signIn(OWNER)
    userService.update(actor(), {
      userId: cashier.userId,
      displayName: 'Meena',
      roleCode: 'manager'
    })
    auth.signOut()
    await auth.signIn(CASHIER)
    expect(auth.authorize('sale.void')?.roleCode).toBe('manager')
    expect(auth.getState()).toMatchObject({
      user: { permissions: expect.arrayContaining(['sale.void']) }
    })
  })

  describe('manager approval (M06-05)', () => {
    it('lets a manager approve one request for the cashier', async () => {
      const { auth, actor, audit, manager, cashier } = await atTheCounter()
      const approval = await auth.approveOverride(actor(), {
        permission: 'sale.void',
        username: MANAGER.username,
        password: MANAGER.password
      })
      expect(approval).toMatchObject({ approvedBy: 'Arjun' })
      expect(audit().at(-1)).toMatchObject({
        action: 'override.approved',
        user_id: manager.userId,
        entity_id: cashier.userId
      })

      const approved = auth.authorize('sale.void', {
        overridable: true,
        overrideId: approval.overrideId
      })
      expect(approved).toMatchObject({
        userId: cashier.userId,
        override: {
          permission: 'sale.void',
          approvedBy: { userId: manager.userId, displayName: 'Arjun' }
        }
      })
      expect(approved?.permissions.has('sale.void')).toBe(true)

      // Used once only.
      const again = await rejection(() =>
        auth.authorize('sale.void', { overridable: true, overrideId: approval.overrideId })
      )
      expect(again.message).toMatch(/expired or was already used/)
      expect(again.details).toEqual({ permission: 'sale.void', overridable: true })
    })

    it('is ignored where the channel does not allow overrides', async () => {
      const { auth, actor } = await atTheCounter()
      const { overrideId } = await auth.approveOverride(actor(), {
        permission: 'user.manage',
        username: MANAGER.username,
        password: MANAGER.password
      })
      const error = await rejection(() => auth.authorize('user.manage', { overrideId }))
      expect(error.details).toEqual({ permission: 'user.manage', overridable: false })
    })

    it('needs the right password, and is throttled like sign-in', async () => {
      const { auth, actor, audit } = await atTheCounter()
      const request = { permission: 'sale.void' as const, username: 'arjun', password: 'nope' }
      const wrong = await rejection(auth.approveOverride(actor(), request))
      expect(wrong.code).toBe('UNAUTHENTICATED')
      expect(wrong.message).toBe('The username or password is incorrect.')
      expect(audit().at(-1)?.action).toBe('override.denied')
      for (let i = 0; i < 4; i++) await rejection(auth.approveOverride(actor(), request))
      const limited = await rejection(
        auth.approveOverride(actor(), { ...request, password: MANAGER.password })
      )
      expect(limited.code).toBe('RATE_LIMITED')
      // The cashier is still signed in: a failed approval is not a failed session.
      expect(auth.getState().status).toBe('signed-in')
    })

    it('must come from someone allowed to do it', async () => {
      const { auth, actor } = await atTheCounter()
      const self = await rejection(
        auth.approveOverride(actor(), {
          permission: 'sale.void',
          username: CASHIER.username,
          password: CASHIER.password
        })
      )
      expect(self.message).toBe("Meena isn't allowed to approve this.")
      expect(self.details).toBeUndefined()

      // Managers can't approve what managers can't do.
      const restore = await rejection(
        auth.approveOverride(actor(), {
          permission: 'backup.restore',
          username: MANAGER.username,
          password: MANAGER.password
        })
      )
      expect(restore.code).toBe('FORBIDDEN')

      const allowed = await rejection(
        auth.approveOverride(actor(), {
          permission: 'sale.create',
          username: MANAGER.username,
          password: MANAGER.password
        })
      )
      expect(allowed.code).toBe('CONFLICT')
    })

    it('expires, and dies with the session', async () => {
      const { auth, actor, clock } = await atTheCounter()
      const request = {
        permission: 'stock.adjust' as const,
        username: MANAGER.username,
        password: MANAGER.password
      }
      const late = await auth.approveOverride(actor(), request)
      clock.time += OVERRIDE_TTL_MS + 1
      expect(() =>
        auth.authorize('stock.adjust', { overridable: true, overrideId: late.overrideId })
      ).toThrow(/expired/)

      const locked = await auth.approveOverride(actor(), request)
      auth.lock()
      await auth.unlock(CASHIER.password)
      expect(() =>
        auth.authorize('stock.adjust', { overridable: true, overrideId: locked.overrideId })
      ).toThrow(/expired/)
    })

    it('is void if the approver is deactivated before it is used', async () => {
      const { auth, actor, users, manager } = await atTheCounter()
      const { overrideId } = await auth.approveOverride(actor(), {
        permission: 'sale.void',
        username: MANAGER.username,
        password: MANAGER.password
      })
      users.setActive(manager.userId, false)
      expect(() => auth.authorize('sale.void', { overridable: true, overrideId })).toThrow(
        /expired/
      )
    })
  })
})
