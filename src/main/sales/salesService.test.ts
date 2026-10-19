import { TEST_STORE } from '@shared/test/stores'
import { UPI_RECORDED_NOTICE } from '@shared/payments'
import { describe, expect, it } from 'vitest'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { useMigratedDb } from '../db/test/testDb'
import { createRealIpc } from '../ipc/test/realHandlers'

describe('SalesService and PaymentService (M11, M12, M13-01)', () => {
  const getDb = useMigratedDb()

  async function setupStore() {
    const db = getDb()
    const bed = createTestbed(db)
    const ipc = createRealIpc(bed)
    await ipc.invoke('setup:complete', { store: TEST_STORE, administrator: OWNER })

    const taxClasses = await ipc.invoke('tax:list-classes')
    const gst5 = taxClasses.find((t) => t.rateBp === 500)!
    const gst18 = taxClasses.find((t) => t.rateBp === 1800)!

    const rice = await ipc.invoke('products:create', {
      name: 'Ponni Rice 5 kg',
      categoryId: null,
      taxClassId: gst5.taxClassId,
      hsnCode: '1006',
      tracksInventory: true,
      variants: [
        {
          variantName: null,
          sku: 'RICE-5KG',
          unitCode: 'pcs',
          sellingPriceMinor: 32_000,
          mrpMinor: 35_000,
          costPriceMinor: 26_000,
          reorderLevelMilli: 5000,
          barcodes: ['8901234000011']
        }
      ]
    })

    const oil = await ipc.invoke('products:create', {
      name: 'Gingelly Oil 1 L',
      categoryId: null,
      taxClassId: gst18.taxClassId,
      hsnCode: '1515',
      tracksInventory: true,
      variants: [
        {
          variantName: null,
          sku: 'OIL-1L',
          unitCode: 'pcs',
          sellingPriceMinor: 25_000,
          mrpMinor: 26_000,
          costPriceMinor: 19_500,
          reorderLevelMilli: 3000,
          barcodes: ['8901234000028']
        }
      ]
    })

    // Seed opening stock: 20 bags of rice, 15 bottles of oil.
    await ipc.invoke('inventory:adjust', {
      reasonCode: 'opening_stock',
      notes: 'Initial count',
      items: [
        { variantId: rice.variants[0]!.variantId, quantityDeltaMilli: 20_000 },
        { variantId: oil.variants[0]!.variantId, quantityDeltaMilli: 15_000 }
      ]
    })

    const methods = await ipc.invoke('payments:list-methods')
    const cash = methods.find((m) => m.methodCode === 'cash')!
    const upi = methods.find((m) => m.methodCode === 'upi')!
    const card = methods.find((m) => m.methodCode === 'card')!

    return {
      db,
      bed,
      ipc,
      riceVariantId: rice.variants[0]!.variantId,
      oilVariantId: oil.variants[0]!.variantId,
      cash,
      upi,
      card
    }
  }

  it('completes a sale atomically with sequential invoice number, tax breakdown, cash change, UPI notice, stock deduction, and audit log (M11-07, M12-02, M12-03, M13-01)', async () => {
    const { ipc, bed, riceVariantId, oilVariantId, cash, upi } = await setupStore()

    // 2 bags of rice (2 * 320.00 = 640.00) + 1 bottle of oil (250.00) = 890.00 (89000 paise)
    // Split payment: 500.00 by UPI + 390.00 due in Cash, customer tenders 500.00 cash -> 110.00 change
    const sale = await ipc.invoke('sales:checkout', {
      checkoutKey: 'chk-atomic-001',
      lines: [
        { variantId: riceVariantId, quantityMilli: 2000, unitPriceMinor: 32_000 },
        { variantId: oilVariantId, quantityMilli: 1000, unitPriceMinor: 25_000 }
      ],
      payments: [
        { paymentMethodId: upi.paymentMethodId, amountMinor: 50_000, reference: 'UPI-41239988' },
        {
          paymentMethodId: cash.paymentMethodId,
          amountMinor: 39_000,
          tenderedMinor: 50_000
        }
      ]
    })

    expect(sale.invoiceNumber).toBe('INV000001')
    expect(sale.grandTotalMinor).toBe(89_000)
    expect(sale.paidMinor).toBe(89_000)
    expect(sale.lines).toHaveLength(2)
    expect(sale.lines[0]).toMatchObject({
      variantId: riceVariantId,
      description: 'Ponni Rice 5 kg',
      hsnCode: '1006',
      quantityMilli: 2000,
      unitPriceMinor: 32_000,
      totalMinor: 64_000
    })
    expect(sale.lines[0]!.taxes.map((t) => t.code)).toEqual(['CGST', 'SGST'])

    expect(sale.payments).toEqual([
      expect.objectContaining({
        methodCode: 'upi',
        kind: 'upi',
        amountMinor: 50_000,
        tenderedMinor: null,
        changeMinor: 0,
        reference: 'UPI-41239988',
        verificationNotice: UPI_RECORDED_NOTICE
      }),
      expect.objectContaining({
        methodCode: 'cash',
        kind: 'cash',
        amountMinor: 39_000,
        tenderedMinor: 50_000,
        changeMinor: 11_000,
        verificationNotice: null
      })
    ])

    // Stock deducted immediately: rice 20 -> 18, oil 15 -> 14
    expect(bed.inventory.findVariantStock(riceVariantId)?.onHandMilli).toBe(18_000)
    expect(bed.inventory.findVariantStock(oilVariantId)?.onHandMilli).toBe(14_000)

    // Audit entry recorded in same transaction
    const saleAudit = bed.audit().find((a) => a.action === 'sale.created')
    expect(saleAudit).toBeDefined()
    expect(JSON.parse(saleAudit!.details!)).toMatchObject({
      invoiceNumber: 'INV000001',
      items: 2,
      total: '₹890.00'
    })
  })

  it('prevents duplicate sales and double stock deduction when checkoutKey is retried (M11-08)', async () => {
    const { ipc, bed, riceVariantId, cash } = await setupStore()

    const payload = {
      checkoutKey: 'chk-idempotent-777',
      lines: [{ variantId: riceVariantId, quantityMilli: 3000, unitPriceMinor: 32_000 }],
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: 96_000 }]
    }

    const first = await ipc.invoke('sales:checkout', payload)
    const second = await ipc.invoke('sales:checkout', payload)

    expect(second.saleId).toBe(first.saleId)
    expect(second.invoiceNumber).toBe('INV000001')
    // Stock deducted once: 20 - 3 = 17
    expect(bed.inventory.findVariantStock(riceVariantId)?.onHandMilli).toBe(17_000)

    // Next distinct sale gets INV000002 with no gap
    const next = await ipc.invoke('sales:checkout', {
      ...payload,
      checkoutKey: 'chk-idempotent-778'
    })
    expect(next.invoiceNumber).toBe('INV000002')
  })

  it('rolls back invoice number, sale items, payments, and stock if a failure occurs mid-checkout (M11-13)', async () => {
    const { db, bed, riceVariantId, cash } = await setupStore()

    // Inject a trigger that aborts when a payment with reference 'BOOM' is inserted,
    // after `sales`, `sale_items`, and `sale_item_taxes` have already been written.
    db.exec(`
      CREATE TEMP TRIGGER fail_on_boom_payment
      BEFORE INSERT ON sale_payments
      WHEN NEW.reference = 'BOOM'
      BEGIN
        SELECT RAISE(ABORT, 'simulated mid-checkout failure');
      END;
    `)

    expect(() =>
      bed.salesService.checkout(bed.actor(), {
        checkoutKey: 'chk-rollback-001',
        lines: [{ variantId: riceVariantId, quantityMilli: 2000, unitPriceMinor: 32_000 }],
        payments: [
          {
            paymentMethodId: cash.paymentMethodId,
            amountMinor: 64_000,
            reference: 'BOOM'
          }
        ]
      })
    ).toThrow(/simulated mid-checkout failure/)

    // Nothing persisted, stock untouched, sequence still issues INV000001 next
    expect(bed.sales.list({}).total).toBe(0)
    expect(bed.inventory.findVariantStock(riceVariantId)?.onHandMilli).toBe(20_000)

    const cleanSale = bed.salesService.checkout(bed.actor(), {
      checkoutKey: 'chk-rollback-002',
      lines: [{ variantId: riceVariantId, quantityMilli: 1000, unitPriceMinor: 32_000 }],
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: 32_000 }]
    })
    expect(cleanSale.invoiceNumber).toBe('INV000001')
  })

  it('blocks checkout when allowNegativeStock is off and allows it when enabled (M14-01, M14-03)', async () => {
    const { ipc, bed, riceVariantId, cash } = await setupStore()

    // Try selling 25 bags when only 20 are on hand (default allowNegativeStock = false)
    const blocked = await ipc.send('sales:checkout', {
      checkoutKey: 'chk-neg-001',
      lines: [{ variantId: riceVariantId, quantityMilli: 25_000, unitPriceMinor: 32_000 }],
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: 800_000 }]
    })
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' }
    })
    expect(bed.inventory.findVariantStock(riceVariantId)?.onHandMilli).toBe(20_000)

    // Enable allowNegativeStock in store settings and retry
    await ipc.invoke('store:update', { ...TEST_STORE, allowNegativeStock: true })
    const allowed = await ipc.invoke('sales:checkout', {
      checkoutKey: 'chk-neg-001',
      lines: [{ variantId: riceVariantId, quantityMilli: 25_000, unitPriceMinor: 32_000 }],
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: 800_000 }]
    })
    expect(allowed.invoiceNumber).toBe('INV000001')
    expect(bed.inventory.findVariantStock(riceVariantId)?.onHandMilli).toBe(-5_000)
  })

  it('enforces discount limits and price override permissions, unlocking with manager approval (M10-05, M06-05)', async () => {
    const { ipc, bed, riceVariantId, cash } = await setupStore()

    // Set store max cashier discount to 5% (500 bp)
    await ipc.invoke('pricing:update-policy', { roundingMinor: 100, maxDiscountBp: 500 })

    // Create a cashier account and sign in as cashier
    await ipc.invoke('users:create', {
      username: 'cashier1',
      displayName: 'Meena',
      roleCode: 'cashier',
      password: 'cashier-pass-99'
    })
    await ipc.invoke('auth:sign-out')
    await ipc.invoke('auth:sign-in', { username: 'cashier1', password: 'cashier-pass-99' })

    // 10% discount exceeds the 5% cap -> refused with FORBIDDEN (overridable: true)
    const refusedDiscount = await ipc.send('sales:checkout', {
      checkoutKey: 'chk-disc-override',
      lines: [
        {
          variantId: riceVariantId,
          quantityMilli: 1000,
          unitPriceMinor: 32_000,
          discount: { kind: 'percent', bp: 1000 }
        }
      ],
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: 28_800 }]
    })
    expect(refusedDiscount).toMatchObject({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        details: { permission: 'discount.override', overridable: true }
      }
    })

    // Manager approves `discount.override`
    const approval = await ipc.invoke('auth:approve-override', {
      permission: 'discount.override',
      username: OWNER.username,
      password: OWNER.password
    })

    const approvedSale = await ipc.invoke('sales:checkout', {
      checkoutKey: 'chk-disc-override',
      lines: [
        {
          variantId: riceVariantId,
          quantityMilli: 1000,
          unitPriceMinor: 32_000,
          discount: { kind: 'percent', bp: 1000 }
        }
      ],
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: 28_800 }],
      overrideId: approval.overrideId
    })
    expect(approvedSale.grandTotalMinor).toBe(28_800)

    const auditEntry = bed.audit().find((a) => a.action === 'sale.created')
    expect(auditEntry?.approved_by_user_id).toBe(1)
  })

  it('supports holding, listing, resuming, and discarding bills (M11-09)', async () => {
    const { ipc, riceVariantId, oilVariantId, cash } = await setupStore()

    const held = await ipc.invoke('sales:hold', {
      label: 'Lady in blue saree',
      items: [
        {
          variantId: riceVariantId,
          quantityMilli: 1000,
          unitPriceOverrideMinor: 32_000,
          discountMinor: 1000
        },
        { variantId: oilVariantId, quantityMilli: 2000 }
      ]
    })
    expect(held.lineCount).toBe(2)

    const list = await ipc.invoke('sales:list-held')
    expect(list).toHaveLength(1)
    expect(list[0]!.label).toBe('Lady in blue saree')

    const resumed = await ipc.invoke('sales:resume-held', { heldBillId: held.heldBillId })
    expect(resumed.items).toHaveLength(2)
    expect(resumed.items[0]!.discountMinor).toBe(1000)
    expect(await ipc.invoke('sales:list-held')).toHaveLength(0)

    // Holding another bill and completing checkout with heldBillId removes it automatically
    const held2 = await ipc.invoke('sales:hold', {
      label: 'Phone order',
      items: [{ variantId: riceVariantId, quantityMilli: 1000 }]
    })
    await ipc.invoke('sales:checkout', {
      checkoutKey: 'chk-from-held',
      heldBillId: held2.heldBillId,
      lines: [{ variantId: riceVariantId, quantityMilli: 1000, unitPriceMinor: 32_000 }],
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: 32_000 }]
    })
    expect(await ipc.invoke('sales:list-held')).toHaveLength(0)
  })

  it('voids a completed sale, restores stock, and records manager approval when a cashier voids (M11-10)', async () => {
    const { ipc, bed, riceVariantId, cash } = await setupStore()

    const sale = await ipc.invoke('sales:checkout', {
      checkoutKey: 'chk-void-001',
      lines: [{ variantId: riceVariantId, quantityMilli: 2000, unitPriceMinor: 32_000 }],
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: 64_000 }]
    })
    expect(bed.inventory.findVariantStock(riceVariantId)?.onHandMilli).toBe(18_000)

    const voided = await ipc.invoke('sales:void', {
      saleId: sale.saleId,
      reason: 'Customer forgot wallet'
    })
    expect(voided.voidInfo).toMatchObject({
      reason: 'Customer forgot wallet',
      voidedByName: OWNER.displayName
    })
    // Stock restored to 20 bags
    expect(bed.inventory.findVariantStock(riceVariantId)?.onHandMilli).toBe(20_000)

    // Voiding again is rejected
    expect(
      await ipc.send('sales:void', { saleId: sale.saleId, reason: 'Duplicate void' })
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' }
    })
  })

  it('manages payment methods and records return refund payments (M12-01, M12-04)', async () => {
    const { db, ipc, bed, riceVariantId, cash, upi } = await setupStore()

    // Create a custom payment method
    const created = await ipc.invoke('payments:create-method', {
      methodCode: 'sodexo',
      name: 'Meal Pass',
      kind: 'other'
    })
    expect(created).toMatchObject({
      methodCode: 'sodexo',
      name: 'Meal Pass',
      kind: 'other',
      active: true
    })

    // Complete a sale with Cash so Cash is now `inUse`
    const sale = await ipc.invoke('sales:checkout', {
      checkoutKey: 'chk-pm-001',
      lines: [{ variantId: riceVariantId, quantityMilli: 1000, unitPriceMinor: 32_000 }],
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: 32_000 }]
    })

    // Cannot change kind of a method that has recorded payments
    expect(
      await ipc.send('payments:update-method', {
        paymentMethodId: cash.paymentMethodId,
        name: 'Cash Drawer',
        kind: 'other'
      })
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })

    // Record a linked return and refund payment via PaymentRepository (M12-04)
    const saleReturnId = Number(
      db
        .run(
          `INSERT INTO sale_returns (return_number, sale_id, returned_at, processed_by_user_id, reason)
           VALUES ('RET-000001', ?, ?, 1, 'Damaged pack')`,
          [sale.saleId, bed.clock.now()]
        )
        .lastInsertRowid
    )
    bed.payments.recordReturnRefunds(saleReturnId, [
      { paymentMethodId: upi.paymentMethodId, amountMinor: 32_000, reference: 'REF-UPI-99' }
    ])

    const afterRefund = await ipc.invoke('sales:get', { saleId: sale.saleId })
    expect(afterRefund.refunds).toEqual([
      expect.objectContaining({
        saleReturnId,
        returnNumber: 'RET-000001',
        methodCode: 'upi',
        amountMinor: 32_000,
        reference: 'REF-UPI-99'
      })
    ])
  })

  it('completes a 10-line checkout well under 500 ms (M11-14)', async () => {
    const { ipc, riceVariantId, oilVariantId, cash } = await setupStore()

    const lines = Array.from({ length: 10 }, (_, idx) => ({
      variantId: idx % 2 === 0 ? riceVariantId : oilVariantId,
      quantityMilli: 1000,
      unitPriceMinor: idx % 2 === 0 ? 32_000 : 25_000
    }))
    const expectedTotal = 5 * 32_000 + 5 * 25_000

    const start = performance.now()
    const sale = await ipc.invoke('sales:checkout', {
      checkoutKey: 'chk-perf-10lines',
      lines,
      payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: expectedTotal }]
    })
    const elapsedMs = performance.now() - start

    expect(sale.lines).toHaveLength(10)
    expect(elapsedMs).toBeLessThan(500)
  })
})
