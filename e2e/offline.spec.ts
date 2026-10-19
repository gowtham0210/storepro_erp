import type { Page } from '@playwright/test'
import { expect, goTo, OWNER, setNetwork, signIn, signOut, test } from './fixtures'

const PASSWORD = 'till-drawer-77'
const OFFLINE = 'Offline · billing still works'

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

test.describe('offline (M08)', () => {
  test('the header follows the connection, as the main process sees it', async ({
    storepro,
    ui
  }) => {
    const indicator = ui
      .getByRole('banner')
      .getByRole('status')
      .filter({ hasText: /Online|Offline/ })
    await expect(indicator).toHaveText('Online')
    await setNetwork(storepro, false)
    await expect(indicator).toHaveText(OFFLINE, { timeout: 10_000 })
    await expect(call(ui, 'connectivity:get-status')).resolves.toMatchObject({
      ok: true,
      data: { online: false }
    })
    await setNetwork(storepro, true)
    await expect(indicator).toHaveText('Online', { timeout: 10_000 })
  })

  // M08-03. Billing arrives with M11 and will be added here; everything built so far is covered.
  test('everything works with the network cut', async ({ storepro, ui }) => {
    await setNetwork(storepro, false)
    await expect(ui.getByText(OFFLINE)).toBeVisible({ timeout: 10_000 })

    // Users.
    await goTo(ui, '/users')
    await ui.getByRole('button', { name: 'Add user' }).click()
    const dialog = ui.getByRole('dialog', { name: 'Add user' })
    await dialog.getByLabel(/^Name/).fill('Meena Sundar')
    await dialog.getByLabel(/^Username/).fill('meena')
    await dialog.getByLabel(/^Password/).fill(PASSWORD)
    await dialog.getByLabel(/Confirm password/).fill(PASSWORD)
    await dialog.getByRole('button', { name: 'Add user' }).click()
    await expect(ui.getByText('Meena Sundar can now sign in as meena.')).toBeVisible()

    // Settings.
    await goTo(ui, '/settings')
    const receipts = ui.getByRole('region', { name: 'Receipts' })
    await receipts.getByLabel(/Message at the bottom/).fill('Open all days.')
    await receipts.getByRole('button', { name: 'Save receipts' }).click()
    await expect(ui.getByText('Receipts saved.')).toBeVisible()

    // Signing out and in, as at a change of shift.
    await signOut(ui)
    await signIn(ui, { username: 'meena', password: PASSWORD })
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
    await signOut(ui)
    await signIn(ui, OWNER)
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()

    // The audit log recorded all of it.
    await goTo(ui, '/audit')
    const table = ui.getByRole('table', { name: /Audit log entries/ })
    await expect(table.getByRole('row', { name: /Changed store settings/ })).toBeVisible()
    await expect(table.getByRole('row', { name: /Meena Sundar.*Signed in/ })).toBeVisible()
    await expect(ui.getByText(OFFLINE)).toBeVisible()
  })
})
