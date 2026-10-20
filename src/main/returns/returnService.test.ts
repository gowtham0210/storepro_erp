import { TEST_STORE } from '@shared/test/stores'
import { describe, expect, it, vi } from 'vitest'
import type { ReturnInput, ReturnInputLine, SaleDetail } from '@shared/ipc/contract'
import { quoteReturn } from '@shared/returns'
import { insertSale } from '../db/dev/builders'
import { checkIntegrity } from '../db/integrity'
import { useMigratedDb } from '../db/test/testDb'
import { rejection, setUpStore, taxClassId, variant } from '../test/store'

type Bed = Awaited<ReturnType<typeof setUpStore>>

interface World {
  bed: Bed
  sale: SaleDetail
  riceId: number
  oilId: number
  cashId: number
  upiId: number
}

describe('ReturnService (M16)', () => {
  const getDb = useMigratedDb()

  /** Rice 2 × ₹320.00 and oil 1 × ₹250.00 with ₹30.00 off the bill (₹860.00), paid in cash. */
  async function world(): Promise<World> {
    const bed = await setUpStore(getDb())
    const actor = bed.actor()
    const make = (name: string, sku: string, price: number, tax: string) =>
      bed.productService.create(actor, {
        name,
        categoryId: null,
        taxClassId: taxClassId(bed, tax),
        hsnCode: null,
        tracksInventory: true,
        variants: [variant({ sku, sellingPriceMinor: price, mrpMinor: null })]
      }).variants[0]!.variantId
    const riceId = make('Ponni Rice 5 kg', 'RICE', 32_000, 'GST 5%')
    const oilId = make('Gingelly Oil 1 L', 'OIL', 25_000, 'GST 18%')
    bed.inventoryService.adjust(actor, {
      reasonCode: 'opening_stock',
      notes: null,
      items: [
        { variantId: riceId, quantityDeltaMilli: 20_000 },
        { variantId: oilId, quantityDeltaMilli: 15_000 }
      ]
    })
    const methods = bed.paymentService.listMethods()
    const cashId = methods.find((m) => m.kind === 'cash')!.paymentMethodId
    const upiId = methods.find((m) => m.kind === 'upi')!.paymentMethodId
    const sale = bed.salesService.checkout(actor, {
      checkoutKey: 'seed-sale-1',
      lines: [
        { variantId: riceId, quantityMilli: 2000, unitPriceMinor: 32_000 },
        { variantId: oilId, quantityMilli: 1000, unitPriceMinor: 25_000 }
      ],
      billDiscount: { kind: 'amount', minor: 3000 },
      payments: [{ paymentMethodId: cashId, amountMinor: 86_000, tenderedMinor: 86_000 }]
    })
    return { bed, sale, riceId, oilId, cashId, upiId }
  }

  const onHand = (w: World, variantId: number): number | undefined =>
    w.bed.inventory.findVariantStock(variantId)?.onHandMilli

  const lineOf = (w: World, variantId: number) =>
    w.sale.lines.find((l) => l.variantId === variantId)!

  const take = (
    w: World,
    variantId: number,
    quantityMilli: number,
    disposition: ReturnInputLine['disposition'] = 'restock'
  ): ReturnInputLine => ({
    saleItemId: lineOf(w, variantId).saleItemId,
    quantityMilli,
    disposition
  })

  /** What the return screen shows as due: the same calculation the service uses. */
  function dueFor(w: World, lines: ReturnInputLine[]): number {
    const found = w.bed.returnService.findSale(w.bed.actor(), {
      invoiceNumber: w.sale.invoiceNumber
    })!
    return quoteReturn(
      found.lines.map((l) => ({
        saleItemId: l.saleItemId,
        soldMilli: l.soldMilli,
        netMinor: l.netMinor,
        taxes: l.taxes,
        priorReturnedMilli: l.returnedMilli
      })),
      lines,
      found.pricesIncludeTax
    ).refundDueMinor
  }

  const input = (
    w: World,
    lines: ReturnInputLine[],
    refunds: ReturnInput['refunds'],
    extra: Partial<ReturnInput> = {}
  ): ReturnInput => ({ saleId: w.sale.saleId, reason: null, lines, refunds, ...extra })

  /** Return `lines`, refunding exactly what is due in cash. */
  function refundInCash(w: World, lines: ReturnInputLine[], extra: Partial<ReturnInput> = {}) {
    return w.bed.returnService.create(
      w.bed.actor(),
      input(w, lines, [{ paymentMethodId: w.cashId, amountMinor: dueFor(w, lines) }], extra)
    )
  }

  describe('finding the invoice (M16-01)', () => {
    it('finds it by invoice number, with what can still come back and how it was paid', async () => {
      const w = await world()
      const found = w.bed.returnService.findSale(w.bed.actor(), { invoiceNumber: 'inv000001' })
      expect(found).toMatchObject({
        saleId: w.sale.saleId,
        invoiceNumber: 'INV000001',
        pricesIncludeTax: true,
        isVoided: false,
        returns: []
      })
      expect(found?.lines.map((l) => [l.description, l.soldMilli, l.returnableMilli])).toEqual([
        ['Ponni Rice 5 kg', 2000, 2000],
        ['Gingelly Oil 1 L', 1000, 1000]
      ])
      expect(found?.payments).toEqual([
        expect.objectContaining({ methodName: 'Cash', kind: 'cash', amountMinor: 86_000 })
      ])
      // A line's net is what the customer paid for it, bill discount included.
      expect(found!.lines.reduce((sum, l) => sum + l.netMinor, 0)).toBe(86_000)
    })

    it('says nothing is there for an unknown invoice', async () => {
      const w = await world()
      expect(w.bed.returnService.findSale(w.bed.actor(), { invoiceNumber: 'INV999999' })).toBeNull()
    })
  })

  describe('taking a return (M16-02 to M16-04)', () => {
    it('credits what was paid after discount, restocks, refunds, and leaves the sale alone', async () => {
      const w = await world()
      const actor = w.bed.actor()
      const before = w.bed.salesService.get(actor, w.sale.saleId)
      const lines = [take(w, w.riceId, 1000)]
      const due = dueFor(w, lines)

      w.bed.clock.time += 60_000
      const made = refundInCash(w, lines, { reason: 'Torn bag' })
      expect(made).toMatchObject({
        returnNumber: 'CN000001',
        invoiceNumber: 'INV000001',
        processedByName: 'Ravi Kumar',
        reason: 'Torn bag',
        refundDueMinor: due,
        refundedMinor: due
      })
      // One of two bags, from a line that carried part of the ₹30.00 discount.
      expect(due).toBeLessThan(32_000)
      expect(made.lines).toEqual([
        expect.objectContaining({
          description: 'Ponni Rice 5 kg',
          disposition: 'restock',
          quantityMilli: 1000
        })
      ])
      expect(made.refunds).toEqual([
        expect.objectContaining({ methodName: 'Cash', amountMinor: due })
      ])
      expect(made.taxSummary.reduce((sum, t) => sum + t.amountMinor, 0)).toBe(made.taxMinor)
      expect(made.taxMinor).toBeGreaterThan(0)

      // The bag is back on the shelf, and the ledger says why.
      expect(onHand(w, w.riceId)).toBe(20_000 - 2000 + 1000)
      expect(
        w.bed.inventoryService.movements(actor, { variantId: w.riceId }).items[0]
      ).toMatchObject({
        movementType: 'sale_return',
        quantityDeltaMilli: 1000,
        documentNumber: 'CN000001'
      })

      // The invoice itself is untouched, and now lists the refund.
      const after = w.bed.salesService.get(actor, w.sale.saleId)
      expect({ ...after, refunds: [] }).toEqual({ ...before, refunds: [] })
      expect(after.refunds).toEqual([
        expect.objectContaining({ returnNumber: 'CN000001', amountMinor: due })
      ])
      expect(w.bed.inventoryService.verifyLedgerConsistency().ok).toBe(true)
      expect(checkIntegrity(getDb(), 'quick').ok).toBe(true)
    })

    it('refunds exactly what was paid when every line is returned', async () => {
      const w = await world()
      const lines = [take(w, w.riceId, 2000), take(w, w.oilId, 1000)]
      const made = refundInCash(w, lines)
      expect(made.refundDueMinor).toBe(86_000)
      expect(made.refundDueMinor).toBe(w.sale.grandTotalMinor - w.sale.roundOffMinor)
      expect(onHand(w, w.riceId)).toBe(20_000)
      expect(onHand(w, w.oilId)).toBe(15_000)
    })

    it('returns a line in parts, and the parts add up to what was paid', async () => {
      const w = await world()
      const first = refundInCash(w, [take(w, w.riceId, 1000)])
      const second = refundInCash(w, [take(w, w.riceId, 1000)])
      const riceNet = w.bed.returnService
        .findSale(w.bed.actor(), { invoiceNumber: 'INV000001' })!
        .lines.find((l) => l.variantId === w.riceId)!.netMinor
      expect(first.refundDueMinor + second.refundDueMinor).toBe(riceNet)
      expect(second.returnNumber).toBe('CN000002')
      const found = w.bed.returnService.findSale(w.bed.actor(), { invoiceNumber: 'INV000001' })!
      expect(found.lines.find((l) => l.variantId === w.riceId)?.returnableMilli).toBe(0)
      expect(found.returns.map((r) => r.returnNumber)).toEqual(['CN000002', 'CN000001'])
    })

    it('blocks returning more than was sold or already returned, and records nothing', async () => {
      const w = await world()
      const actor = w.bed.actor()
      refundInCash(w, [take(w, w.oilId, 1000)])

      const again = await rejection(() =>
        w.bed.returnService.create(
          actor,
          input(w, [take(w, w.oilId, 1000)], [{ paymentMethodId: w.cashId, amountMinor: 100 }])
        )
      )
      expect(again.code).toBe('VALIDATION_FAILED')
      expect(again.message).toContain('already been returned')

      const tooMany = await rejection(() =>
        w.bed.returnService.create(
          actor,
          input(w, [take(w, w.riceId, 3000)], [{ paymentMethodId: w.cashId, amountMinor: 100 }])
        )
      )
      expect(tooMany.code).toBe('VALIDATION_FAILED')
      expect(w.bed.returnService.list(actor).total).toBe(1)
      expect(onHand(w, w.riceId)).toBe(18_000)
    })

    it('puts only restocked goods back into stock', async () => {
      const w = await world()
      refundInCash(w, [take(w, w.riceId, 1000, 'quarantine'), take(w, w.oilId, 1000, 'write_off')])
      expect(onHand(w, w.riceId)).toBe(18_000)
      expect(onHand(w, w.oilId)).toBe(14_000)

      // A bag can be split: one back on the shelf, none for the other.
      const made = refundInCash(w, [take(w, w.riceId, 1000, 'restock')])
      expect(made.lines[0]?.disposition).toBe('restock')
      expect(onHand(w, w.riceId)).toBe(19_000)
      expect(w.bed.inventoryService.verifyLedgerConsistency().ok).toBe(true)
    })

    it('adds the same item and disposition together instead of failing', async () => {
      const w = await world()
      const made = refundInCash(w, [take(w, w.riceId, 1000), take(w, w.riceId, 1000)])
      expect(made.lines).toHaveLength(1)
      expect(made.lines[0]?.quantityMilli).toBe(2000)
      expect(onHand(w, w.riceId)).toBe(20_000)
    })

    it('needs whole numbers for an item sold in whole numbers', async () => {
      const w = await world()
      const error = await rejection(() =>
        w.bed.returnService.create(
          w.bed.actor(),
          input(w, [take(w, w.riceId, 500)], [{ paymentMethodId: w.cashId, amountMinor: 100 }])
        )
      )
      expect(error.code).toBe('VALIDATION_FAILED')
      expect(error.message).toContain('whole numbers')
    })

    it('cannot return a voided invoice', async () => {
      const w = await world()
      w.bed.salesService.voidSale(w.bed.actor(), {
        saleId: w.sale.saleId,
        reason: 'Customer cancelled'
      })
      expect(
        w.bed.returnService.findSale(w.bed.actor(), { invoiceNumber: 'INV000001' })?.isVoided
      ).toBe(true)
      const error = await rejection(() =>
        w.bed.returnService.create(
          w.bed.actor(),
          input(w, [take(w, w.riceId, 1000)], [{ paymentMethodId: w.cashId, amountMinor: 100 }])
        )
      )
      expect(error.code).toBe('CONFLICT')
      expect(error.message).toContain('voided')
    })
  })

  describe('refunds (M16-04)', () => {
    it('must add up to exactly what is due', async () => {
      const w = await world()
      const lines = [take(w, w.riceId, 1000)]
      const due = dueFor(w, lines)
      for (const amountMinor of [due - 1, due + 1]) {
        const error = await rejection(() =>
          w.bed.returnService.create(
            w.bed.actor(),
            input(w, lines, [{ paymentMethodId: w.cashId, amountMinor }])
          )
        )
        expect(error.code).toBe('VALIDATION_FAILED')
        expect(error.message).toContain('due back to the customer')
      }
      const none = await rejection(() =>
        w.bed.returnService.create(w.bed.actor(), input(w, lines, []))
      )
      expect(none.code).toBe('VALIDATION_FAILED')
      expect(w.bed.returnService.list(w.bed.actor()).total).toBe(0)
      expect(onHand(w, w.riceId)).toBe(18_000)
    })

    it('can be split across methods, with a UPI reference recorded', async () => {
      const w = await world()
      const lines = [take(w, w.riceId, 2000)]
      const due = dueFor(w, lines)
      const made = w.bed.returnService.create(
        w.bed.actor(),
        input(w, lines, [
          { paymentMethodId: w.cashId, amountMinor: 20_000 },
          { paymentMethodId: w.upiId, amountMinor: due - 20_000, reference: 'UTR-5521' }
        ])
      )
      expect(made.refunds.map((r) => [r.methodName, r.amountMinor, r.reference])).toEqual([
        ['Cash', 20_000, null],
        ['UPI', due - 20_000, 'UTR-5521']
      ])
      expect(made.refundedMinor).toBe(due)
    })

    it('uses an active method that exists', async () => {
      const w = await world()
      const lines = [take(w, w.riceId, 1000)]
      const due = dueFor(w, lines)
      const missing = await rejection(() =>
        w.bed.returnService.create(
          w.bed.actor(),
          input(w, lines, [{ paymentMethodId: 999, amountMinor: due }])
        )
      )
      expect(missing.code).toBe('VALIDATION_FAILED')

      w.bed.paymentService.setMethodActive(w.bed.actor(), {
        paymentMethodId: w.upiId,
        active: false
      })
      const archived = await rejection(() =>
        w.bed.returnService.create(
          w.bed.actor(),
          input(w, lines, [{ paymentMethodId: w.upiId, amountMinor: due }])
        )
      )
      expect(archived.message).toContain('archived')
    })

    it('adds the tax back when prices exclude tax', async () => {
      const bed = await setUpStore(getDb(), { ...TEST_STORE, pricesIncludeTax: false })
      const actor = bed.actor()
      const riceId = bed.productService.create(actor, {
        name: 'Ponni Rice 5 kg',
        categoryId: null,
        taxClassId: taxClassId(bed, 'GST 5%'),
        hsnCode: null,
        tracksInventory: true,
        variants: [variant({ sku: 'RICE', sellingPriceMinor: 32_000, mrpMinor: null })]
      }).variants[0]!.variantId
      const cashId = bed.paymentService
        .listMethods()
        .find((m) => m.kind === 'cash')!.paymentMethodId
      // 2 × ₹320.00 before 5% GST of ₹32.00 (CGST and SGST ₹16.00 each).
      const { saleId, saleItemIds } = insertSale(getDb(), {
        invoiceNumber: 'INV000001',
        cashierId: 1,
        pricesIncludeTax: false,
        lines: [
          {
            variantId: riceId,
            quantityMilli: 2000,
            unitPriceMinor: 32_000,
            taxes: [
              { code: 'CGST', rateBp: 250, amountMinor: 1600 },
              { code: 'SGST', rateBp: 250, amountMinor: 1600 }
            ]
          }
        ],
        payments: [{ methodCode: 'cash', amountMinor: 67_200 }]
      })

      const half = bed.returnService.create(actor, {
        saleId,
        reason: null,
        lines: [{ saleItemId: saleItemIds[0]!, quantityMilli: 1000, disposition: 'restock' }],
        refunds: [{ paymentMethodId: cashId, amountMinor: 33_600 }]
      })
      expect(half).toMatchObject({
        pricesIncludeTax: false,
        creditMinor: 32_000,
        taxMinor: 1600,
        refundDueMinor: 33_600
      })
      expect(half.taxSummary).toEqual([
        { code: 'CGST', rateBp: 250, amountMinor: 800 },
        { code: 'SGST', rateBp: 250, amountMinor: 800 }
      ])
      const rest = bed.returnService.create(actor, {
        saleId,
        reason: null,
        lines: [{ saleItemId: saleItemIds[0]!, quantityMilli: 1000, disposition: 'restock' }],
        refunds: [{ paymentMethodId: cashId, amountMinor: 33_600 }]
      })
      // Everything back: the whole ₹672.00 that was paid.
      expect(half.refundDueMinor + rest.refundDueMinor).toBe(67_200)
    })
  })

  describe('safety and audit (M16-06)', () => {
    it('saves nothing when any part fails, and a retry returns the goods once', async () => {
      const w = await world()
      const lines = [take(w, w.riceId, 1000)]
      const spy = vi.spyOn(w.bed.auditLog, 'change').mockImplementation((entry) => {
        if (entry.action === 'return.created') throw new Error('disk full')
      })
      await expect(Promise.resolve().then(() => refundInCash(w, lines))).rejects.toThrow(
        'disk full'
      )
      spy.mockRestore()

      expect(w.bed.returnService.list(w.bed.actor()).total).toBe(0)
      expect(onHand(w, w.riceId)).toBe(18_000)
      expect(w.bed.salesService.get(w.bed.actor(), w.sale.saleId).refunds).toEqual([])

      refundInCash(w, lines)
      expect(onHand(w, w.riceId)).toBe(19_000)
    })

    it('records who, what, how the goods were handled and how it was refunded', async () => {
      const w = await world()
      refundInCash(w, [take(w, w.riceId, 1000), take(w, w.oilId, 1000, 'write_off')], {
        reason: 'Damaged in transit'
      })
      const entry = w.bed.audit().findLast((e) => e.action === 'return.created')
      expect(entry?.user_id).toBe(1)
      expect(JSON.parse(entry?.details ?? '{}')).toMatchObject({
        returnNumber: 'CN000001',
        invoiceNumber: 'INV000001',
        reason: 'Damaged in transit',
        items: [
          { item: 'Ponni Rice 5 kg', quantity: '1 pcs', goods: 'Back into stock' },
          {
            item: 'Gingelly Oil 1 L',
            quantity: '1 pcs',
            goods: 'Write off (damaged or unsellable)'
          }
        ],
        refunds: [{ method: 'Cash' }]
      })
    })

    it('needs return.create: a cashier is refused, and the refusal can be approved by a manager', async () => {
      const w = await world()
      const lines = [take(w, w.riceId, 1000)]
      await w.bed.signInAs('cashier')
      const error = await rejection(() => refundInCash(w, lines))
      expect(error.code).toBe('FORBIDDEN')
      expect(error.details).toMatchObject({ permission: 'return.create' })

      await w.bed.signInAs('inventory_operator')
      expect((await rejection(() => refundInCash(w, lines))).code).toBe('FORBIDDEN')

      await w.bed.signInAs('manager')
      expect(refundInCash(w, lines).returnNumber).toBe('CN000001')
      expect(w.bed.returnService.list(w.bed.actor()).total).toBe(1)
    })

    it('lets a cashier look an invoice up and read returns, but not take one', async () => {
      const w = await world()
      refundInCash(w, [take(w, w.riceId, 1000)])
      await w.bed.signInAs('cashier')
      expect(
        w.bed.returnService.findSale(w.bed.actor(), { invoiceNumber: 'INV000001' })?.returns
      ).toHaveLength(1)
      expect(w.bed.returnService.list(w.bed.actor()).total).toBe(1)
      expect(w.bed.returnService.get(w.bed.actor(), { saleReturnId: 1 }).returnNumber).toBe(
        'CN000001'
      )
    })
  })

  describe('list and detail (M16-05)', () => {
    it('lists returns newest first, searchable by return or invoice number', async () => {
      const w = await world()
      refundInCash(w, [take(w, w.riceId, 1000)])
      refundInCash(w, [take(w, w.oilId, 1000)])
      const actor = w.bed.actor()
      const all = w.bed.returnService.list(actor)
      expect(all.items.map((r) => r.returnNumber)).toEqual(['CN000002', 'CN000001'])
      expect(all.items[0]).toMatchObject({
        invoiceNumber: 'INV000001',
        itemCount: 1,
        processedByName: 'Ravi Kumar'
      })
      expect(w.bed.returnService.list(actor, { search: 'CN000001' }).items).toHaveLength(1)
      expect(w.bed.returnService.list(actor, { search: 'inv000001' }).total).toBe(2)
      expect(w.bed.returnService.list(actor, { search: 'nothing' }).total).toBe(0)
      expect(w.bed.returnService.list(actor, { limit: 1, offset: 1 }).items[0]?.returnNumber).toBe(
        'CN000001'
      )
    })
  })

  describe('return receipt (M16-05)', () => {
    it('shows what was returned, the tax and the refund, on either paper width', async () => {
      const w = await world()
      const made = refundInCash(w, [take(w, w.riceId, 1000)], { reason: 'Torn bag' })
      const actor = w.bed.actor()
      const preview = w.bed.returnService.previewReceipt(actor, { saleReturnId: made.saleReturnId })
      const text = preview.lines.join('\n')
      expect(preview).toMatchObject({ returnNumber: 'CN000001', isReprint: false })
      expect(text).toContain('RETURN / CREDIT NOTE')
      expect(text).toContain('Return: CN000001')
      expect(text).toContain('Invoice: INV000001')
      expect(text).toContain('Ponni Rice 5 kg')
      expect(text).toContain('TOTAL REFUND')
      expect(text).toContain('Refunded: Cash')
      expect(text).toContain('Reason: Torn bag')
      expect(text).not.toContain('DUPLICATE')
      expect(preview.html).toContain('RETURN / CREDIT NOTE')
      for (const line of preview.lines) expect(line.length).toBeLessThanOrEqual(preview.columns)

      const reprint = w.bed.returnService.previewReceipt(actor, {
        saleReturnId: made.saleReturnId,
        isReprint: true
      })
      expect(reprint.lines.join('\n')).toContain('DUPLICATE / REPRINT')
    })

    it('prints, and audits a reprint, which a cashier needs a manager for', async () => {
      const w = await world()
      const made = refundInCash(w, [take(w, w.riceId, 1000)])
      const first = await w.bed.returnService.printReceipt(w.bed.actor(), {
        saleReturnId: made.saleReturnId
      })
      expect(first.printed).toBe(true)
      expect(w.bed.audit().some((e) => e.action === 'return.reprinted')).toBe(false)

      await w.bed.signInAs('cashier')
      // A cashier can print the receipt of the return just taken, but not a duplicate.
      expect(
        (await w.bed.returnService.printReceipt(w.bed.actor(), { saleReturnId: made.saleReturnId }))
          .printed
      ).toBe(true)
      const denied = await rejection(() =>
        w.bed.returnService.printReceipt(w.bed.actor(), {
          saleReturnId: made.saleReturnId,
          isReprint: true
        })
      )
      expect(denied.details).toMatchObject({ permission: 'sale.reprint', overridable: true })

      await w.bed.signInAs('manager')
      await w.bed.returnService.printReceipt(w.bed.actor(), {
        saleReturnId: made.saleReturnId,
        isReprint: true
      })
      expect(w.bed.audit().filter((e) => e.action === 'return.reprinted')).toHaveLength(1)
    })

    it('fails to print without losing the return', async () => {
      const w = await world()
      const made = refundInCash(w, [take(w, w.riceId, 1000)])
      const spy = vi
        .spyOn(w.bed.printingService, 'printDocument')
        .mockRejectedValue(new Error('printer offline'))
      await expect(
        w.bed.returnService.printReceipt(w.bed.actor(), { saleReturnId: made.saleReturnId })
      ).rejects.toThrow('printer offline')
      spy.mockRestore()
      expect(
        w.bed.returnService.get(w.bed.actor(), { saleReturnId: made.saleReturnId })
      ).toMatchObject({
        returnNumber: 'CN000001'
      })
    })
  })

  describe('very large returns', () => {
    it('takes back 60 lines at once, and the audit entry stays small', async () => {
      const w = await world()
      const actor = w.bed.actor()
      const variantIds = Array.from(
        { length: 60 },
        (_, n) =>
          w.bed.productService.create(actor, {
            name: `Bulk item number ${n + 1} with a reasonably long product name`,
            categoryId: null,
            taxClassId: taxClassId(w.bed, 'GST 5%'),
            hsnCode: null,
            tracksInventory: true,
            variants: [variant({ sku: `BULK-${n + 1}`, sellingPriceMinor: 1000, mrpMinor: null })]
          }).variants[0]!.variantId
      )
      const { saleId, saleItemIds } = insertSale(getDb(), {
        invoiceNumber: 'INV000050',
        cashierId: 1,
        completedAt: Date.UTC(2026, 9, 10),
        lines: variantIds.map((variantId) => ({
          variantId,
          quantityMilli: 1000,
          unitPriceMinor: 1000
        })),
        payments: [{ methodCode: 'cash', amountMinor: 60_000 }]
      })

      const made = w.bed.returnService.create(actor, {
        saleId,
        reason: null,
        lines: saleItemIds.map((saleItemId) => ({
          saleItemId,
          quantityMilli: 1000,
          disposition: 'restock' as const
        })),
        refunds: [{ paymentMethodId: w.cashId, amountMinor: 60_000 }]
      })
      expect(made.lines).toHaveLength(60)
      expect(made.refundDueMinor).toBe(60_000)

      const entry = w.bed.audit().findLast((e) => e.action === 'return.created')
      expect(entry?.details?.length ?? 0).toBeLessThan(8000)
      const details = JSON.parse(entry?.details ?? '{}')
      expect(details).toMatchObject({ itemCount: 60, moreItems: 45 })
      expect(details.items).toHaveLength(15)
    })
  })

  describe('original receipts (audit finding: unmarked originals)', () => {
    const MINUTE = 60_000

    it('audits each original print, and not a print that failed', async () => {
      const w = await world()
      const made = refundInCash(w, [take(w, w.riceId, 1000)])
      await w.bed.returnService.printReceipt(w.bed.actor(), { saleReturnId: made.saleReturnId })
      const printed = w.bed.audit().filter((e) => e.action === 'return.printed')
      expect(printed).toHaveLength(1)
      expect(printed[0]?.user_id).toBe(1)
      expect(JSON.parse(printed[0]?.details ?? '{}')).toMatchObject({ returnNumber: 'CN000001' })

      const spy = vi
        .spyOn(w.bed.printingService, 'printDocument')
        .mockRejectedValue(new Error('printer offline'))
      await expect(
        w.bed.returnService.printReceipt(w.bed.actor(), { saleReturnId: made.saleReturnId })
      ).rejects.toThrow('printer offline')
      spy.mockRestore()
      expect(w.bed.audit().filter((e) => e.action === 'return.printed')).toHaveLength(1)
    })

    it('still prints the original just inside the window', async () => {
      const w = await world()
      const made = refundInCash(w, [take(w, w.riceId, 1000)])
      w.bed.clock.time += 14 * MINUTE
      await w.bed.signInAs('cashier')
      const preview = w.bed.returnService.previewReceipt(w.bed.actor(), {
        saleReturnId: made.saleReturnId
      })
      expect(preview.isReprint).toBe(false)
      expect(
        (await w.bed.returnService.printReceipt(w.bed.actor(), { saleReturnId: made.saleReturnId }))
          .printed
      ).toBe(true)
    })

    it('makes any print after the window a duplicate that needs a manager', async () => {
      const w = await world()
      const made = refundInCash(w, [take(w, w.riceId, 1000)])
      w.bed.clock.time += 16 * MINUTE
      await w.bed.signInAs('cashier')

      // Asking for an "original" gets the duplicate, and a cashier is refused it.
      const preview = w.bed.returnService.previewReceipt(w.bed.actor(), {
        saleReturnId: made.saleReturnId
      })
      expect(preview.isReprint).toBe(true)
      expect(preview.lines.join('\n')).toContain('DUPLICATE / REPRINT')
      const denied = await rejection(() =>
        w.bed.returnService.printReceipt(w.bed.actor(), { saleReturnId: made.saleReturnId })
      )
      expect(denied.details).toMatchObject({ permission: 'sale.reprint', overridable: true })
      expect(w.bed.audit().some((e) => e.action === 'return.printed')).toBe(false)

      await w.bed.signInAs('manager')
      await w.bed.returnService.printReceipt(w.bed.actor(), { saleReturnId: made.saleReturnId })
      expect(w.bed.audit().filter((e) => e.action === 'return.reprinted')).toHaveLength(1)
      expect(w.bed.audit().some((e) => e.action === 'return.printed')).toBe(false)
    })
  })
})
