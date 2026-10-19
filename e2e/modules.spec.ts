import type { Page } from '@playwright/test'
import { expect, goTo, signIn, signOut, test } from './fixtures'

const PASSWORD = 'till-drawer-77'

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

test.describe('modules (M04)', () => {
  test('a grocery store runs on the grocery module; planned modules stay off', async ({ ui }) => {
    await goTo(ui, '/settings')
    const section = ui.getByRole('region', { name: 'Modules' })
    await expect(
      section.getByRole('listitem').filter({ hasText: 'Grocery and retail' })
    ).toContainText('always on')
    await expect(section.getByRole('listitem').filter({ hasText: 'Restaurant' })).toContainText(
      'Coming in Release 1.3'
    )
    await expect(section.getByRole('button')).toHaveCount(0)

    // The main process enforces the same rules.
    await expect(
      call(ui, 'modules:set-enabled', { code: 'restaurant', enabled: true })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' }
    })
    await expect(
      call(ui, 'modules:set-enabled', { code: 'grocery', enabled: false })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' }
    })

    // A module's screen, opened directly while the module is off.
    await goTo(ui, '/tables')
    await expect(
      ui.getByText('Tables is part of the Restaurant module, which is switched off')
    ).toBeVisible()
    await expect(
      ui.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Tables/ })
    ).toHaveCount(0)

    // Cashiers can see which modules are on, but not change them.
    await call(ui, 'users:create', {
      username: 'meena',
      displayName: 'Meena',
      roleCode: 'cashier',
      password: PASSWORD
    })
    await signOut(ui)
    await signIn(ui, { username: 'meena', password: PASSWORD })
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
    await expect(call(ui, 'modules:list')).resolves.toMatchObject({ ok: true })
    await expect(
      call(ui, 'modules:set-enabled', { code: 'grocery', enabled: false })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' }
    })
  })
})
