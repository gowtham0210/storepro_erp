import { TEST_STORE } from '@shared/test/stores'
import { describe, expect, it } from 'vitest'
import { createTestbed, OWNER } from '../../auth/test/testbed'
import { useMigratedDb } from '../../db/test/testDb'
import { createRealIpc } from '../test/realHandlers'

describe('auth and user IPC handlers', () => {
  const getDb = useMigratedDb()

  function setup() {
    return createRealIpc(createTestbed(getDb()))
  }

  it('run the whole session lifecycle through the handlers', async () => {
    const { invoke } = setup()
    expect(await invoke('auth:get-state')).toEqual({ status: 'setup-required' })
    await invoke('setup:complete', { store: TEST_STORE, administrator: OWNER })
    await invoke('auth:lock')
    expect(await invoke('auth:get-state')).toMatchObject({ status: 'locked' })
    await invoke('auth:unlock', { password: OWNER.password })
    await invoke('auth:change-password', {
      currentPassword: OWNER.password,
      newPassword: 'fresh-start-88'
    })
    await invoke('auth:sign-out')
    expect(
      await invoke('auth:sign-in', { username: 'owner', password: 'fresh-start-88' })
    ).toMatchObject({ username: 'owner' })
  })

  it('run user management through the handlers', async () => {
    const { invoke } = setup()
    await invoke('setup:complete', { store: TEST_STORE, administrator: OWNER })
    expect((await invoke('users:list-roles')).map((r) => r.roleCode)).toContain('cashier')
    const created = await invoke('users:create', {
      username: 'meena',
      displayName: 'Meena',
      roleCode: 'cashier',
      password: 'till-drawer-77'
    })
    await invoke('users:update', {
      userId: created.userId,
      displayName: 'Meena S',
      roleCode: 'manager'
    })
    await invoke('users:reset-password', {
      userId: created.userId,
      newPassword: 'temporary-pass-1'
    })
    await invoke('users:set-active', { userId: created.userId, active: false })
    expect(await invoke('users:list')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'Meena S', active: false, mustChangePassword: true })
      ])
    )
  })

  it('validate input with the shared schemas', () => {
    const { handlers } = setup()
    const create = handlers['users:create'].input
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
      handlers['auth:sign-in'].input.safeParse({ username: 'owner', password: '' }).success
    ).toBe(false)
    expect(handlers['auth:get-state'].input.safeParse({ extra: 1 }).success).toBe(false)
    expect(
      handlers['auth:approve-override'].input.safeParse({
        permission: 'sale.fly',
        username: 'owner',
        password: 'x'
      }).success
    ).toBe(false)
  })
})
