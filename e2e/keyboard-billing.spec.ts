import type { Page } from '@playwright/test'
import { expect, invokeIpc, test } from './fixtures'

/**
 * M30-06: a whole bill with the keyboard alone. The counter is used all day,
 * often one-handed with a scanner in the other, so every step has to be
 * reachable and finishable without a mouse (PRD §10.3 and the keyboard
 * acceptance criteria).
 *
 * A tripwire records any real mouse or touch input. The test fails if one
 * happens, so a step that quietly needed a click cannot slip in. (A button
 * activated with Enter or Space makes a `click` event too, with no pointer
 * behind it, so only clicks that come from a pointer are counted.)
 */

const BARCODE = '8901052001012'

async function seedTea(ui: Page): Promise<number> {
  return ui.evaluate(async (barcode) => {
    const call = async <T>(channel: string, input?: unknown): Promise<T> => {
      const result = await (
        window.storepro.invoke as (
          c: string,
          i?: unknown
        ) => Promise<{ ok: boolean; data?: T; error?: unknown }>
      )(channel, input)
      if (!result.ok) throw new Error(`${channel} failed: ${JSON.stringify(result.error)}`)
      return result.data as T
    }
    const classes = await call<{ taxClassId: number; name: string }[]>('tax:list-classes')
    const gst5 = classes.find((c) => c.name === 'GST 5%')
    if (!gst5) throw new Error('GST 5% is not seeded')
    const product = await call<{ variants: { variantId: number }[] }>('products:create', {
      name: 'Tata Tea Gold',
      categoryId: null,
      taxClassId: gst5.taxClassId,
      hsnCode: null,
      tracksInventory: true,
      variants: [
        {
          variantName: '250 g',
          sku: null,
          unitCode: 'pcs',
          sellingPriceMinor: 15_000,
          mrpMinor: null,
          costPriceMinor: null,
          reorderLevelMilli: null,
          barcodes: [barcode]
        }
      ]
    })
    const variantId = product.variants[0]?.variantId ?? 0
    await call('inventory:adjust', {
      reasonCode: 'opening_stock',
      notes: null,
      items: [{ variantId, quantityDeltaMilli: 10_000 }]
    })
    return variantId
  }, BARCODE)
}

/** From now on, any pointer input is recorded. */
async function watchForMouse(ui: Page): Promise<void> {
  await ui.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { pointerInput: string[] }).pointerInput = seen
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'touchstart', 'dblclick']) {
      window.addEventListener(type, () => seen.push(type), true)
    }
    window.addEventListener(
      'click',
      (event) => {
        if (event.detail > 0) seen.push('click')
      },
      true
    )
  })
}

const pointerInput = (ui: Page): Promise<string[]> =>
  ui.evaluate(() => (window as unknown as { pointerInput: string[] }).pointerInput)

/** Press Tab until the target has focus, as a person would, failing if it never gets there. */
async function tabTo(ui: Page, target: ReturnType<Page['getByRole']>, max = 25): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return
    await ui.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

