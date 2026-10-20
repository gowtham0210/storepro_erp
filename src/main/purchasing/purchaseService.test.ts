import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoodsReceiptInput, PurchaseLineInput } from '@shared/ipc/contract'
import { checkIntegrity } from '../db/integrity'
import { useMigratedDb } from '../db/test/testDb'
import { rejection, setUpStore, taxClassId, variant } from '../test/store'

describe('PurchaseService (M15)', () => {
  const getDb = useMigratedDb()
  let bed: Awaited<ReturnType<typeof setUpStore>>
  let supplierId: number
  let otherSupplierId: number
  let riceId: number
  let soapId: number
  let oilId: number
  let bagId: number

  const EMPTY = {
    contactPerson: null,
    phone: null,
    email: null,
    address: null,
    taxRegistrationNumber: null
  }
  const onHand = (variantId: number): number | undefined =>
    bed.inventory.findVariantStock(variantId)?.onHandMilli

  const line = (
    variantId: number,
    quantityMilli: number,
    unitCostMinor: number
  ): PurchaseLineInput => ({
    variantId,
    quantityMilli,
    unitCostMinor
  })

  const receipt = (overrides: Partial<GoodsReceiptInput> = {}): GoodsReceiptInput => ({
    supplierId,
    purchaseOrderId: null,
    supplierInvoiceNumber: null,
    supplierInvoiceDate: null,
    lines: [line(soapId, 10_000, 3200)],
    post: false,
    ...overrides
  })

  beforeEach(async () => {
    bed = await setUpStore(getDb())
    const actor = bed.actor()
    const gst5 = taxClassId(bed, 'GST 5%')
    const product = (name: string, sku: string, unitCode: string, tracksInventory = true): number =>
      bed.productService.create(actor, {
        name,
        categoryId: null,
        taxClassId: gst5,
        hsnCode: null,
        tracksInventory,
        variants: [variant({ sku, unitCode, costPriceMinor: 3000 })]
      }).variants[0]!.variantId
    riceId = product('Sona Masoori Rice', 'RICE', 'kg')
    soapId = product('Neem Soap', 'SOAP', 'pcs')
    oilId = product('Groundnut Oil', 'OIL', 'l')
    bagId = product('Cloth Carry Bag', 'BAG', 'pcs', false)
    supplierId = bed.supplierService.create(actor, { name: 'Anand Wholesale', ...EMPTY }).supplierId
    otherSupplierId = bed.supplierService.create(actor, {
      name: 'Balaji Traders',
      ...EMPTY
    }).supplierId
  })

  describe('purchase orders (M15-02)', () => {
    it('keeps drafts out of stock, then fixes the order once confirmed', async () => {
      const actor = bed.actor()
      const draft = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: 'Weekend restock',
        lines: [line(soapId, 24_000, 3200), line(riceId, 50_500, 4833)]
      })
      expect(draft).toMatchObject({
        orderNumber: 'PO000001',
        status: 'draft',
        supplierName: 'Anand Wholesale',
        createdByName: 'Ravi Kumar'
      })
      // 24 × 32.00 = 768.00; 50.5 kg × 48.33 = 2440.665 → 2440.67
      expect(draft.lines.map((l) => l.totalMinor)).toEqual([76_800, 244_067])
      expect(draft.totalMinor).toBe(320_867)
      expect(onHand(soapId)).toBe(0)
      expect(onHand(riceId)).toBe(0)

      // A draft is editable: its lines are replaced.
      const edited = bed.purchaseService.saveOrder(actor, {
        purchaseOrderId: draft.purchaseOrderId,
        supplierId,
        notes: null,
        lines: [line(soapId, 12_000, 3200)]
      })
      expect(edited.lines).toHaveLength(1)
      expect(edited.orderNumber).toBe('PO000001')

      const confirmed = bed.purchaseService.confirmOrder(actor, {
        purchaseOrderId: draft.purchaseOrderId
      })
      expect(confirmed.status).toBe('confirmed')
      expect(confirmed.confirmedAt).not.toBeNull()
      expect(onHand(soapId)).toBe(0)

      const error = await rejection(() =>
        bed.purchaseService.saveOrder(actor, {
          purchaseOrderId: draft.purchaseOrderId,
          supplierId,
          notes: null,
          lines: [line(soapId, 99_000, 3200)]
        })
      )
      expect(error.code).toBe('CONFLICT')
      expect(
        bed.purchaseService.getOrder(actor, { purchaseOrderId: draft.purchaseOrderId }).lines[0]
          ?.quantityMilli
      ).toBe(12_000)

      expect(bed.audit().map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'purchase_order.created',
          'purchase_order.updated',
          'purchase_order.confirmed'
        ])
      )
    })

    it('can save and confirm in one step, and deletes only drafts', async () => {
      const actor = bed.actor()
      const confirmed = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: null,
        lines: [line(soapId, 5000, 3200)],
        confirm: true
      })
      expect(confirmed.status).toBe('confirmed')
      expect(
        (
          await rejection(() =>
            bed.purchaseService.deleteOrder(actor, { purchaseOrderId: confirmed.purchaseOrderId })
          )
        ).code
      ).toBe('CONFLICT')

      const draft = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: null,
        lines: [line(soapId, 5000, 3200)]
      })
      bed.purchaseService.deleteOrder(actor, { purchaseOrderId: draft.purchaseOrderId })
      expect(
        (
          await rejection(() =>
            bed.purchaseService.getOrder(actor, { purchaseOrderId: draft.purchaseOrderId })
          )
        ).code
      ).toBe('NOT_FOUND')
      expect(bed.audit().some((e) => e.action === 'purchase_order.deleted')).toBe(true)
    })

    it('rejects items that cannot be bought', async () => {
      const actor = bed.actor()
      const save = (lines: PurchaseLineInput[], id = supplierId) =>
        bed.purchaseService.saveOrder(actor, { supplierId: id, notes: null, lines })

      expect((await rejection(() => save([line(bagId, 1000, 100)]))).message).toContain(
        'not tracked'
      )
      expect((await rejection(() => save([line(soapId, 1500, 3200)]))).code).toBe(
        'VALIDATION_FAILED'
      )
      expect((await rejection(() => save([line(99_999, 1000, 100)]))).code).toBe(
        'VALIDATION_FAILED'
      )
      // Fractions are fine for a unit that allows them.
      expect(save([line(riceId, 1500, 4800)]).lines).toHaveLength(1)

      const productId = bed.inventory.findVariantStock(oilId)!.productId
      bed.productService.setActive(actor, { productId, active: false })
      expect((await rejection(() => save([line(oilId, 1000, 100)]))).message).toContain('archived')

      bed.supplierService.setActive(actor, { supplierId: otherSupplierId, active: false })
      expect(
        (await rejection(() => save([line(soapId, 1000, 100)], otherSupplierId))).message
      ).toContain('archived')
    })

    it('cancels an order nothing has arrived for, and closes one by hand', async () => {
      const actor = bed.actor()
      const make = () =>
        bed.purchaseService.saveOrder(actor, {
          supplierId,
          notes: null,
          lines: [line(soapId, 5000, 3200)],
          confirm: true
        }).purchaseOrderId

      const toCancel = make()
      const cancelled = bed.purchaseService.cancelOrder(actor, {
        purchaseOrderId: toCancel,
        reason: 'Supplier out of stock'
      })
      expect(cancelled.status).toBe('cancelled')
      const entry = bed.audit().findLast((e) => e.action === 'purchase_order.cancelled')
      expect(JSON.parse(entry?.details ?? '{}')).toMatchObject({
        reason: 'Supplier out of stock'
      })
      // Cancelled orders cannot take goods.
      expect(
        (
          await rejection(() =>
            bed.purchaseService.saveReceipt(
              actor,
              receipt({ purchaseOrderId: toCancel, lines: [line(soapId, 1000, 3200)] })
            )
          )
        ).code
      ).toBe('CONFLICT')

      const toClose = make()
      expect(bed.purchaseService.closeOrder(actor, { purchaseOrderId: toClose }).status).toBe(
        'closed'
      )
      expect(
        (await rejection(() => bed.purchaseService.closeOrder(actor, { purchaseOrderId: toClose })))
          .code
      ).toBe('CONFLICT')

      const draft = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: null,
        lines: [line(soapId, 5000, 3200)]
      })
      expect(
        (
          await rejection(() =>
            bed.purchaseService.cancelOrder(actor, { purchaseOrderId: draft.purchaseOrderId })
          )
        ).message
      ).toContain('deleted')
    })
  })

  describe('goods receipts (M15-03, M15-04, M15-07)', () => {
    it('does not change stock for a draft, and adds it exactly once on posting', async () => {
      const actor = bed.actor()
      const draft = bed.purchaseService.saveReceipt(
        actor,
        receipt({ supplierInvoiceNumber: 'AW-1042', supplierInvoiceDate: '2026-10-18' })
      )
      expect(draft).toMatchObject({
        receiptNumber: 'GRN000001',
        status: 'draft',
        purchaseOrderId: null,
        supplierInvoiceNumber: 'AW-1042',
        supplierInvoiceDate: '2026-10-18',
        postedAt: null,
        totalMinor: 32_000
      })
      expect(onHand(soapId)).toBe(0)

      // Editing a draft replaces its lines and still has no effect on stock.
      const edited = bed.purchaseService.saveReceipt(
        actor,
        receipt({
          goodsReceiptId: draft.goodsReceiptId,
          supplierInvoiceNumber: 'AW-1042',
          lines: [line(soapId, 12_000, 3200)]
        })
      )
      expect(edited.lines[0]?.quantityMilli).toBe(12_000)
      expect(onHand(soapId)).toBe(0)

      const posted = bed.purchaseService.postReceipt(actor, {
        goodsReceiptId: draft.goodsReceiptId
      })
      expect(posted).toMatchObject({ status: 'posted', postedByName: 'Ravi Kumar' })
      expect(onHand(soapId)).toBe(12_000)

      // Posting again, editing or deleting a posted receipt changes nothing.
      for (const attempt of [
        () => bed.purchaseService.postReceipt(actor, { goodsReceiptId: draft.goodsReceiptId }),
        () =>
          bed.purchaseService.saveReceipt(
            actor,
            receipt({ goodsReceiptId: draft.goodsReceiptId, lines: [line(soapId, 99_000, 1)] })
          ),
        () => bed.purchaseService.deleteReceipt(actor, { goodsReceiptId: draft.goodsReceiptId })
      ]) {
        expect((await rejection(attempt)).code).toBe('CONFLICT')
      }
      expect(onHand(soapId)).toBe(12_000)

      const movements = bed.inventoryService.movements(actor, { variantId: soapId })
      expect(movements.items).toHaveLength(1)
      expect(movements.items[0]).toMatchObject({
        movementType: 'goods_receipt',
        quantityDeltaMilli: 12_000,
        documentNumber: 'GRN000001',
        actorName: 'Ravi Kumar'
      })
      expect(bed.inventoryService.verifyLedgerConsistency().ok).toBe(true)
      expect(checkIntegrity(getDb(), 'quick').ok).toBe(true)
    })

    it('saves and posts in one step, as a direct purchase (M15-04)', () => {
      const actor = bed.actor()
      const posted = bed.purchaseService.saveReceipt(
        actor,
        receipt({ post: true, lines: [line(soapId, 6000, 3200), line(riceId, 2500, 4800)] })
      )
      expect(posted.status).toBe('posted')
      expect(onHand(soapId)).toBe(6000)
      expect(onHand(riceId)).toBe(2500)
      const entry = bed.audit().findLast((e) => e.action === 'goods_receipt.posted')
      expect(JSON.parse(entry?.details ?? '{}')).toMatchObject({
        receiptNumber: 'GRN000001',
        supplier: 'Anand Wholesale',
        total: '₹312.00'
      })
    })

    it('receives against an order in parts, and closes it when everything has arrived', async () => {
      const actor = bed.actor()
      const order = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: null,
        lines: [line(soapId, 24_000, 3200), line(riceId, 10_000, 4800)],
        confirm: true
      })

      const first = bed.purchaseService.saveReceipt(
        actor,
        receipt({
          purchaseOrderId: order.purchaseOrderId,
          lines: [line(soapId, 10_000, 3200)],
          post: true
        })
      )
      expect(first.orderNumber).toBe('PO000001')
      let detail = bed.purchaseService.getOrder(actor, { purchaseOrderId: order.purchaseOrderId })
      expect(detail.status).toBe('confirmed')
      expect(detail.lines.map((l) => [l.receivedMilli, l.outstandingMilli])).toEqual([
        [10_000, 14_000],
        [0, 10_000]
      ])
      expect(detail.receipts).toEqual([
        expect.objectContaining({ receiptNumber: 'GRN000001', status: 'posted' })
      ])

      bed.purchaseService.saveReceipt(
        actor,
        receipt({
          purchaseOrderId: order.purchaseOrderId,
          lines: [line(soapId, 14_000, 3200), line(riceId, 10_000, 4800)],
          post: true
        })
      )
      detail = bed.purchaseService.getOrder(actor, { purchaseOrderId: order.purchaseOrderId })
      expect(detail.status).toBe('closed')
      expect(detail.lines.every((l) => l.outstandingMilli === 0)).toBe(true)
      expect(onHand(soapId)).toBe(24_000)
      expect(onHand(riceId)).toBe(10_000)
      expect(
        JSON.parse(bed.audit().findLast((e) => e.action === 'purchase_order.closed')?.details ?? '')
      ).toMatchObject({ reason: 'fully received on GRN000002' })

      // A closed order takes no more goods.
      expect(
        (
          await rejection(() =>
            bed.purchaseService.saveReceipt(
              actor,
              receipt({ purchaseOrderId: order.purchaseOrderId, lines: [line(soapId, 1000, 3200)] })
            )
          )
        ).code
      ).toBe('CONFLICT')
    })

    it('accepts more than was ordered, and refuses items or suppliers that do not match', async () => {
      const actor = bed.actor()
      const order = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: null,
        lines: [line(soapId, 10_000, 3200)],
        confirm: true
      })
      const against = (overrides: Partial<GoodsReceiptInput>) =>
        bed.purchaseService.saveReceipt(
          actor,
          receipt({ purchaseOrderId: order.purchaseOrderId, ...overrides })
        )

      expect(
        (await rejection(() => against({ lines: [line(riceId, 1000, 4800)] }))).message
      ).toContain('not on order PO000001')
      expect((await rejection(() => against({ supplierId: otherSupplierId }))).message).toContain(
        'different supplier'
      )

      const draftOrder = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: null,
        lines: [line(soapId, 1000, 3200)]
      })
      expect(
        (
          await rejection(() =>
            bed.purchaseService.saveReceipt(
              actor,
              receipt({ purchaseOrderId: draftOrder.purchaseOrderId })
            )
          )
        ).message
      ).toContain('still a draft')

      against({ lines: [line(soapId, 12_000, 3200)], post: true })
      expect(onHand(soapId)).toBe(12_000)
      expect(
        bed.purchaseService.getOrder(actor, { purchaseOrderId: order.purchaseOrderId }).status
      ).toBe('closed')
    })

    it('holds a supplier bill number to one receipt per supplier', async () => {
      const actor = bed.actor()
      const first = bed.purchaseService.saveReceipt(
        actor,
        receipt({ supplierInvoiceNumber: 'INV-77' })
      )
      const error = await rejection(() =>
        bed.purchaseService.saveReceipt(actor, receipt({ supplierInvoiceNumber: 'INV-77' }))
      )
      expect(error.code).toBe('CONFLICT')
      expect(error.message).toContain(first.receiptNumber)

      // Re-saving the same draft with its own number is fine, and so is another supplier's.
      bed.purchaseService.saveReceipt(
        actor,
        receipt({ goodsReceiptId: first.goodsReceiptId, supplierInvoiceNumber: 'INV-77' })
      )
      bed.purchaseService.saveReceipt(
        actor,
        receipt({ supplierId: otherSupplierId, supplierInvoiceNumber: 'INV-77' })
      )
    })

    it('blocks closing or cancelling an order while a draft receipt waits, and re-checks at posting', async () => {
      const actor = bed.actor()
      const order = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: null,
        lines: [line(soapId, 10_000, 3200)],
        confirm: true
      })
      const draft = bed.purchaseService.saveReceipt(
        actor,
        receipt({ purchaseOrderId: order.purchaseOrderId, lines: [line(soapId, 4000, 3200)] })
      )
      for (const attempt of [
        () => bed.purchaseService.closeOrder(actor, { purchaseOrderId: order.purchaseOrderId }),
        () => bed.purchaseService.cancelOrder(actor, { purchaseOrderId: order.purchaseOrderId })
      ]) {
        expect((await rejection(attempt)).message).toContain('draft goods receipt')
      }

      // Once the draft is gone the order can be closed, and nothing is left to post.
      bed.purchaseService.deleteReceipt(actor, { goodsReceiptId: draft.goodsReceiptId })
      bed.purchaseService.closeOrder(actor, { purchaseOrderId: order.purchaseOrderId })
      expect(onHand(soapId)).toBe(0)
    })

    it('posts nothing when any part fails (atomic)', async () => {
      const actor = bed.actor()
      const order = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: null,
        lines: [line(soapId, 4000, 3500)],
        confirm: true
      })
      const draft = bed.purchaseService.saveReceipt(
        actor,
        receipt({ purchaseOrderId: order.purchaseOrderId, lines: [line(soapId, 4000, 3500)] })
      )

      const audit = vi.spyOn(bed.auditLog, 'change').mockImplementation((entry) => {
        if (entry.action === 'goods_receipt.posted') throw new Error('disk full')
      })
      await expect(
        Promise.resolve().then(() =>
          bed.purchaseService.postReceipt(actor, {
            goodsReceiptId: draft.goodsReceiptId,
            updateCosts: true
          })
        )
      ).rejects.toThrow('disk full')
      audit.mockRestore()

      expect(onHand(soapId)).toBe(0)
      expect(
        bed.purchaseService.getReceipt(actor, { goodsReceiptId: draft.goodsReceiptId }).status
      ).toBe('draft')
      expect(
        bed.purchaseService.getOrder(actor, { purchaseOrderId: order.purchaseOrderId }).status
      ).toBe('confirmed')
      expect(bed.purchaseRepository.findVariant(soapId)?.costPriceMinor).toBe(3000)

      // The retry succeeds, and stock is added once.
      bed.purchaseService.postReceipt(actor, { goodsReceiptId: draft.goodsReceiptId })
      expect(onHand(soapId)).toBe(4000)
    })

    it('needs the purchase permission to post, and the product permission to update costs', async () => {
      await bed.signInAs('cashier')
      expect(
        (await rejection(() => bed.purchaseService.saveReceipt(bed.actor(), receipt()))).code
      ).toBe('FORBIDDEN')
      expect((await rejection(() => bed.purchaseService.listOrders(bed.actor()))).code).toBe(
        'FORBIDDEN'
      )

      await bed.signInAs('inventory_operator')
      const posted = bed.purchaseService.saveReceipt(bed.actor(), receipt({ post: true }))
      expect(posted.status).toBe('posted')
    })
  })

  describe('purchase cost (M15-05)', () => {
    it('lists what an item cost on each posted receipt, newest first', () => {
      const actor = bed.actor()
      bed.clock.time += 1000
      bed.purchaseService.saveReceipt(
        actor,
        receipt({ post: true, lines: [line(soapId, 5000, 3200)] })
      )
      bed.clock.time += 1000
      bed.purchaseService.saveReceipt(
        actor,
        receipt({ supplierId: otherSupplierId, post: true, lines: [line(soapId, 8000, 3350)] })
      )
      // Drafts are not history.
      bed.purchaseService.saveReceipt(actor, receipt({ lines: [line(soapId, 1000, 9999)] }))

      const history = bed.purchaseService.costHistory(actor, { variantId: soapId })
      expect(history).toMatchObject({ name: 'Neem Soap', currentCostMinor: 3000 })
      expect(
        history.entries.map((e) => [e.supplierName, e.unitCostMinor, e.quantityMilli])
      ).toEqual([
        ['Balaji Traders', 3350, 8000],
        ['Anand Wholesale', 3200, 5000]
      ])
    })

    it('updates the item cost price only when asked, and audits the change', () => {
      const actor = bed.actor()
      bed.purchaseService.saveReceipt(
        actor,
        receipt({ post: true, lines: [line(soapId, 5000, 3200)] })
      )
      expect(bed.purchaseRepository.findVariant(soapId)?.costPriceMinor).toBe(3000)

      bed.purchaseService.saveReceipt(
        actor,
        receipt({
          post: true,
          updateCosts: true,
          lines: [line(soapId, 5000, 3350), line(riceId, 1000, 3000)]
        })
      )
      expect(bed.purchaseRepository.findVariant(soapId)?.costPriceMinor).toBe(3350)
      // Rice was bought at its existing cost, so only soap is listed.
      const entry = bed.audit().findLast((e) => e.action === 'goods_receipt.posted')
      expect(JSON.parse(entry?.details ?? '{}').costPricesUpdated).toEqual([
        { item: 'Neem Soap', from: '₹30.00', to: '₹33.50' }
      ])
    })
  })

  describe('lists (M15-06)', () => {
    it('filters orders and receipts, and totals match the detail view', () => {
      const actor = bed.actor()
      const a = bed.purchaseService.saveOrder(actor, {
        supplierId,
        notes: null,
        lines: [line(riceId, 50_500, 4833), line(soapId, 3000, 3333)],
        confirm: true
      })
      bed.purchaseService.saveOrder(actor, {
        supplierId: otherSupplierId,
        notes: null,
        lines: [line(soapId, 1000, 3200)]
      })

      const all = bed.purchaseService.listOrders(actor)
      expect(all.total).toBe(2)
      expect(all.items.map((o) => o.orderNumber)).toEqual(['PO000002', 'PO000001'])
      const listed = all.items.find((o) => o.purchaseOrderId === a.purchaseOrderId)
      expect(listed).toMatchObject({ lineCount: 2, totalMinor: a.totalMinor })

      expect(bed.purchaseService.listOrders(actor, { status: 'draft' }).items).toHaveLength(1)
      expect(bed.purchaseService.listOrders(actor, { supplierId }).items).toHaveLength(1)
      expect(bed.purchaseService.listOrders(actor, { search: 'balaji' }).items).toHaveLength(1)
      expect(bed.purchaseService.listOrders(actor, { search: 'PO000001' }).items).toHaveLength(1)

      const r = bed.purchaseService.saveReceipt(
        actor,
        receipt({ supplierInvoiceNumber: 'AW-9', lines: [line(riceId, 50_500, 4833)], post: true })
      )
      bed.purchaseService.saveReceipt(actor, receipt({ supplierId: otherSupplierId }))
      const receipts = bed.purchaseService.listReceipts(actor)
      expect(receipts.total).toBe(2)
      expect(receipts.items.find((x) => x.goodsReceiptId === r.goodsReceiptId)).toMatchObject({
        status: 'posted',
        totalMinor: r.totalMinor,
        lineCount: 1
      })
      expect(bed.purchaseService.listReceipts(actor, { status: 'draft' }).items).toHaveLength(1)
      expect(bed.purchaseService.listReceipts(actor, { search: 'AW-9' }).items).toHaveLength(1)
      expect(bed.purchaseService.listReceipts(actor, { supplierId }).items).toHaveLength(1)
    })
  })
})
