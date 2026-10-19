import {
  closeStorePro,
  createUserDataDir,
  expect,
  goTo,
  launchStorePro,
  removeUserDataDir,
  test
} from './fixtures'

test.describe('product catalogue (M09)', () => {
  test('a product added with its barcode survives a restart and is found by scanning', async () => {
    const userDataDir = createUserDataDir()
    const storepro = await launchStorePro(userDataDir)
    const ui = storepro.window
    await goTo(ui, '/products')
    await expect(ui.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible()
    await expect(ui.getByText('No products yet')).toBeVisible()

    await ui.getByRole('button', { name: 'Add product' }).first().click()
    const dialog = ui.getByRole('dialog', { name: 'Add product' })
    await dialog.getByLabel(/^Product name/).fill('Toor Dal')
    await dialog.getByLabel(/^Tax rate/).selectOption({ label: 'GST 5%' })
    await dialog.getByLabel(/^Pack size/).fill('1 kg')
    await dialog.getByLabel(/^Selling price/).fill('160')
    await dialog.getByLabel(/^MRP/).fill('170')
    await dialog.getByLabel(/^Barcodes/).fill('8901000000028')
    await dialog.getByRole('button', { name: 'Add product' }).click()

    // The saved product opens for more pack sizes.
    const editor = ui.getByRole('dialog', { name: 'Toor Dal' })
    await expect(editor.getByText('ITEM-00001')).toBeVisible()
    await editor.getByRole('button', { name: 'Add pack size' }).click()
    const pack = ui.getByRole('dialog', { name: 'Add a pack size of Toor Dal' })
    await pack.getByLabel(/^Pack size/).fill('1 kg')
    await pack.getByLabel(/^Selling price/).fill('80')
    await pack.getByRole('button', { name: 'Add pack size' }).click()
    await expect(
      pack.getByText('Another pack size of this product already has this name')
    ).toBeVisible()
    await pack.getByLabel(/^Pack size/).fill('500 g')
    await pack.getByRole('button', { name: 'Add pack size' }).click()
    await expect(editor.getByText('500 g')).toBeVisible()
    await editor.getByRole('button', { name: 'Close' }).last().click()

    const table = ui.getByRole('table', { name: 'Products' })
    await expect(table.getByRole('row')).toHaveCount(3)
    await ui.getByLabel(/^Search/).fill('890100000002')
    await expect(table.getByRole('row')).toHaveCount(2)
    await expect(table).toContainText('₹160.00')

    await closeStorePro(storepro)
    const again = await launchStorePro(userDataDir)
    try {
      await expect(again.window.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
      const found = await again.window.evaluate(() =>
        window.storepro.invoke('products:find-by-barcode', { barcode: '8901000000028' })
      )
      expect(found).toMatchObject({
        ok: true,
        data: { name: 'Toor Dal 1 kg', sellingPriceMinor: 16000, mrpMinor: 17000 }
      })
    } finally {
      await closeStorePro(again)
      removeUserDataDir(userDataDir)
    }
  })
})
