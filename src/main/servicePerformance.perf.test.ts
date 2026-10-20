import { join } from 'node:path'
import { calculateBill } from '@shared/pricing'
import { PERMISSION_CODES } from '@shared/permissions'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from './auth/access'
import { createTestbed, type Testbed } from './auth/test/testbed'
import { Database } from './db/database'
import { seedPerfData, type SeedSummary } from './db/dev/seedPerfData'
import { migrate } from './db/migrator'
import { migrations } from './db/migrations'
import { fixedClock } from './db/test/testDb'
import { createTestLogger, useTempDir } from './test/helpers'

/**
 * M30-08: the PRD §11 targets measured through the services the screens call,
 * not just through SQL (src/main/db/performance.perf.test.ts does that): the
 * barcode scan and the search box, a checkout with pricing, stock, payment and
 * audit checks, and the M19 reports and their CSV export. 10,000 products and a
 * month of trading, 1,500 bills a day. Run with `npm run test:perf`.
 *
 * The first three targets are the PRD's. The report targets are provisional, to
 * be settled with the catalogue and store size targets (open question in
 * docs/planning/MVP_TASKS.md); they are what a manager waiting at a screen
 * would tolerate. All apply to the reference hardware.
 */
const results: { measurement: string; ms: string; target: string }[] = []

function time<T>(fn: () => T): { value: T; ms: number } {
  const started = performance.now()
  const value = fn()
  return { value, ms: performance.now() - started }
}

async function timeAsync<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now()
  const value = await fn()
  return { value, ms: performance.now() - started }
}

const worstOf = (runs: number, fn: (i: number) => unknown): number => {
  let worst = 0
  for (let i = 0; i < runs; i++) worst = Math.max(worst, time(() => fn(i)).ms)
  return worst
}

describe('service performance (10,000 products, 30 days)', () => {
  const tempDir = useTempDir()
  let db: Database
  let bed: Testbed
  let summary: SeedSummary
  let actor: Actor

  beforeAll(() => {
    db = Database.open(join(tempDir(), 'perf.db'))
    migrate(db, migrations, {
      appVersion: 'perf',
      backupDir: null,
      clock: fixedClock,
      logger: createTestLogger()
    })
    summary = seedPerfData(db, { products: 10_000, days: 30, salesPerDay: 1500 })
    bed = createTestbed(db)
    actor = {
      userId: 1,
      username: 'cashier1',
      displayName: 'cashier1',
      roleCode: 'administrator',
      permissions: new Set(PERMISSION_CODES),
      override: null
    }
  }, 600_000)

  afterAll(() => {
    db?.close()
    console.table(results)
  })

  function record(measurement: string, ms: number, targetMs: number): void {
    results.push({ measurement, ms: ms.toFixed(2), target: `< ${targetMs}` })
    expect(ms).toBeLessThan(targetMs)
  }

  it('finds an item by barcode through the product service in under 100 ms', () => {
    const lookup = (i: number) =>
      bed.productService.findByBarcode(actor, {
        barcode: summary.barcodes[(i * 7919) % summary.barcodes.length]!
      })
    expect(lookup(0)).not.toBeNull()
    record('barcode scan, product service (worst of 1000)', worstOf(1000, lookup), 100)
  })

  it('searches the catalogue through the product service in under 300 ms', () => {
    const terms = ['b', 'ba', 'bas', 'toor dal', 'sugar', 'SKU-123', '8901000000', 'c']
    expect(
      bed.productService.search(actor, { query: 'basmati', limit: 50 }).length
    ).toBeGreaterThan(0)
    record(
      'search box, product service (worst of 8 terms)',
      worstOf(terms.length, (i) =>
        bed.productService.search(actor, { query: terms[i]!, limit: 50 })
      ),
      300
    )
  })

  it('checks out a typical bill through the sales service in under 500 ms', () => {
    const rules = bed.pricingService.rules()
    const variantIds = Array.from({ length: 5 }, (_, i) => 100 + i * 37)
    const worst = worstOf(20, (n) => {
      const lines = variantIds.map((variantId) => {
        const snapshot = bed.sales.findVariantForCheckout(variantId)!
        return {
          variantId,
          quantityMilli: snapshot.allowsFraction ? 1500 : 2000,
          unitPriceMinor: snapshot.sellingPriceMinor,
          tax: { rateBp: snapshot.rateBp, cessRateBp: snapshot.cessRateBp }
        }
      })
      const { payableMinor } = calculateBill(
        {
          lines: lines.map((l) => ({
            quantityMilli: l.quantityMilli,
            unitPriceMinor: l.unitPriceMinor,
            discount: null,
            tax: l.tax
          })),
          billDiscount: null
        },
        rules
      )
      const cash = bed.paymentService.listMethods().find((m) => m.kind === 'cash')!
      const sale = bed.salesService.checkout(actor, {
        checkoutKey: `perf-checkout-${n}`,
        lines: lines.map(({ variantId: id, quantityMilli, unitPriceMinor }) => ({
          variantId: id,
          quantityMilli,
          unitPriceMinor
        })),
        payments: [{ paymentMethodId: cash.paymentMethodId, amountMinor: payableMinor }]
      })
      expect(sale.lines).toHaveLength(5)
    })
    record('5-line checkout, sales service (worst of 20)', worst, 500)
  })

  const MONTH = { from: '2026-10-01', to: '2026-10-30' }

  it('builds the monthly sales report in under 2 s', () => {
    const { value, ms } = time(() => bed.reportService.sales(actor, MONTH))
    expect(value.days.length).toBeGreaterThanOrEqual(30)
    expect(value.summary.billCount).toBeGreaterThanOrEqual(summary.sales)
    record(`sales report, 30 days (${summary.sales} bills)`, ms, 2000)
  })

  it('ranks the top products for the month in under 2 s', () => {
    const { value, ms } = time(() =>
      bed.reportService.topProducts(actor, { ...MONTH, rankBy: 'value', limit: 50 })
    )
    expect(value.items).toHaveLength(50)
    record('top 50 products by value, 30 days', ms, 2000)
  })

  it('builds the stock report for the whole catalogue in under 3 s', () => {
    const { value, ms } = time(() => bed.reportService.stock(actor, {}))
    expect(value.items.length).toBeGreaterThan(0)
    record(`stock report (${summary.variants} variants)`, ms, 3000)
  })

  it('exports the monthly sales report as CSV in under 3 s', async () => {
    const { value, ms } = await timeAsync(() =>
      bed.reportService.exportReport(actor, { report: 'sales', ...MONTH })
    )
    expect(value.status).toBe('saved')
    record('sales CSV export, 30 days', ms, 3000)
  })
})
