import { TEST_STORE } from '@shared/test/stores'
import { describe, expect, it } from 'vitest'
import type { SaleDetail } from '@shared/ipc/contract'
import { parseCsv } from '@shared/csv'
import { reportExportSchema, reportRangeSchema, topProductsSchema } from '@shared/schemas/reports'
import { insertProduct, insertSale } from '../db/dev/builders'
import { useMigratedDb } from '../db/test/testDb'
import { rejection, setUpStore, taxClassId, variant } from '../test/store'

type Bed = Awaited<ReturnType<typeof setUpStore>>

/** Store-local midnight in Asia/Kolkata (UTC+5:30) is 18:30 UTC the evening before. */
const IST = (y: number, m: number, d: number, hh = 0, mm = 0): number =>
  Date.UTC(y, m - 1, d, hh, mm) - (5 * 60 + 30) * 60_000

describe('ReportService (M19)', () => {
  const getDb = useMigratedDb()

  interface World {
    bed: Bed
    riceId: number
    oilId: number
    cashId: number
    upiId: number
  }

  async function world(store = TEST_STORE): Promise<World> {
    const bed = await setUpStore(getDb(), store)
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
        { variantId: riceId, quantityDeltaMilli: 500_000 },
        { variantId: oilId, quantityDeltaMilli: 500_000 }
      ]
    })
    const methods = bed.paymentService.listMethods()
    return {
      bed,
      riceId,
      oilId,
      cashId: methods.find((m) => m.kind === 'cash')!.paymentMethodId,
      upiId: methods.find((m) => m.kind === 'upi')!.paymentMethodId
    }
  }

  let counter = 0
  /** Bill rice and oil at a given instant, paid by one method; returns the saved invoice. */
  function sell(
    w: World,
    at: number,
    lines: { rice?: number; oil?: number; discount?: number },
    method: 'cash' | 'upi' = 'cash'
  ): SaleDetail {
    w.bed.clock.time = at
    const items = [
      ...(lines.rice
        ? [{ variantId: w.riceId, quantityMilli: lines.rice * 1000, unitPriceMinor: 32_000 }]
        : []),
      ...(lines.oil
        ? [{ variantId: w.oilId, quantityMilli: lines.oil * 1000, unitPriceMinor: 25_000 }]
        : [])
    ]
    const gross = (lines.rice ?? 0) * 32_000 + (lines.oil ?? 0) * 25_000
    const payable = gross - (lines.discount ?? 0)
    return w.bed.salesService.checkout(w.bed.actor(), {
      checkoutKey: `report-sale-${++counter}`,
      lines: items,
      ...(lines.discount
        ? { billDiscount: { kind: 'amount' as const, minor: lines.discount } }
        : {}),
      payments: [
        {
          paymentMethodId: method === 'cash' ? w.cashId : w.upiId,
          amountMinor: payable,
          ...(method === 'cash' ? { tenderedMinor: payable } : {})
        }
      ]
    })
  }

  function giveBack(w: World, sale: SaleDetail, at: number, variantId: number, qty: number) {
    w.bed.clock.time = at
    const facts = w.bed.returnService.findSale(w.bed.actor(), {
      invoiceNumber: sale.invoiceNumber
    })!
    const line = facts.lines.find((l) => l.variantId === variantId)!
    // The refund is what is due for these units: credit plus tax when prices exclude tax.
    const share = Math.round((line.netMinor * qty) / (line.soldMilli / 1000))
    return w.bed.returnService.create(w.bed.actor(), {
      saleId: sale.saleId,
      reason: null,
      lines: [{ saleItemId: line.saleItemId, quantityMilli: qty * 1000, disposition: 'restock' }],
      refunds: [{ paymentMethodId: w.cashId, amountMinor: share }]
    })
  }

  const report = (w: World, from: string, to: string) =>
    w.bed.reportService.sales(w.bed.actor(), { from, to })

  describe('sales for a period (M19-03, M19-04)', () => {
    it('adds up what the invoices say, line by line', async () => {
      const w = await world()
      const a = sell(w, IST(2026, 10, 19, 10), { rice: 2, oil: 1, discount: 3000 })
      const b = sell(w, IST(2026, 10, 19, 15), { oil: 3 }, 'upi')
      const c = sell(w, IST(2026, 10, 20, 9), { rice: 1 })
      const { summary } = report(w, '2026-10-19', '2026-10-20')
      const sum = (pick: (s: SaleDetail) => number) => [a, b, c].reduce((t, s) => t + pick(s), 0)

      expect(summary.billCount).toBe(3)
      expect(summary.grossMinor).toBe(sum((s) => s.grossMinor))
      expect(summary.discountMinor).toBe(sum((s) => s.discountMinor))
      expect(summary.taxMinor).toBe(sum((s) => s.taxMinor))
      expect(summary.roundOffMinor).toBe(sum((s) => s.roundOffMinor))
      expect(summary.billedMinor).toBe(sum((s) => s.grandTotalMinor))
      expect(summary.averageBillMinor).toBe(Math.round(summary.billedMinor / 3))
      // Nothing was refunded or voided, so billed equals net.
      expect(summary).toMatchObject({
        refundsMinor: 0,
        refundCount: 0,
        voidedCount: 0,
        netSalesMinor: summary.billedMinor
      })
    })

    it('reports collections by method, and they add up to what was billed', async () => {
      const w = await world()
      const a = sell(w, IST(2026, 10, 19, 10), { rice: 2 })
      const b = sell(w, IST(2026, 10, 19, 11), { oil: 1 }, 'upi')
      const { summary } = report(w, '2026-10-19', '2026-10-19')
      expect(summary.payments.map((p) => [p.methodName, p.collectedMinor])).toEqual([
        ['Cash', a.grandTotalMinor],
        ['UPI', b.grandTotalMinor]
      ])
      expect(summary.collectedMinor).toBe(summary.billedMinor)
      expect(summary.netCollectedMinor).toBe(summary.netSalesMinor)
    })

    it('puts each bill on the store’s day, not UTC’s', async () => {
      const w = await world()
      // 23:59 and 00:01 at the store: one minute apart, but different days.
      sell(w, IST(2026, 10, 18, 23, 59), { rice: 1 })
      sell(w, IST(2026, 10, 19, 0, 1), { rice: 1 })
      const both = report(w, '2026-10-18', '2026-10-19')
      expect(both.days.map((d) => [d.date, d.billCount])).toEqual([
        ['2026-10-18', 1],
        ['2026-10-19', 1]
      ])
      expect(report(w, '2026-10-19', '2026-10-19').summary.billCount).toBe(1)
      expect(report(w, '2026-10-18', '2026-10-18').summary.billCount).toBe(1)
      // The very last and very first instants of a day.
      sell(w, IST(2026, 10, 21, 23, 59) + 59_999, { rice: 1 })
      sell(w, IST(2026, 10, 22, 0, 0), { rice: 1 })
      expect(report(w, '2026-10-21', '2026-10-21').summary.billCount).toBe(1)
      expect(report(w, '2026-10-22', '2026-10-22').summary.billCount).toBe(1)
    })

    it('lists every date in the range, with zeros for quiet days, and the days add up to the total', async () => {
      const w = await world()
      sell(w, IST(2026, 10, 19, 10), { rice: 2, discount: 1000 })
      sell(w, IST(2026, 10, 21, 10), { oil: 2 })
      const { days, summary } = report(w, '2026-10-19', '2026-10-22')
      expect(days.map((d) => d.date)).toEqual([
        '2026-10-19',
        '2026-10-20',
        '2026-10-21',
        '2026-10-22'
      ])
      expect(days[1]).toMatchObject({
        billCount: 0,
        grossMinor: 0,
        billedMinor: 0,
        netSalesMinor: 0
      })
      const total = (pick: (d: (typeof days)[number]) => number) =>
        days.reduce((t, d) => t + pick(d), 0)
      expect(total((d) => d.billCount)).toBe(summary.billCount)
      expect(total((d) => d.grossMinor)).toBe(summary.grossMinor)
      expect(total((d) => d.discountMinor)).toBe(summary.discountMinor)
      expect(total((d) => d.taxMinor)).toBe(summary.taxMinor)
      expect(total((d) => d.billedMinor)).toBe(summary.billedMinor)
      expect(total((d) => d.netSalesMinor)).toBe(summary.netSalesMinor)
    })

    it('gives a period with nothing in it as zeros, not an error', async () => {
      const w = await world()
      const { summary, days } = report(w, '2026-01-01', '2026-01-03')
      expect(days).toHaveLength(3)
      expect(summary).toMatchObject({
        billCount: 0,
        billedMinor: 0,
        averageBillMinor: 0,
        payments: []
      })
    })

    it('leaves out voided sales and shows them on their own line', async () => {
      const w = await world()
      const keep = sell(w, IST(2026, 10, 19, 10), { rice: 1 })
      const gone = sell(w, IST(2026, 10, 19, 11), { oil: 2 }, 'upi')
      w.bed.clock.time = IST(2026, 10, 20, 9)
      w.bed.salesService.voidSale(w.bed.actor(), { saleId: gone.saleId, reason: 'Wrong bill' })
      const { summary, days } = report(w, '2026-10-19', '2026-10-19')
      expect(summary).toMatchObject({
        billCount: 1,
        billedMinor: keep.grandTotalMinor,
        voidedCount: 1,
        voidedMinor: gone.grandTotalMinor
      })
      expect(summary.payments.map((p) => p.methodName)).toEqual(['Cash'])
      expect(days[0]?.billedMinor).toBe(keep.grandTotalMinor)
    })
  })

  describe('refunds (M19-02)', () => {
    it('counts a refund on the day of the return and takes it off net sales and collections', async () => {
      const w = await world()
      const sale = sell(w, IST(2026, 10, 19, 10), { rice: 2, oil: 1 })
      const made = giveBack(w, sale, IST(2026, 10, 21, 12), w.riceId, 1)
      expect(made.refundDueMinor).toBeGreaterThan(0)

      const week = report(w, '2026-10-19', '2026-10-21')
      expect(week.summary).toMatchObject({
        billedMinor: sale.grandTotalMinor,
        refundCount: 1,
        refundsMinor: made.refundDueMinor,
        refundedTaxMinor: made.taxMinor,
        netSalesMinor: sale.grandTotalMinor - made.refundDueMinor
      })
      // Money: all of it came in as cash, and the refund went out as cash.
      expect(week.summary.payments).toEqual([
        expect.objectContaining({
          methodName: 'Cash',
          collectedMinor: sale.grandTotalMinor,
          refundedMinor: made.refundDueMinor,
          netMinor: sale.grandTotalMinor - made.refundDueMinor
        })
      ])
      expect(week.summary.netCollectedMinor).toBe(week.summary.netSalesMinor)

      // The billing day keeps its figures; the return day carries the refund.
      expect(
        week.days.map((d) => [d.date, d.billedMinor, d.refundsMinor, d.netSalesMinor])
      ).toEqual([
        ['2026-10-19', sale.grandTotalMinor, 0, sale.grandTotalMinor],
        ['2026-10-20', 0, 0, 0],
        ['2026-10-21', 0, made.refundDueMinor, -made.refundDueMinor]
      ])
      // A period that holds only the return day shows the refund against no bills.
      expect(report(w, '2026-10-21', '2026-10-21').summary).toMatchObject({
        billCount: 0,
        refundsMinor: made.refundDueMinor,
        netSalesMinor: -made.refundDueMinor
      })
    })

    it('keeps a refund on a voided sale out, because the sale is out', async () => {
      const w = await world()
      const sale = sell(w, IST(2026, 10, 19, 10), { rice: 1 })
      w.bed.clock.time = IST(2026, 10, 19, 12)
      w.bed.salesService.voidSale(w.bed.actor(), { saleId: sale.saleId, reason: 'Duplicate' })
      const { summary } = report(w, '2026-10-19', '2026-10-19')
      expect(summary).toMatchObject({
        billCount: 0,
        billedMinor: 0,
        refundsMinor: 0,
        voidedCount: 1
      })
    })
  })

  describe('top products (M19-05)', () => {
    it('ranks by quantity or by value, net of returns, for the period only', async () => {
      const w = await world()
      const first = sell(w, IST(2026, 10, 19, 10), { rice: 5, oil: 2 })
      sell(w, IST(2026, 10, 20, 10), { rice: 1, oil: 4 })
      sell(w, IST(2026, 10, 25, 10), { rice: 100 }) // outside the period
      giveBack(w, first, IST(2026, 10, 20, 15), w.riceId, 4)

      const top = (rankBy: 'quantity' | 'value', limit?: number) =>
        w.bed.reportService.topProducts(w.bed.actor(), {
          from: '2026-10-19',
          to: '2026-10-20',
          rankBy,
          ...(limit ? { limit } : {})
        })

      // Rice: 6 sold, 4 came back = 2 net. Oil: 6 sold, none back = 6 net.
      const byQuantity = top('quantity')
      expect(
        byQuantity.items.map((i) => [i.name, i.soldMilli, i.returnedMilli, i.netMilli])
      ).toEqual([
        ['Gingelly Oil 1 L', 6000, 0, 6000],
        ['Ponni Rice 5 kg', 6000, 4000, 2000]
      ])
      // By value: oil is 6 × ₹250 = ₹1,500; rice 2 net bags of ₹320 is ₹640.
      const byValue = top('value')
      expect(byValue.items.map((i) => i.name)).toEqual(['Gingelly Oil 1 L', 'Ponni Rice 5 kg'])
      expect(byValue.items[0]?.netValueMinor).toBe(150_000)
      expect(byValue.items[1]).toMatchObject({
        soldValueMinor: 6 * 32_000,
        returnedValueMinor: 4 * 32_000,
        netValueMinor: 2 * 32_000
      })
      expect(top('value', 1).items).toHaveLength(1)
    })

    it('leaves out voided sales and items that were all returned', async () => {
      const w = await world()
      const kept = sell(w, IST(2026, 10, 19, 10), { oil: 1 })
      const voided = sell(w, IST(2026, 10, 19, 11), { rice: 3 })
      w.bed.clock.time = IST(2026, 10, 19, 12)
      w.bed.salesService.voidSale(w.bed.actor(), { saleId: voided.saleId, reason: 'Wrong bill' })
      giveBack(w, kept, IST(2026, 10, 19, 13), w.oilId, 1)
      const result = w.bed.reportService.topProducts(w.bed.actor(), {
        from: '2026-10-19',
        to: '2026-10-19',
        rankBy: 'quantity'
      })
      expect(result.items).toEqual([])
    })
  })

  describe('store time zones', () => {
    it('handles the 25-hour day when the clocks go back', async () => {
      const w = await world({ ...TEST_STORE, timeZone: 'Europe/London' })
      // 25 Oct 2026 in London has 25 hours: 00:00 BST to 24:00 GMT.
      sell(w, Date.UTC(2026, 9, 24, 23, 30), { rice: 1 }) // 00:30 BST, 25th
      sell(w, Date.UTC(2026, 9, 25, 1, 30), { rice: 1 }) // 01:30 GMT, 25th
      sell(w, Date.UTC(2026, 9, 25, 23, 59), { rice: 1 }) // 23:59 GMT, 25th
      sell(w, Date.UTC(2026, 9, 26, 0, 0), { rice: 1 }) // 00:00 GMT, 26th
      sell(w, Date.UTC(2026, 9, 24, 22, 59), { rice: 1 }) // 23:59 BST, 24th
      const { days } = report(w, '2026-10-24', '2026-10-26')
      expect(days.map((d) => [d.date, d.billCount])).toEqual([
        ['2026-10-24', 1],
        ['2026-10-25', 3],
        ['2026-10-26', 1]
      ])
    })
  })

  describe('who can run reports, and what they can ask for', () => {
    it('needs report.view', async () => {
      const w = await world()
      await w.bed.signInAs('cashier')
      expect((await rejection(() => report(w, '2026-10-19', '2026-10-19'))).code).toBe('FORBIDDEN')
      await w.bed.signInAs('manager')
      expect(report(w, '2026-10-19', '2026-10-19').summary.billCount).toBe(0)
    })

    it('refuses a backwards or oversized period, and a bad date', () => {
      expect(reportRangeSchema.safeParse({ from: '2026-10-20', to: '2026-10-19' }).success).toBe(
        false
      )
      expect(reportRangeSchema.safeParse({ from: '2026-10-19', to: '2026-10-19' }).success).toBe(
        true
      )
      expect(reportRangeSchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(
        false
      )
      expect(reportRangeSchema.safeParse({ from: '2024-01-01', to: '2026-01-01' }).success).toBe(
        false
      )
      expect(reportRangeSchema.safeParse({ from: '2025-01-01', to: '2026-12-31' }).success).toBe(
        true
      )
      expect(
        topProductsSchema.safeParse({ from: '2026-10-01', to: '2026-10-02', rankBy: 'profit' })
          .success
      ).toBe(false)
    })
  })

  describe('stock (M19-06)', () => {
    const stock = (w: World, filter = {}) => w.bed.reportService.stock(w.bed.actor(), filter)

    function addItem(
      w: World,
      sku: string,
      opts: {
        unitCode?: string
        cost: number | null
        reorder?: number
        onHand: number
        tracks?: boolean
      }
    ): number {
      const id = w.bed.productService.create(w.bed.actor(), {
        name: `Item ${sku}`,
        categoryId: null,
        taxClassId: taxClassId(w.bed, 'GST 5%'),
        hsnCode: null,
        tracksInventory: opts.tracks ?? true,
        variants: [
          variant({
            sku,
            unitCode: opts.unitCode ?? 'pcs',
            costPriceMinor: opts.cost,
            reorderLevelMilli: opts.reorder ?? null
          })
        ]
      }).variants[0]!.variantId
      if (opts.onHand !== 0 && (opts.tracks ?? true)) {
        w.bed.inventoryService.adjust(w.bed.actor(), {
          reasonCode: 'opening_stock',
          notes: null,
          items: [{ variantId: id, quantityDeltaMilli: opts.onHand }]
        })
      }
      return id
    }

    it('values stock at cost, rounding like an invoice line, and counts what is low or out', async () => {
      const w = await world()
      addItem(w, 'KG', { unitCode: 'kg', cost: 4833, onHand: 2500 }) // 2.5 × 48.33 = 120.825 → 120.83
      addItem(w, 'LOW', { cost: 1000, reorder: 10_000, onHand: 5000 }) // 5 pcs, reorder at 10
      addItem(w, 'OUT', { cost: 700, onHand: 0 })
      addItem(w, 'NOCOST', { cost: null, onHand: 3000 })
      addItem(w, 'BAG', { cost: 100, onHand: 0, tracks: false }) // not tracked: never listed

      const r = stock(w)
      const row = (sku: string) => r.items.find((i) => i.sku === sku)!
      expect(row('KG')).toMatchObject({
        onHandMilli: 2500,
        costPriceMinor: 4833,
        valueMinor: 12_083
      })
      expect(row('LOW')).toMatchObject({ valueMinor: 5000, isLow: true })
      expect(row('OUT')).toMatchObject({ onHandMilli: 0, valueMinor: null, isLow: true })
      expect(row('NOCOST')).toMatchObject({ valueMinor: null })
      expect(r.items.some((i) => i.sku === 'BAG')).toBe(false)

      // Rice and oil from the world hold 500 each at the default ₹38.00 cost.
      const worldValue = 2 * 500 * 3800
      expect(r.totals).toMatchObject({
        itemCount: 6,
        lowCount: 2,
        outCount: 1,
        valueMinor: worldValue + 12_083 + 5000,
        itemsWithoutCost: 1
      })
      expect(r.totals.valueMinor).toBe(r.items.reduce((sum, i) => sum + (i.valueMinor ?? 0), 0))
    })

    it('filters, searches and pages, while the totals describe everything that matches', async () => {
      const w = await world()
      addItem(w, 'LOW', { cost: 1000, reorder: 10_000, onHand: 5000 })
      addItem(w, 'OUT', { cost: 700, onHand: 0 })
      expect(
        stock(w, { level: 'low' })
          .items.map((i) => i.sku)
          .sort()
      ).toEqual(['LOW', 'OUT'])
      expect(stock(w, { level: 'out' }).items.map((i) => i.sku)).toEqual(['OUT'])
      expect(stock(w, { search: 'rice' }).items.map((i) => i.sku)).toEqual(['RICE'])
      expect(stock(w, { search: '***' }).items).toEqual([])
      const page = stock(w, { limit: 1, offset: 1 })
      expect(page.items).toHaveLength(1)
      expect(page.totals.itemCount).toBe(4)
    })

    it('leaves out archived items, and values nothing for negative stock', async () => {
      const w = await world()
      const id = addItem(w, 'ARCH', { cost: 1000, onHand: 4000 })
      const productId = w.bed.inventory.findVariantStock(id)!.productId
      w.bed.productService.setActive(w.bed.actor(), { productId, active: false })
      expect(stock(w).items.some((i) => i.sku === 'ARCH')).toBe(false)

      w.bed.storeService.update(w.bed.actor(), { ...TEST_STORE, allowNegativeStock: true })
      w.bed.inventoryService.adjust(w.bed.actor(), {
        reasonCode: 'damage',
        notes: null,
        items: [{ variantId: w.riceId, quantityDeltaMilli: -501_000 }]
      })
      const rice = stock(w).items.find((i) => i.sku === 'RICE')!
      expect(rice.onHandMilli).toBe(-1000)
      expect(rice.valueMinor).toBeNull()
    })
  })

  describe('stock movements (M19-06)', () => {
    it('lists every kind of movement in the period, newest first, on the store’s days', async () => {
      const w = await world()
      const sale = sell(w, IST(2026, 10, 19, 11), { rice: 2 })
      giveBack(w, sale, IST(2026, 10, 20, 10), w.riceId, 1)
      const all = w.bed.reportService.stockMovements(w.bed.actor(), {
        from: '2026-10-19',
        to: '2026-10-20'
      })
      // Newest first: the return, the sale, then the two opening-stock lines from set-up.
      expect(all.items.map((m) => [m.movementType, m.quantityDeltaMilli])).toEqual([
        ['sale_return', 1000],
        ['sale', -2000],
        ['adjustment', 500_000],
        ['adjustment', 500_000]
      ])
      expect(all.total).toBe(4)
      expect(all.items[0]?.documentNumber).toBe('CN000001')
      expect(all.items[1]?.documentNumber).toBe(sale.invoiceNumber)
      expect(all.items[1]).toMatchObject({ name: 'Ponni Rice 5 kg', sku: 'RICE', unitCode: 'pcs' })

      const onlyReturns = w.bed.reportService.stockMovements(w.bed.actor(), {
        from: '2026-10-19',
        to: '2026-10-20',
        movementType: 'sale_return'
      })
      expect(onlyReturns.total).toBe(1)
      // The 20th only holds the return.
      expect(
        w.bed.reportService
          .stockMovements(w.bed.actor(), { from: '2026-10-20', to: '2026-10-20' })
          .items.map((m) => m.movementType)
      ).toEqual(['sale_return'])
      const paged = w.bed.reportService.stockMovements(w.bed.actor(), {
        from: '2026-10-19',
        to: '2026-10-20',
        limit: 1,
        offset: 1
      })
      expect(paged.items.map((m) => m.movementType)).toEqual(['sale'])
      expect(paged.total).toBe(4)
    })
  })

  describe('purchases (M19-07)', () => {
    it('totals posted receipts by supplier and by day, and ignores drafts', async () => {
      const w = await world()
      const actor = w.bed.actor()
      const mk = (name: string) =>
        w.bed.supplierService.create(actor, {
          name,
          contactPerson: null,
          phone: null,
          email: null,
          address: null,
          taxRegistrationNumber: null
        }).supplierId
      const anand = mk('Anand Wholesale')
      const balaji = mk('Balaji Traders')
      const receive = (supplierId: number, at: number, qty: number, cost: number, post = true) => {
        w.bed.clock.time = at
        return w.bed.purchaseService.saveReceipt(actor, {
          supplierId,
          purchaseOrderId: null,
          supplierInvoiceNumber: null,
          supplierInvoiceDate: null,
          lines: [{ variantId: w.riceId, quantityMilli: qty, unitCostMinor: cost }],
          post
        })
      }
      const a1 = receive(anand, IST(2026, 10, 19, 10), 10_000, 3000)
      const a2 = receive(anand, IST(2026, 10, 20, 10), 3000, 4833)
      const b1 = receive(balaji, IST(2026, 10, 20, 11), 4000, 1000)
      receive(anand, IST(2026, 10, 20, 12), 9000, 9000, false) // draft
      receive(balaji, IST(2026, 10, 25, 12), 1000, 1000) // outside the period

      const report = w.bed.reportService.purchases(actor, { from: '2026-10-19', to: '2026-10-20' })
      expect(report.bySupplier.map((r) => [r.supplierName, r.receiptCount, r.totalMinor])).toEqual([
        ['Anand Wholesale', 2, a1.totalMinor + a2.totalMinor],
        ['Balaji Traders', 1, b1.totalMinor]
      ])
      expect(a2.totalMinor).toBe(14_499)
      expect(report.receiptCount).toBe(3)
      expect(report.totalMinor).toBe(a1.totalMinor + a2.totalMinor + b1.totalMinor)
      expect(report.receipts.map((r) => r.receiptNumber)).toEqual([
        b1.receiptNumber,
        a2.receiptNumber,
        a1.receiptNumber
      ])
      expect(report.receipts.reduce((sum, r) => sum + r.totalMinor, 0)).toBe(report.totalMinor)

      const one = w.bed.reportService.purchases(actor, {
        from: '2026-10-19',
        to: '2026-10-20',
        supplierId: balaji
      })
      expect(one).toMatchObject({ receiptCount: 1, totalMinor: b1.totalMinor })
      expect(one.receipts).toHaveLength(1)

      const day = w.bed.reportService.purchases(actor, { from: '2026-10-19', to: '2026-10-19' })
      expect(day.receiptCount).toBe(1)
      const paged = w.bed.reportService.purchases(actor, {
        from: '2026-10-19',
        to: '2026-10-20',
        limit: 1,
        offset: 2
      })
      expect(paged.receipts.map((r) => r.receiptNumber)).toEqual([a1.receiptNumber])
      expect(paged.receiptCount).toBe(3)
    })
  })

  describe('expenses (M19-08)', () => {
    it('totals expenses by category and payment method for the dates asked, voided ones apart', async () => {
      const w = await world()
      const actor = w.bed.actor()
      const categories = w.bed.expenseService.listCategories(actor)
      const rent = categories.find((c) => c.name === 'Rent')!.expenseCategoryId
      const power = categories.find((c) => c.name === 'Electricity')!.expenseCategoryId
      const add = (categoryId: number, date: string, amountMinor: number, methodId = w.cashId) =>
        w.bed.expenseService.record(actor, {
          expenseCategoryId: categoryId,
          expenseDate: date,
          amountMinor,
          paymentMethodId: methodId,
          description: null
        })
      add(rent, '2026-10-01', 1_200_000)
      add(power, '2026-10-10', 450_050, w.upiId)
      add(power, '2026-10-31', 10_000)
      add(rent, '2026-11-01', 999_999) // outside
      const gone = add(rent, '2026-10-05', 70_000)
      w.bed.expenseService.setVoided(actor, { expenseId: gone.expenseId, voided: true })

      const report = w.bed.reportService.expenses(actor, { from: '2026-10-01', to: '2026-10-31' })
      expect(report).toMatchObject({
        count: 3,
        totalMinor: 1_200_000 + 450_050 + 10_000,
        voidedCount: 1,
        voidedMinor: 70_000
      })
      expect(report.byCategory.map((c) => [c.name, c.count, c.totalMinor])).toEqual([
        ['Rent', 1, 1_200_000],
        ['Electricity', 2, 460_050]
      ])
      expect(report.byMethod.map((m) => [m.methodName, m.count, m.totalMinor])).toEqual([
        ['Cash', 2, 1_210_000],
        ['UPI', 1, 450_050]
      ])
      expect(report.byCategory.reduce((sum, c) => sum + c.totalMinor, 0)).toBe(report.totalMinor)
      expect(report.byMethod.reduce((sum, m) => sum + m.totalMinor, 0)).toBe(report.totalMinor)
      // Both ends of the period are included, and nothing leaks across them.
      expect(
        w.bed.reportService.expenses(actor, { from: '2026-10-31', to: '2026-10-31' }).totalMinor
      ).toBe(10_000)
      expect(
        w.bed.reportService.expenses(actor, { from: '2026-12-01', to: '2026-12-31' })
      ).toMatchObject({ count: 0, totalMinor: 0, byCategory: [], byMethod: [] })
    })
  })

  describe('CSV export (M22-03)', () => {
    const dec = (minor: number) => (minor / 100).toFixed(2)
    const exportOf = async (
      w: World,
      request: Parameters<Bed['reportService']['exportReport']>[1]
    ) => {
      const result = await w.bed.reportService.exportReport(w.bed.actor(), request)
      const file = w.bed.savedFiles.at(-1)
      return { result, file, rows: file ? parseCsv(file.content) : [] }
    }
    const row = (rows: string[][], first: string) => rows.find((r) => r[0] === first)!

    it('writes the sales report so that its figures are the invoices’ own', async () => {
      const w = await world()
      const a = sell(w, IST(2026, 10, 19, 10), { rice: 2, oil: 1, discount: 3000 })
      const b = sell(w, IST(2026, 10, 20, 15), { oil: 3 }, 'upi')
      const refund = giveBack(w, a, IST(2026, 10, 20, 16), w.riceId, 1)

      const { result, file, rows } = await exportOf(w, {
        report: 'sales',
        from: '2026-10-19',
        to: '2026-10-20'
      })
      expect(result).toEqual({
        status: 'saved',
        fileName: 'sales_2026-10-19_to_2026-10-20.csv',
        rows: 2
      })
      expect(file?.content.startsWith('\uFEFF')).toBe(true)
      expect(rows[0]).toEqual([
        'Date',
        'Bills',
        'Gross sales',
        'Discounts',
        'Tax',
        'Billed total',
        'Refunds',
        'Net sales'
      ])

      const sum = (pick: (s: SaleDetail) => number) => pick(a) + pick(b)
      const total = row(rows, 'Total')
      expect(total).toEqual([
        'Total',
        '2',
        dec(sum((x) => x.grossMinor)),
        dec(sum((x) => x.discountMinor)),
        dec(sum((x) => x.taxMinor)),
        dec(sum((x) => x.grandTotalMinor)),
        dec(refund.refundDueMinor),
        dec(sum((x) => x.grandTotalMinor) - refund.refundDueMinor)
      ])
      // Each day's row, and the days add up to the total line.
      expect(row(rows, '2026-10-19')[5]).toBe(dec(a.grandTotalMinor))
      expect(row(rows, '2026-10-20').slice(6)).toEqual([
        dec(refund.refundDueMinor),
        dec(b.grandTotalMinor - refund.refundDueMinor)
      ])
      // The money table: collected minus paid back is net, and equals net sales.
      const paymentsTotal = rows.filter((r) => r[0] === 'Total')[1]!
      expect(paymentsTotal[3]).toBe(total[7])
      expect(row(rows, 'Cash')).toEqual([
        'Cash',
        dec(a.grandTotalMinor),
        dec(refund.refundDueMinor),
        dec(a.grandTotalMinor - refund.refundDueMinor)
      ])
    })

    it('matches what the screen shows for every other report', async () => {
      const w = await world()
      const actor = w.bed.actor()
      const sale = sell(w, IST(2026, 10, 19, 11), { rice: 3, oil: 2 })
      giveBack(w, sale, IST(2026, 10, 19, 12), w.oilId, 1)
      const period = { from: '2026-10-19', to: '2026-10-19' }

      // Top items.
      const top = w.bed.reportService.topProducts(actor, { ...period, rankBy: 'value' })
      const topCsv = await exportOf(w, { report: 'top-products', ...period, rankBy: 'value' })
      expect(topCsv.rows.slice(1).map((r) => [r[0], r[5], r[8]])).toEqual(
        top.items.map((i) => [i.name, String(i.netMilli / 1000), dec(i.netValueMinor)])
      )

      // Stock movements.
      const movements = w.bed.reportService.stockMovements(actor, period)
      const movementsCsv = await exportOf(w, { report: 'stock-movements', ...period })
      expect(movementsCsv.rows.length - 1).toBe(movements.total)
      expect(movementsCsv.rows[1]?.[7]).toBe(movements.items[0]?.documentNumber)

      // Expenses.
      const rent = w.bed.expenseService.listCategories(actor).find((c) => c.name === 'Rent')!
      w.bed.expenseService.record(actor, {
        expenseCategoryId: rent.expenseCategoryId,
        expenseDate: '2026-10-19',
        amountMinor: 1_200_050,
        paymentMethodId: w.cashId,
        description: null
      })
      const expenses = w.bed.reportService.expenses(actor, period)
      const expensesCsv = await exportOf(w, { report: 'expenses', ...period })
      expect(row(expensesCsv.rows, 'Rent')).toEqual(['Rent', '1', dec(1_200_050)])
      expect(expensesCsv.rows.filter((r) => r[0] === 'Total').map((r) => r[2])).toEqual([
        dec(expenses.totalMinor),
        dec(expenses.totalMinor)
      ])

      // Purchases.
      const supplierId = w.bed.supplierService.create(actor, {
        name: 'Anand Wholesale',
        contactPerson: null,
        phone: null,
        email: null,
        address: null,
        taxRegistrationNumber: null
      }).supplierId
      w.bed.clock.time = IST(2026, 10, 19, 14)
      w.bed.purchaseService.saveReceipt(actor, {
        supplierId,
        purchaseOrderId: null,
        supplierInvoiceNumber: 'AW-1',
        supplierInvoiceDate: null,
        lines: [{ variantId: w.riceId, quantityMilli: 10_000, unitCostMinor: 3000 }],
        post: true
      })
      const purchases = w.bed.reportService.purchases(actor, period)
      const purchasesCsv = await exportOf(w, { report: 'purchases', ...period })
      expect(row(purchasesCsv.rows, 'Anand Wholesale')).toEqual([
        'Anand Wholesale',
        '1',
        dec(purchases.totalMinor)
      ])
      expect(row(purchasesCsv.rows, 'GRN000001')[6]).toBe(dec(purchases.receipts[0]!.totalMinor))
    })

    it('exports every stock row, not just the first page, and keeps names from being formulas', async () => {
      const w = await world()
      const actor = w.bed.actor()
      for (let n = 0; n < 130; n++) {
        w.bed.productService.create(actor, {
          name: n === 0 ? '=HYPERLINK("http://bad","x")' : `Bulk ${n}`,
          categoryId: null,
          taxClassId: taxClassId(w.bed, 'GST 5%'),
          hsnCode: null,
          tracksInventory: true,
          variants: [variant({ sku: `BULK-${n}`, costPriceMinor: 1000 })]
        })
      }
      const onScreen = w.bed.reportService.stock(actor, {})
      expect(onScreen.items).toHaveLength(100) // the screen shows a page
      const { rows, result } = await exportOf(w, { report: 'stock' })
      expect(rows.length - 2).toBe(132) // header, every item, total line
      expect(result).toMatchObject({ status: 'saved', rows: 132 })
      expect(rows.at(-1)?.[7]).toBe(dec(onScreen.totals.valueMinor))
      expect(rows.some((r) => r[0] === `'=HYPERLINK("http://bad","x")`)).toBe(true)
      expect(rows.some((r) => r[0]?.startsWith('='))).toBe(false)
    })

    it('writes every item sold, not just the first few thousand', async () => {
      const w = await world()
      const db = getDb()
      const gst5 = taxClassId(w.bed, 'GST 5%')
      const many = Array.from({ length: 5_001 }, (_, i) => {
        const { variantIds } = insertProduct(db, {
          name: `Loose item ${i + 1}`,
          taxClassId: gst5,
          variants: [{ sku: `LOOSE-${i + 1}`, priceMinor: 1000 + i }]
        })
        return variantIds[0]!
      })
      insertSale(db, {
        invoiceNumber: 'INV-MANY',
        cashierId: 1,
        completedAt: IST(2026, 10, 19, 11),
        lines: many.map((variantId, i) => ({
          variantId,
          quantityMilli: 1000,
          unitPriceMinor: 1000 + i
        })),
        payments: [
          { methodCode: 'cash', amountMinor: many.reduce((sum, _, i) => sum + 1000 + i, 0) }
        ]
      })

      const { result, rows } = await exportOf(w, {
        report: 'top-products',
        from: '2026-10-19',
        to: '2026-10-19',
        rankBy: 'quantity'
      })
      expect(result).toMatchObject({ status: 'saved', rows: 5_001 })
      expect(rows.some((r) => r.includes('LOOSE-5001'))).toBe(true)
    })

    it('writes nothing when the save dialog is closed', async () => {
      const w = await world()
      w.bed.fileDialog.cancelNextSave = true
      const result = await w.bed.reportService.exportReport(w.bed.actor(), {
        report: 'expenses',
        from: '2026-10-01',
        to: '2026-10-31'
      })
      expect(result).toEqual({ status: 'cancelled' })
      expect(w.bed.savedFiles).toHaveLength(0)
      expect(w.bed.audit().some((e) => e.action === 'report.exported')).toBe(false)
    })

    it('records who exported what, and needs both report and export permission', async () => {
      const w = await world()
      await exportOf(w, { report: 'expenses', from: '2026-10-01', to: '2026-10-31' })
      const entry = w.bed.audit().findLast((e) => e.action === 'report.exported')
      expect(entry?.user_id).toBe(1)
      expect(JSON.parse(entry?.details ?? '{}')).toMatchObject({
        report: 'Expenses',
        period: '2026-10-01 to 2026-10-31',
        file: 'expenses_2026-10-01_to_2026-10-31.csv'
      })

      for (const role of ['cashier', 'inventory_operator'] as const) {
        await w.bed.signInAs(role)
        const error = await rejection(() =>
          w.bed.reportService.exportReport(w.bed.actor(), {
            report: 'sales',
            from: '2026-10-01',
            to: '2026-10-02'
          })
        )
        expect(error.code, role).toBe('FORBIDDEN')
      }
      await w.bed.signInAs('manager')
      expect(
        (await exportOf(w, { report: 'sales', from: '2026-10-01', to: '2026-10-01' })).result
      ).toMatchObject({ status: 'saved', fileName: 'sales_2026-10-01.csv' })
    })

    it('checks the request like the screen does', () => {
      const bad = (request: unknown) => reportExportSchema.safeParse(request).success
      expect(bad({ report: 'sales', from: '2026-10-02', to: '2026-10-01' })).toBe(false)
      expect(bad({ report: 'top-products', from: '2026-10-01', to: '2026-10-02' })).toBe(false)
      expect(bad({ report: 'secrets', from: '2026-10-01', to: '2026-10-02' })).toBe(false)
      expect(bad({ report: 'stock' })).toBe(true)
      expect(
        bad({
          report: 'stock-movements',
          from: '2026-10-01',
          to: '2026-10-02',
          movementType: 'sale'
        })
      ).toBe(true)
    })
  })
})