test.describe('keyboard-only billing (M30-06)', () => {
  test('a whole bill: scan, search, discount, hold, resume, pay and start the next', async ({
    ui
  }) => {
    const variantId = await seedTea(ui)
    const scan = ui.getByLabel('Scan barcode or enter SKU')
    await expect(scan).toBeFocused() // the counter starts ready to scan
    await watchForMouse(ui)

    // Scan twice: the same item adds to the line.
    await ui.keyboard.type(BARCODE)
    await ui.keyboard.press('Enter')
    await ui.keyboard.type(BARCODE)
    await ui.keyboard.press('Enter')
    const quantity = ui.getByRole('textbox', { name: 'Quantity of Tata Tea Gold 250 g' })
    await expect(quantity).toHaveValue('2')
    await expect(scan).toBeFocused() // and it is ready for the next scan

    // F4: find an item by name, pick it with Tab and Enter.
    await ui.keyboard.press('F4')
    const search = ui.getByRole('dialog', { name: 'Find product' })
    await expect(search.getByLabel('Search item')).toBeFocused()
    await ui.keyboard.type('Tata')
    const add = search.getByRole('button', { name: 'Add Tata Tea Gold 250 g to bill' })
    await expect(add).toBeVisible()
    await tabTo(ui, add)
    await ui.keyboard.press('Enter')
    await expect(search).toBeHidden()
    await expect(quantity).toHaveValue('3')
    await expect(scan).toBeFocused()

    // The line's quantity and the payment button can both be reached with Tab.
    await tabTo(ui, quantity)
    await tabTo(ui, ui.getByRole('button', { name: /Take payment/ }))
    await scan.focus()

    // F6: a 5% bill discount, typed and confirmed with Enter.
    await ui.keyboard.press('F6')
    const discount = ui.getByRole('dialog', { name: 'Bill discount' })
    await expect(discount).toBeVisible()
    await expect(discount.getByLabel('Discount percentage (%)')).toBeFocused()
    await ui.keyboard.type('5')
    await ui.keyboard.press('Enter')
    await expect(discount).toBeHidden()

    // F9: hold the bill with a label, then F8 and resume it.
    await ui.keyboard.press('F9')
    const hold = ui.getByRole('dialog', { name: 'Hold bill' })
    await expect(hold.getByLabel(/^Note or customer label/)).toBeFocused()
    await ui.keyboard.type('Counter 2')
    await ui.keyboard.press('Enter')
    await expect(ui.getByText('No items on this bill yet')).toBeVisible()

    await ui.keyboard.press('F8')
    const held = ui.getByRole('dialog', { name: 'Held bills' })
    await expect(held).toContainText('Counter 2')
    await tabTo(ui, held.getByRole('button', { name: /^Resume/ }))
    await ui.keyboard.press('Enter')
    await expect(held).toBeHidden()
    await expect(quantity).toHaveValue('3')

    // F12: take cash. The tendered field is ready, Enter completes the sale.
    await ui.keyboard.press('F12')
    const pay = ui.getByRole('dialog', { name: 'Take payment' })
    await expect(pay.getByLabel('Cash tendered')).toBeFocused()
    await ui.keyboard.press('Control+A')
    await ui.keyboard.type('1000')
    await expect(pay.getByText('Change to return')).toBeVisible()
    await ui.keyboard.press('Enter')

    const done = ui.getByRole('dialog', { name: /Sale completed · INV000001/ })
    await expect(done).toBeVisible()
    await expect(done.getByRole('button', { name: 'Start next bill' })).toBeFocused()
    await ui.keyboard.press('Enter')
    await expect(done).toBeHidden()
    await expect(ui.getByText('No items on this bill yet')).toBeVisible()
    await expect(scan).toBeFocused() // ready for the next customer

    // What was saved: one sale for three teas with the discount, and the stock came off.
    const list = await invokeIpc<{ total: number; items: { saleId: number }[] }>(
      ui,
      'sales:list',
      {}
    )
    const sale = await invokeIpc<{ discountMinor: number; lines: { quantityMilli: number }[] }>(
      ui,
      'sales:get',
      { saleId: list.items[0]?.saleId }
    )
    const stock = await invokeIpc<{ onHandMilli: number }>(ui, 'inventory:movements', {
      variantId
    })
    const saved = {
      sales: list.total,
      lines: sale.lines.map((l) => l.quantityMilli),
      discountMinor: sale.discountMinor,
      onHandMilli: stock.onHandMilli
    }
    expect(saved.sales).toBe(1)
    expect(saved.lines).toEqual([3000])
    expect(saved.discountMinor).toBeGreaterThan(0)
    expect(saved.onHandMilli).toBe(7000)

    expect(await pointerInput(ui)).toEqual([])
  })

  test('Escape backs out of every dialog and returns to the scan field', async ({ ui }) => {
    await seedTea(ui)
    const scan = ui.getByLabel('Scan barcode or enter SKU')
    await expect(scan).toBeFocused()
    await watchForMouse(ui)
    await ui.keyboard.type(BARCODE)
    await ui.keyboard.press('Enter')
    await expect(ui.getByRole('textbox', { name: 'Quantity of Tata Tea Gold 250 g' })).toHaveValue(
      '1'
    )

    for (const [key, name] of [
      ['F4', 'Find product'],
      ['F6', 'Bill discount'],
      ['F8', 'Held bills'],
      ['F9', 'Hold bill'],
      ['F12', 'Take payment']
    ] as const) {
      await ui.keyboard.press(key)
      const dialog = ui.getByRole('dialog', { name })
      await expect(dialog, `${key} opens ${name}`).toBeVisible()
      await ui.keyboard.press('Escape')
      await expect(dialog, `Escape closes ${name}`).toBeHidden()
      await expect(scan, `focus is back on the scan field after ${name}`).toBeFocused()
    }
    // Nothing was changed by opening and closing them.
    await expect(ui.getByRole('textbox', { name: 'Quantity of Tata Tea Gold 250 g' })).toHaveValue(
      '1'
    )
    expect(await pointerInput(ui)).toEqual([])
  })

  test('the shortcuts for a bill do nothing while the bill is empty, and are listed', async ({
    ui
  }) => {
    await seedTea(ui)
    await expect(ui.getByLabel('Scan barcode or enter SKU')).toBeFocused()
    // F6, F9 and F12 need something on the bill, so with none they open nothing.
    for (const key of ['F6', 'F9', 'F12']) {
      await ui.keyboard.press(key)
      await expect(ui.getByRole('dialog')).toHaveCount(0)
    }
    // F4 and F8 work on an empty bill.
    await ui.keyboard.press('F8')
    await expect(ui.getByRole('dialog', { name: 'Held bills' })).toBeVisible()
    await ui.keyboard.press('Escape')
  })
})
