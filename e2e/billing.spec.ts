import { expect, goTo, test } from './fixtures'

test.describe('billing and payments (M11, M12)', () => {
  test('scans barcode, holds and resumes a bill, completes split/cash checkout, and voids a sale', async ({
    ui
  }) => {
    // Seed product and initial stock.
    await goTo(ui, '/products')
    await ui.getByRole('button', { name: 'Add product' }).first().click()
    const addDialog = ui.getByRole('dialog', { name: 'Add product' })
    await addDialog.getByLabel(/^Product name/).fill('Tata Tea Gold')
    await addDialog.getByLabel(/^Tax rate/).selectOption({ label: 'GST 5%' })
    await addDialog.getByLabel(/^Pack size/).fill('250 g')
    await addDialog.getByLabel(/^Selling price/).fill('150')
    await addDialog.getByLabel(/^Barcode/).fill('8901052001012')
    await addDialog.getByRole('button', { name: 'Add product' }).click()
    const editor = ui.getByRole('dialog', { name: 'Tata Tea Gold' })
    await editor.getByRole('button', { name: 'Close' }).last().click()

    await goTo(ui, '/inventory')
    await ui.getByRole('button', { name: 'Adjust Tata Tea Gold 250 g' }).click()
    const adjustDialog = ui.getByRole('dialog', { name: 'Adjust stock' })
    await adjustDialog.getByLabel('Quantity for Tata Tea Gold 250 g').fill('10')
    await adjustDialog.getByRole('button', { name: 'Record adjustment' }).click()

    // Go to Billing and scan the barcode twice (quantity = 2).
    await goTo(ui, '/billing')
    const scanInput = ui.getByLabel('Scan barcode or enter SKU')
    await scanInput.fill('8901052001012')
    await scanInput.press('Enter')
    await scanInput.fill('8901052001012')
    await scanInput.press('Enter')

    const cartTable = ui.getByRole('table', { name: 'Current bill items' })
    await expect(cartTable).toContainText('Tata Tea Gold')
    await expect(ui.getByRole('textbox', { name: 'Quantity of Tata Tea Gold 250 g' })).toHaveValue(
      '2'
    )

    // Hold the bill and resume it.
    await ui.getByRole('button', { name: /Hold bill/ }).click()
    const holdDialog = ui.getByRole('dialog', { name: 'Hold bill' })
    await holdDialog.getByLabel(/^Note or customer label/).fill('Counter 1 customer')
    await holdDialog.getByRole('button', { name: 'Hold bill' }).click()

    await expect(ui.getByText('No items on this bill yet')).toBeVisible()
    await ui.getByRole('button', { name: /Held bills/ }).click()
    const heldDialog = ui.getByRole('dialog', { name: 'Held bills' })
    await expect(heldDialog).toContainText('Counter 1 customer')
    await heldDialog.getByRole('button', { name: 'Resume' }).click()

    await expect(ui.getByRole('textbox', { name: 'Quantity of Tata Tea Gold 250 g' })).toHaveValue(
      '2'
    )

    // Take cash payment (2 * 150 = 300, tender 500 -> change 200.00).
    await ui.getByRole('button', { name: /Take payment/ }).click()
    const payDialog = ui.getByRole('dialog', { name: 'Take payment' })
    await payDialog.getByLabel('Cash tendered').fill('500')
    await expect(payDialog.getByText('Change to return')).toBeVisible()
    await payDialog.getByRole('button', { name: 'Complete sale' }).click()

    const completedDialog = ui.getByRole('dialog', { name: /Sale completed · INV000001/ })
    await expect(completedDialog).toBeVisible()
    await completedDialog.getByRole('button', { name: 'Start next bill' }).click()

    // Verify stock was deducted to 8 in Inventory.
    await goTo(ui, '/inventory')
    await expect(ui.getByRole('table', { name: 'Inventory' })).toContainText('8')

    // Inspect and void the sale on Sales page, verifying stock is restored to 10.
    await goTo(ui, '/sales')
    const salesTable = ui.getByRole('table', { name: 'Past sales invoices' })
    await expect(salesTable).toContainText('INV000001')
    await ui.getByRole('button', { name: 'View invoice INV000001' }).click()

    const detailDialog = ui.getByRole('dialog', { name: 'Invoice INV000001' })
    await expect(detailDialog).toContainText('Tata Tea Gold')
    await detailDialog.getByRole('button', { name: 'Void sale' }).click()

    const voidDialog = ui.getByRole('dialog', { name: 'Void invoice INV000001' })
    await voidDialog.getByLabel(/^Reason for voiding/).fill('Customer asked to cancel immediately')
    await voidDialog.getByRole('button', { name: 'Confirm void' }).click()

    await expect(detailDialog).toContainText('Customer asked to cancel immediately')
    await detailDialog.getByRole('button', { name: 'Close' }).last().click()
    await expect(salesTable).toContainText('Voided')

    await goTo(ui, '/inventory')
    await expect(ui.getByRole('table', { name: 'Inventory' })).toContainText('10')
  })
})
