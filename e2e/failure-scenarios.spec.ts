import {
  closeStorePro,
  createUserDataDir,
  expect,
  invokeIpc,
  isProcessRunning,
  killProcessTree,
  launchStorePro,
  removeUserDataDir,
  test
} from './fixtures'

/**
 * M30-07: the real app is killed with no warning (as a power cut or "End task"
 * does) right after the till has confirmed a sale or saved a held bill. Whatever
 * the till confirmed must be there on the next start, whole, and the next
 * invoice number must carry on from it. (A kill part-way through a sale is
 * tested against the database in src/main/db/crashRecovery.test.ts.)
 */

interface SaleRow {
  saleId: number
  invoiceNumber: string
}

test.describe('failure scenarios (M30-07)', () => {
  test('a confirmed sale and a held bill survive a hard kill, and billing carries on', async () => {
    const userDataDir = createUserDataDir()
    try {
      const first = await launchStorePro(userDataDir)
      const classes = await invokeIpc<{ taxClassId: number; name: string }[]>(
        first.window,
        'tax:list-classes'
      )
      const product = await invokeIpc<{ variants: { variantId: number }[] }>(
        first.window,
        'products:create',
        {
          name: 'Neem Soap',
          categoryId: null,
          taxClassId: classes.find((c) => c.name === 'GST 18%')?.taxClassId,
          hsnCode: null,
          tracksInventory: true,
          variants: [
            {
              variantName: null,
              sku: 'SOAP',
              unitCode: 'pcs',
              sellingPriceMinor: 4500,
              mrpMinor: null,
              costPriceMinor: null,
              reorderLevelMilli: null,
              barcodes: []
            }
          ]
        }
      )
      const variantId = product.variants[0]?.variantId ?? 0
      await invokeIpc(first.window, 'inventory:adjust', {
        reasonCode: 'opening_stock',
        notes: null,
        items: [{ variantId, quantityDeltaMilli: 10_000 }]
      })
      const methods = await invokeIpc<{ paymentMethodId: number; kind: string }[]>(
        first.window,
        'payments:list-methods'
      )
      const cashId = methods.find((m) => m.kind === 'cash')?.paymentMethodId ?? 0
      const checkout = (key: string, quantity: number) =>
        invokeIpc<SaleRow>(first.window, 'sales:checkout', {
          checkoutKey: key,
          lines: [{ variantId, quantityMilli: quantity * 1000, unitPriceMinor: 4500 }],
          payments: [{ paymentMethodId: cashId, amountMinor: quantity * 4500 }]
        })

      const sale = await checkout('before-the-cut', 2)
      expect(sale.invoiceNumber).toBe('INV000001')
      await invokeIpc(first.window, 'sales:hold', {
        label: 'Counter 2',
        items: [{ variantId, quantityMilli: 3000 }]
      })

      const killed = first.app.process()
      await killProcessTree(killed)
      expect(isProcessRunning(killed.pid)).toBe(false)

      const second = await launchStorePro(userDataDir)
      try {
        await second.window.getByRole('heading', { level: 1, name: 'Billing' }).waitFor()
        const sales = await invokeIpc<{ items: SaleRow[]; total: number }>(
          second.window,
          'sales:list',
          {}
        )
        expect(sales.total).toBe(1)
        expect(sales.items[0]?.invoiceNumber).toBe('INV000001')
        const held = await invokeIpc<{ label: string | null; lineCount: number }[]>(
          second.window,
          'sales:list-held'
        )
        expect(held).toMatchObject([{ label: 'Counter 2', lineCount: 1 }])
        const stock = await invokeIpc<{ items: { variantId: number; onHandMilli: number }[] }>(
          second.window,
          'inventory:list',
          {}
        )
        expect(stock.items.find((i) => i.variantId === variantId)?.onHandMilli).toBe(8000)

        // The same checkout key sent again (a retry after the crash) must not sell twice.
        const again = await invokeIpc<SaleRow>(second.window, 'sales:checkout', {
          checkoutKey: 'before-the-cut',
          lines: [{ variantId, quantityMilli: 2000, unitPriceMinor: 4500 }],
          payments: [{ paymentMethodId: cashId, amountMinor: 9000 }]
        })
        expect(again.saleId).toBe(sale.saleId)

        const next = await invokeIpc<SaleRow>(second.window, 'sales:checkout', {
          checkoutKey: 'after-the-cut',
          lines: [{ variantId, quantityMilli: 1000, unitPriceMinor: 4500 }],
          payments: [{ paymentMethodId: cashId, amountMinor: 4500 }]
        })
        expect(next.invoiceNumber).toBe('INV000002')
      } finally {
        await closeStorePro(second)
      }
    } finally {
      removeUserDataDir(userDataDir)
    }
  })
})
