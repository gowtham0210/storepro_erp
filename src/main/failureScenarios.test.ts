import type { GoodsReceiptInput } from '@shared/ipc/contract'
import { describe, expect, it, vi } from 'vitest'
import { checkIntegrity } from './db/integrity'
import { useMigratedDb } from './db/test/testDb'
import { setUpStore, taxClassId, variant } from './test/store'

/**
 * M30-07: what happens when something fails part-way through the operations that
 * change money or stock. Each failure is injected at the last step, after every
 * other row has been written, so a leak shows. The rule in every case: nothing is
 * kept, no number is used up, and trying again works exactly once.
 */
describe('failure scenarios (M30-07)', () => {
  const getDb = useMigratedDb()

  async function world() {
    const bed = await setUpStore(getDb())
    const actor = bed.actor()
    const { variantId } = bed.productService.create(actor, {
      name: 'Neem Soap',
      categoryId: null,
      taxClassId: taxClassId(bed, 'GST 18%'),
      hsnCode: null,
      tracksInventory: true,
      variants: [variant({ sku: 'SOAP', sellingPriceMinor: 4500 })]
    }).variants[0]!
    bed.inventoryService.adjust(actor, {
      reasonCode: 'opening_stock',
      notes: null,
      items: [{ variantId, quantityDeltaMilli: 10_000 }]
    })
    const cash = bed.paymentService.listMethods().find((m) => m.kind === 'cash')!
    const supplier = bed.supplierService.create(actor, {
      name: 'Anand Wholesale',
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      taxRegistrationNumber: null
    })
    return { bed, actor, variantId, cashId: cash.paymentMethodId, supplierId: supplier.supplierId }
  }

  const onHand = (w: Awaited<ReturnType<typeof world>>): number | undefined =>
    w.bed.inventory.findVariantStock(w.variantId)?.onHandMilli

  it('a sale whose audit entry cannot be written is not recorded, and the retry is invoice 1', async () => {
    const w = await world()
    const auditFails = vi.spyOn(w.bed.auditLog, 'change').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const checkout = () =>
      w.bed.salesService.checkout(w.actor, {
        checkoutKey: 'till-1-bill-7',
        lines: [{ variantId: w.variantId, quantityMilli: 2000, unitPriceMinor: 4500 }],
        payments: [{ paymentMethodId: w.cashId, amountMinor: 9000, tenderedMinor: 9000 }]
      })

    expect(checkout).toThrow('disk full')
    expect(auditFails).toHaveBeenCalledTimes(1)
    expect(w.bed.sales.list({}).total).toBe(0)
    expect(onHand(w)).toBe(10_000)

    // The cashier presses Pay again, with the same key as the screen would send.
    const sale = checkout()
    expect(sale.invoiceNumber).toBe('INV000001')
    expect(onHand(w)).toBe(8000)

    // And a third press (a double-click, a retry after a timeout) does not sell twice.
    expect(checkout().saleId).toBe(sale.saleId)
    expect(w.bed.sales.list({}).total).toBe(1)
    expect(onHand(w)).toBe(8000)
    expect(checkIntegrity(getDb(), 'full').ok).toBe(true)
  })

  it('a goods receipt that fails while posting adds no stock, stays a draft, and posts once on retry', async () => {
    const w = await world()
    const input: GoodsReceiptInput = {
      supplierId: w.supplierId,
      purchaseOrderId: null,
      supplierInvoiceNumber: 'AW-1042',
      supplierInvoiceDate: null,
      lines: [{ variantId: w.variantId, quantityMilli: 12_000, unitCostMinor: 3200 }],
      post: false
    }
    const draft = w.bed.purchaseService.saveReceipt(w.actor, input)

    vi.spyOn(w.bed.auditLog, 'change').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    expect(() =>
      w.bed.purchaseService.postReceipt(w.actor, { goodsReceiptId: draft.goodsReceiptId })
    ).toThrow('disk full')
    expect(onHand(w)).toBe(10_000)
    expect(
      w.bed.purchaseService.getReceipt(w.actor, { goodsReceiptId: draft.goodsReceiptId }).status
    ).toBe('draft')

    w.bed.purchaseService.postReceipt(w.actor, { goodsReceiptId: draft.goodsReceiptId })
    expect(onHand(w)).toBe(22_000)
    expect(checkIntegrity(getDb(), 'full').ok).toBe(true)
  })

  it('a held bill that fails to save leaves no half-saved bill behind', async () => {
    const w = await world()
    const db = getDb()
    db.exec(`
      CREATE TEMP TRIGGER fail_on_second_held_line
      BEFORE INSERT ON held_bill_items
      WHEN NEW.line_number = 2
      BEGIN
        SELECT RAISE(ABORT, 'simulated failure');
      END;
    `)
    const hold = () =>
      w.bed.salesService.holdBill(w.actor, {
        label: 'Counter 2',
        items: [
          { variantId: w.variantId, quantityMilli: 1000 },
          { variantId: w.variantId, quantityMilli: 2000 }
        ]
      })
    expect(hold).toThrow('simulated failure')
    expect(w.bed.salesService.listHeldBills(w.actor)).toEqual([])
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM held_bill_items')?.n).toBe(0)

    db.exec('DROP TRIGGER fail_on_second_held_line')
    hold()
    expect(w.bed.salesService.listHeldBills(w.actor)).toHaveLength(1)
  })

  it('an expense that fails to save is not recorded, and can be entered again', async () => {
    const w = await world()
    const category = w.bed.expenseService.listCategories(w.actor)[0]!
    vi.spyOn(w.bed.auditLog, 'change').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const record = () =>
      w.bed.expenseService.record(w.actor, {
        expenseCategoryId: category.expenseCategoryId,
        expenseDate: '2026-10-19',
        amountMinor: 12_000,
        paymentMethodId: w.cashId,
        description: 'Shop rent'
      })
    expect(record).toThrow('disk full')
    expect(getDb().get<{ n: number }>('SELECT count(*) AS n FROM expenses')?.n).toBe(0)
    record()
    expect(getDb().get<{ n: number }>('SELECT count(*) AS n FROM expenses')?.n).toBe(1)
  })
})
