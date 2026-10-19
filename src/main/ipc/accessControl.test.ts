import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, type IpcArgs, type IpcChannel, type RoleCode } from '@shared/ipc/contract'
import { isPermissionCode } from '@shared/permissions'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { useMigratedDb } from '../db/test/testDb'
import { createRealIpc } from './test/realHandlers'

/**
 * M06-06: restricted actions are refused by the main process itself, whatever
 * the renderer sends. Each test calls channels directly, as a tampered-with
 * renderer could.
 */

const PASSWORD = 'till-drawer-77'

/** A valid request for every channel. A new channel must add one here, which brings it under these tests. */
const SAMPLE_INPUTS: { [C in IpcChannel]: IpcArgs<C> } = {
  'app:get-info': [],
  'app:get-startup-status': [],
  'log:write': [{ level: 'info', message: 'hello' }],
  'auth:get-state': [],
  'auth:create-initial-admin': [{ username: 'second', displayName: 'Second', password: PASSWORD }],
  'auth:sign-in': [{ username: 'owner', password: 'wrong-password' }],
  'auth:sign-out': [],
  'auth:lock': [],
  'auth:unlock': [{ password: 'wrong-password' }],
  'auth:change-password': [{ currentPassword: 'wrong-password', newPassword: 'brand-new-pass-9' }],
  'auth:approve-override': [{ permission: 'sale.void', username: 'owner', password: 'wrong' }],
  'users:list': [],
  'users:list-roles': [],
  'users:create': [
    { username: 'intruder', displayName: 'Intruder', roleCode: 'administrator', password: PASSWORD }
  ],
  'users:update': [{ userId: 1, displayName: 'Hijacked', roleCode: 'cashier' }],
  'users:set-active': [{ userId: 1, active: false }],
  'users:reset-password': [{ userId: 1, newPassword: 'taken-over-123' }]
}

describe('access control over IPC', () => {
  const getDb = useMigratedDb()

  async function storeWith(...roles: RoleCode[]) {
    const bed = createTestbed(getDb())
    const ipc = createRealIpc(bed)
    await ipc.invoke('auth:create-initial-admin', OWNER)
    for (const roleCode of roles) {
      await ipc.invoke('users:create', {
        username: roleCode.replace('_', '-'),
        displayName: roleCode,
        roleCode,
        password: PASSWORD
      })
    }
    await ipc.invoke('auth:sign-out')
    return { ...bed, ...ipc }
  }

  const send = (ipc: { send: (c: string, i?: unknown) => Promise<unknown> }, channel: IpcChannel) =>
    ipc.send(channel, SAMPLE_INPUTS[channel][0])

  it('requires every channel to declare a valid access rule', async () => {
    const { handlers } = await storeWith()
    for (const channel of IPC_CHANNELS) {
      const { access } = handlers[channel]
      expect(
        ['public', 'password-change', 'signed-in'].includes(access) || isPermissionCode(access),
        `${channel} declares ${access}`
      ).toBe(true)
    }
  })

  it('keeps the list of public channels short and deliberate', async () => {
    const { handlers } = await storeWith()
    expect(IPC_CHANNELS.filter((channel) => handlers[channel].access === 'public')).toEqual([
      'app:get-info',
      'app:get-startup-status',
      'log:write',
      'auth:get-state',
      'auth:create-initial-admin',
      'auth:sign-in',
      'auth:sign-out',
      'auth:lock',
      'auth:unlock'
    ])
  })

  it('refuses every guarded channel when nobody is signed in', async () => {
    const ipc = await storeWith()
    for (const channel of IPC_CHANNELS) {
      if (ipc.handlers[channel].access === 'public') continue
      expect(await send(ipc, channel), channel).toMatchObject({
        ok: false,
        error: { code: 'UNAUTHENTICATED' }
      })
    }
  })

  it.each(['cashier', 'inventory_operator'] as const)(
    'refuses a %s every channel their role does not allow, and changes nothing',
    async (roleCode) => {
      const ipc = await storeWith(roleCode)
      await ipc.invoke('auth:sign-in', { username: roleCode.replace('_', '-'), password: PASSWORD })
      const allowed = new Set(ipc.roles.permissionsOf(roleCode))
      const refused: string[] = []
      for (const channel of IPC_CHANNELS) {
        const { access } = ipc.handlers[channel]
        if (!isPermissionCode(access) || allowed.has(access)) continue
        const result = await send(ipc, channel)
        expect(result, channel).toMatchObject({
          ok: false,
          error: { code: 'FORBIDDEN', details: { permission: access } }
        })
        refused.push(channel)
      }
      expect(refused).toContain('users:create')
      // Nothing was written: no new user, and the owner's account is untouched.
      expect(
        ipc.users
          .list()
          .map((u) => u.username)
          .sort()
      ).toEqual([roleCode.replace('_', '-'), 'owner'].sort())
      expect(ipc.users.findByUsername('owner')).toMatchObject({
        displayName: OWNER.displayName,
        active: true,
        mustChangePassword: false
      })
      expect(ipc.audit().filter((entry) => entry.action === 'access.denied').length).toBe(
        refused.length
      )
    }
  )

  it("refuses a manager anything that would reach an administrator's access", async () => {
    const ipc = await storeWith('manager')
    await ipc.invoke('auth:sign-in', { username: 'manager', password: PASSWORD })
    for (const channel of [
      'users:create',
      'users:update',
      'users:set-active',
      'users:reset-password'
    ] as const) {
      expect(await send(ipc, channel), channel).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' }
      })
    }
    // Managers can still manage the roles they hold themselves.
    await expect(
      ipc.invoke('users:create', {
        username: 'meena',
        displayName: 'Meena',
        roleCode: 'cashier',
        password: PASSWORD
      })
    ).resolves.toMatchObject({ roleCode: 'cashier' })
  })
})
