import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestLogger, useTempDir } from '../test/helpers'
import { Database } from './database'
import { BASE_TIME, stockOnHand } from './dev/builders'
import { seedPerfData, type SeedSummary } from './dev/seedPerfData'
import { checkIntegrity } from './integrity'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { buildPrefixMatchQuery } from './search'
import { fixedClock } from './test/testDb'

/**
 * PRD §11 performance targets on a 10,000-product store with a month of
 * trading. Run with `npm run test:perf`. Times depend on the machine; the
 * targets apply to the reference hardware.
 */
const DAY_MS = 24 * 60 * 60 * 1000
const results: { measurement: string; ms: string; target: string }[] = []

function time<T>(fn: () => T): { value: T; ms: number } {
  const started = performance.now()
  const value = fn()
  return { value, ms: performance.now() - started }
}

function worstOf(runs: number, fn: (i: number) => unknown): number {
  let worst = 0
  for (let i = 0; i < runs; i++) worst = Math.max(worst, time(() => fn(i)).ms)
  return worst
}

describe('performance (10,000 products)', () => {
  const tempDir = useTempDir()
  let db: Database
  let summary: SeedSummary

  beforeAll(() => {
    db = Database.open(join(tempDir(), 'perf.db'))
    migrate(db, migrations, {
      appVersion: 'perf',
      backupDir: null,
      clock: fixedClock,
      logger: createTestLogger()
    })
    summary = seedPerfData(db, { products: 10_000, days: 30, salesPerDay: 1500 })
    results.push({
      measurement: `seed: ${summary.variants} variants, ${summary.sales} sales, ${summary.saleItems} lines`,
      ms: summary.durationMs.toFixed(0),
      target: '-'
    })
  }, 600_000)

  afterAll(() => {
    db?.close()
    console.table(results)
  })

  function record(measurement: string, ms: number, targetMs: number): void {
    results.push({ measurement, ms: ms.toFixed(2), target: `< ${targetMs}` })
    expect(ms).toBeLessThan(targetMs)
  }

  it('looks up a barcode in under 100 ms (warm)', () => {
    const lookup = (barcode: string) =>
      db.get(
        `SELECT v.variant_id, p.name, v.selling_price_minor, v.unit_code
         FROM barcodes b JOIN product_variants v ON v.variant_id = b.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE b.barcode = ? AND v.archived_at IS NULL`,
        [barcode]
      )
    lookup(summary.barcodes[0]!)
    record(
      'barcode lookup (worst of 1000)',
      worstOf(1000, (i) => lookup(summary.barcodes[(i * 7919) % summary.barcodes.length]!)),
      100
    )
  })

  it('searches products by name prefix in under 300 ms', () => {
    const search = (term: string) =>
      db.all(
        `SELECT v.variant_id, p.name, v.sku, v.selling_price_minor
         FROM variant_search s
         JOIN product_variants v ON v.variant_id = s.rowid
         JOIN products p ON p.product_id = v.product_id
         WHERE variant_search MATCH ? AND v.archived_at IS NULL
         ORDER BY rank LIMIT 50`,
        [buildPrefixMatchQuery(term)]
      )
    expect(search('basmati').length).toBeGreaterThan(0)
    const terms = ['b', 'ba', 'bas', 'toor dal', 'sugar', 'SKU-123', '8901000000', 'c']
    record(
      'name/SKU/barcode search, LIMIT 50 (worst of 8 terms)',
      worstOf(terms.length, (i) => search(terms[i]!)),
      300
    )
  })

  it('records a 5-line checkout in under 500 ms', () => {
    const variants = db.all<{ variant_id: number; selling_price_minor: number }>(
      'SELECT variant_id, selling_price_minor FROM product_variants LIMIT 5'
    )
    const { ms } = time(() =>
      db.transaction(() => {
        const saleId = db.run(
          `INSERT INTO sales (invoice_number, checkout_key, completed_at, cashier_user_id, prices_include_tax)
           VALUES ('INV-PERF', 'perf-key', ?, 1, 1)`,
          [BASE_TIME + 40 * DAY_MS]
        ).lastInsertRowid
        let total = 0
        variants.forEach((v, i) => {
          total += v.selling_price_minor
          db.run(
            `INSERT INTO sale_items (sale_id, line_number, variant_id, description, unit_code, quantity_milli, unit_price_minor)
             VALUES (?, ?, ?, 'item', 'pcs', 1000, ?)`,
            [saleId, i + 1, v.variant_id, v.selling_price_minor]
          )
          stockOnHand(db, v.variant_id) // negative-stock check per line
        })
        db.run(
          'INSERT INTO sale_payments (sale_id, payment_method_id, amount_minor) VALUES (?, 1, ?)',
          [saleId, total]
        )
      })
    )
    record('checkout transaction incl. stock checks', ms, 500)
  })

  it('computes stock for one variant quickly', () => {
    const ids = db.all<{ variant_id: number }>(
      'SELECT variant_id FROM product_variants ORDER BY variant_id LIMIT 200'
    )
    record(
      'stock on hand, one variant (worst of 200)',
      worstOf(ids.length, (i) => stockOnHand(db, ids[i]!.variant_id)),
      50
    )
  })

  it('builds a day sales report quickly', () => {
    const start = BASE_TIME + 10 * DAY_MS
    const { value, ms } = time(() =>
      db.get<{ bills: number; total: number }>(
        `SELECT count(*) AS bills, sum(grand_total_minor) AS total FROM v_sale_totals
         WHERE completed_at >= ? AND completed_at < ? AND is_voided = 0`,
        [start, start + DAY_MS]
      )
    )
    expect(value?.bills).toBe(1500)
    record('daily sales summary (1,500 bills)', ms, 1000)
  })

  it('lists stock for the whole catalogue', () => {
    const { value, ms } = time(() =>
      db.all('SELECT variant_id, on_hand_milli FROM v_stock_on_hand')
    )
    expect(value.length).toBe(summary.variants)
    record(`full stock list (${summary.variants} variants)`, ms, 3000)
  })

  it('passes a quick integrity check', () => {
    const { value, ms } = time(() => checkIntegrity(db, 'quick'))
    expect(value.ok).toBe(true)
    record('quick integrity check (startup after crash)', ms, 10_000)
  })
})
