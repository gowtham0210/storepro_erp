import type { Page } from '@playwright/test'
import { expect, goTo, signIn, signOut, test } from './fixtures'

const PASSWORD = 'till-drawer-77'

/** Call the main process directly, the way a tampered-with renderer could. */
function call(ui: Page, channel: string, input?: unknown) {
  return ui.evaluate(
    ([c, i]) =>
      (
        window as unknown as {
          storepro: { invoke(channel: string, input?: unknown): Promise<unknown> }
        }
      ).storepro.invoke(c as string, i),
    [channel, input] as const
  )
}

async function addUser(ui: Page, username: string, roleCode: string): Promise<void> {
  await expect(
    call(ui, 'users:create', { username, displayName: username, roleCode, password: PASSWORD })
  ).resolves.toMatchObject({ ok: true })
}

test.describe('permissions (M06)', () => {
  test('a cashier sees only their screens and is refused restricted calls', async ({ ui }) => {
    await addUser(ui, 'meena', 'cashier')
    await signOut(ui)
    await signIn(ui, { username: 'meena', password: PASSWORD })
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()

    const nav = ui.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: /Customers/ })).toBeVisible()
    for (const hidden of ['Users', 'Reports', 'Settings', 'Purchases', 'Expenses']) {
      await expect(nav.getByRole('link', { name: new RegExp(hidden) })).toHaveCount(0)
    }

    await goTo(ui, '/users')
    await expect(ui.getByText("You don't have access to Users")).toBeVisible()

    // Hiding is not the protection: the main process refuses the calls itself.
    for (const [channel, input] of [
      ['users:list', undefined],
      [
        'users:create',
        { username: 'x-admin', displayName: 'X', roleCode: 'administrator', password: PASSWORD }
      ],
      ['users:reset-password', { userId: 1, newPassword: 'taken-over-123' }]
    ] as const) {
      await expect(call(ui, channel, input)).resolves.toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' }
      })
    }
  })

  test("a manager manages staff but can't touch the administrator", async ({ ui }) => {
    await addUser(ui, 'arjun', 'manager')
    await addUser(ui, 'meena', 'cashier')
    await signOut(ui)
    await signIn(ui, { username: 'arjun', password: PASSWORD })
    // Signing in starts a new session at the home screen; navigate only after that.
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
    await goTo(ui, '/users')
    await expect(ui.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible()

    const ownerRow = ui.getByRole('row', { name: /Ravi Kumar/ })
    await expect(ownerRow.getByText('Only an administrator can change this account.')).toBeVisible()
    await expect(ownerRow.getByRole('button', { name: /Edit|Reset|Deactivate/ })).toHaveCount(0)
    await expect(
      ui.getByRole('row', { name: /meena/ }).getByRole('button', { name: 'Reset password' })
    ).toBeVisible()

    await expect(call(ui, 'users:set-active', { userId: 1, active: false })).resolves.toMatchObject(
      { ok: false, error: { code: 'FORBIDDEN' } }
    )

    await ui.getByRole('button', { name: 'What each role can do' }).click()
    await expect(ui.getByRole('table', { name: 'Permissions of each role' })).toBeVisible()
  })

  test('a manager can approve a restricted action for the cashier', async ({ ui }) => {
    await addUser(ui, 'arjun', 'manager')
    await addUser(ui, 'meena', 'cashier')
    await signOut(ui)
    await signIn(ui, { username: 'meena', password: PASSWORD })
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()

    await expect(
      call(ui, 'auth:approve-override', {
        permission: 'sale.void',
        username: 'arjun',
        password: 'not-his-password'
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    const approved = (await call(ui, 'auth:approve-override', {
      permission: 'sale.void',
      username: 'arjun',
      password: PASSWORD
    })) as { ok: boolean; data: { approvedBy: string; overrideId: string } }
    expect(approved).toMatchObject({ ok: true, data: { approvedBy: 'arjun' } })
    expect(approved.data.overrideId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
