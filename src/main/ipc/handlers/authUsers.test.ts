import { describe, expect, it } from 'vitest'
import { createTestbed, OWNER } from '../../auth/test/testbed'
import { useMigratedDb } from '../../db/test/testDb'
import { createAuthHandlers } from './auth'
import { createUserHandlers } from './users'

const context = { webContentsId: 1 }

describe('auth and user IPC handlers', () => {
  const getDb = useMigratedDb()

  function setup() {
    const bed = createTestbed(getDb())
    return {
      ...bed,
      authHandlers: createAuthHandlers(bed.auth),
      userHandlers: createUserHandlers(bed.userService)
    }
  }

  it('run the whole session lifecycle through the handlers', async () => {
    const { authHandlers: h } = setup()
    expect(await h['auth:get-state'].handle(undefined, context)).toEqual({
      status: 'setup-required'
    })
    await h['auth:create-initial-admin'].handle(OWNER, context)
    await h['auth:lock'].handle(undefined, context)
    expect(await h['auth:get-state'].handle(undefined, context)).toMatchObject({ status: 'locked' })
    await h['auth:unlock'].handle({ password: OWNER.password }, context)
    await h['auth:change-password'].handle(
      { currentPassword: OWNER.password, newPassword: 'fresh-start-88' },
      context
    )
    await h['auth:sign-out'].handle(undefined, context)
    expect(
      await h['auth:sign-in'].handle({ username: 'owner', password: 'fresh-start-88' }, context)
    ).toMatchObject({
      username: 'owner'
    })
  })

  it('run user management through the handlers', async () => {
    const { authHandlers, userHandlers: h } = setup()
    await authHandlers['auth:create-initial-admin'].handle(OWNER, context)
    expect(
      (await h['users:list-roles'].handle(undefined, context)).map((r) => r.roleCode)
    ).toContain('cashier')
    const created = await h['users:create'].handle(
      { username: 'meena', displayName: 'Meena', roleCode: 'cashier', password: 'till-drawer-77' },
      context
    )
    await h['users:update'].handle(
      { userId: created.userId, displayName: 'Meena S', roleCode: 'manager' },
      context
    )
    await h['users:reset-password'].handle(
      { userId: created.userId, newPassword: 'temporary-pass-1' },
      context
    )
    await h['users:set-active'].handle({ userId: created.userId, active: false }, context)
    expect(await h['users:list'].handle(undefined, context)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'Meena S', active: false, mustChangePassword: true })
      ])
    )
  })

  it('validate input with the shared schemas', () => {
    const { authHandlers, userHandlers } = setup()
    const create = userHandlers['users:create'].input
    expect(
      create.safeParse({
        username: 'ab',
        displayName: 'A',
        roleCode: 'cashier',
        password: 'till-drawer-77'
      }).success
    ).toBe(false)
    expect(
      create.safeParse({
        username: 'meena',
        displayName: 'Meena',
        roleCode: 'owner',
        password: 'till-drawer-77'
      }).success
    ).toBe(false)
    expect(
      create.safeParse({
        username: 'meena',
        displayName: 'Meena',
        roleCode: 'cashier',
        password: 'meena-123-x'
      }).success
    ).toBe(false)
    expect(
      authHandlers['auth:sign-in'].input.safeParse({ username: 'owner', password: '' }).success
    ).toBe(false)
    expect(authHandlers['auth:get-state'].input.safeParse({ extra: 1 }).success).toBe(false)
  })
})
