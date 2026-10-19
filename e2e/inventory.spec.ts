import {
  closeStorePro,
  createUserDataDir,
  expect,
  goTo,
  launchStorePro,
  removeUserDataDir,
  test
} from './fixtures'

test.describe('inventory and stock ledger (M14)', () => {
  test('opening stock, stock counts and movement history persist across restarts', async () => {
    const userDataDir = createUserDataDir()
    const storepro = await launchStorePro(userDataDir)
    try {
      const ui = storepro.window
      await goTo(ui, '/products')

      // Create an inventory-tracked product with a 5 kg low-stock threshold.
      await ui.getByRole('button', { name: 'Add product' }).first().click()
      const addDialog = ui.getByRole('dialog', { name: 'Add product' })
      await addDialog.getByLabel(/^Product name/).fill('Sona Masoori Rice')
      await addDialog.getByLabel(/^Tax rate/).selectOption({ label: 'GST 5%' })
      await addDialog.getByLabel(/^Pack size/).fill('1 kg')
      await addDialog.getByLabel(/^Unit/).selectOption('kg')
      await addDialog.getByLabel(/^Selling price/).fill('60')
      await addDialog.getByLabel(/^Low-stock level/).fill('5')
      await addDialog.getByRole('button', { name: 'Add product' }).click()

      const editor = ui.getByRole('dialog', { name: 'Sona Masoori Rice' })
      await editor.getByRole('button', { name: 'Close' }).last().click()

      // Navigate to Inventory: item starts at 0 kg (Out of stock).
      await goTo(ui, '/inventory')
      await expect(ui.getByRole('heading', { level: 1, name: 'Inventory' })).toBeVisible()
      const table = ui.getByRole('table', { name: 'Inventory' })
      await expect(table).toContainText('Sona Masoori Rice')
      await expect(table).toContainText('Out of stock')

      // Record opening stock of 12.5 kg.
      await ui.getByRole('button', { name: 'Adjust Sona Masoori Rice 1 kg' }).click()
      const adjustDialog = ui.getByRole('dialog', { name: 'Adjust stock' })
      await adjustDialog.getByLabel('Quantity for Sona Masoori Rice 1 kg').fill('12.5')
      await adjustDialog.getByLabel(/^Note/).fill('Initial shelf count')
      await adjustDialog.getByRole('button', { name: 'Record adjustment' }).click()

      await expect(table).toContainText('12.5')

      // Reconcile a physical stock count down to 4 kg (triggers Low stock badge).
      await ui.getByRole('button', { name: 'Count stock' }).click()
      const countDialog = ui.getByRole('dialog', { name: 'Count stock' })
      await countDialog.getByLabel('Counted quantity for Sona Masoori Rice 1 kg').fill('4')
      await expect(countDialog).toContainText('-8.5 kg')
      await countDialog.getByRole('button', { name: 'Approve count' }).click()

      await expect(table).toContainText('Low stock')
      await expect(table).toContainText('4')

      // Check movement history dialog shows both ADJ000002 and ADJ000001.
      await ui.getByRole('button', { name: 'Movements for Sona Masoori Rice 1 kg' }).click()
      const historyDialog = ui.getByRole('dialog', {
        name: 'Sona Masoori Rice 1 kg — Stock movements'
      })
      await expect(historyDialog).toContainText('ADJ000002')
      await expect(historyDialog).toContainText('Adjustment · Stock count correction')
      await expect(historyDialog).toContainText('ADJ000001')
      await expect(historyDialog).toContainText('Adjustment · Opening stock')
      await historyDialog.getByRole('button', { name: 'Close' }).click()
    } finally {
      await closeStorePro(storepro)
      removeUserDataDir(userDataDir)
    }
  })
})
