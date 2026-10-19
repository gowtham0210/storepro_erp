import type { Page } from '@playwright/test'
import {
  closeStorePro,
  createUserDataDir,
  expect,
  goTo,
  launchStorePro,
  OWNER,
  removeUserDataDir,
  setNetwork,
  signIn,
  signOut,
  test
} from './fixtures'

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

  // M08-03: Disconnect network, complete a sale, restart app while offline, verify sale persisted.
  test('completes a sale offline and persists it across an offline restart (M08-03)', async () => {
    const userDataDir = createUserDataDir()
    const first = await launchStorePro(userDataDir)
    try {
      const ui = first.window
      await setNetwork(first, false)
      await expect(ui.getByText(OFFLINE)).toBeVisible({ timeout: 10_000 })

      // Add a product with a barcode and record opening stock while offline.
      await goTo(ui, '/products')
      await ui.getByRole('button', { name: 'Add product' }).first().click()
      const addDialog = ui.getByRole('dialog', { name: 'Add product' })
      await addDialog.getByLabel(/^Product name/).fill('Amul Butter')
      await addDialog.getByLabel(/^Tax rate/).selectOption({ label: 'GST 5%' })
      await addDialog.getByLabel(/^Pack size/).fill('100 g')
      await addDialog.getByLabel(/^Selling price/).fill('58')
      await addDialog.getByLabel(/^Barcode/).fill('8901262010016')
      await addDialog.getByRole('button', { name: 'Add product' }).click()
      const editor = ui.getByRole('dialog', { name: 'Amul Butter' })
      await editor.getByRole('button', { name: 'Close' }).last().click()

      await goTo(ui, '/inventory')
      await ui.getByRole('button', { name: 'Adjust Amul Butter 100 g' }).click()
      const adjustDialog = ui.getByRole('dialog', { name: 'Adjust stock' })
      await adjustDialog.getByLabel('Quantity for Amul Butter 100 g').fill('5')
      await adjustDialog.getByRole('button', { name: 'Record adjustment' }).click()

      // Scan barcode on Billing and complete cash sale while offline.
      await goTo(ui, '/billing')
      await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
      const scanInput = ui.getByLabel('Scan barcode or enter SKU')
      await scanInput.fill('8901262010016')
      await scanInput.press('Enter')

      await expect(ui.getByRole('table', { name: 'Current bill items' })).toContainText(
        'Amul Butter'
      )
      await ui.getByRole('button', { name: /Take payment/ }).click()
      const payDialog = ui.getByRole('dialog', { name: 'Take payment' })
      await payDialog.getByLabel('Cash tendered').fill('100')
      await payDialog.getByRole('button', { name: 'Complete sale' }).click()

      const completedDialog = ui.getByRole('dialog', { name: /Sale completed · INV000001/ })
      await expect(completedDialog).toBeVisible()
      await completedDialog.getByRole('button', { name: 'Start next bill' }).click()
    } finally {
      await closeStorePro(first)
    }

    // Restart the app while still offline and verify the sale persisted.
    const second = await launchStorePro(userDataDir, { signIn: false })
    try {
      await setNetwork(second, false)
      await signIn(second.window, OWNER)
      await expect(second.window.getByText(OFFLINE)).toBeVisible({ timeout: 10_000 })

      await goTo(second.window, '/sales')
      await expect(second.window.getByRole('heading', { level: 1, name: 'Sales' })).toBeVisible()
      const salesTable = second.window.getByRole('table', { name: 'Past sales invoices' })
      await expect(salesTable).toContainText('INV000001')
      await expect(salesTable).toContainText('Completed')
    } finally {
      await closeStorePro(second)
      removeUserDataDir(userDataDir)
    }
  })
})
