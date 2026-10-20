import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestLogger, useTempDir } from '../test/helpers'
import { Database } from './database'
import {
  BASE_TIME,
  insertBusiness,
  insertProduct,
  insertTaxClass,
  insertUser
} from './dev/builders'
import { checkIntegrity } from './integrity'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { fixedClock } from './test/testDb'

/**
 * M30-07: a real process is killed (SIGKILL, so no shutdown code runs, as in a power
 * cut or "End task") while it is part-way through recording a sale. The next start
 * must find either the whole sale or none of it, and a database that passes its checks.
 */

/**
 * The "till" that gets killed: it opens the store database with the production
 * settings and records one 2-line sale, then waits to be killed. With `commit` it
 * commits first and reports that it did; without, it reports being part-way
 * through, with everything written but not committed.
 */
const TILL_SCRIPT = `
import { DatabaseSync } from 'node:sqlite'
const [path, mode] = process.argv.slice(2)
const db = new DatabaseSync(path)
db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL')
const variants = db.prepare('SELECT variant_id FROM product_variants ORDER BY variant_id').all().map((r) => r.variant_id)
db.exec('BEGIN IMMEDIATE')
const saleId = Number(db.prepare(
  "INSERT INTO sales (invoice_number, checkout_key, completed_at, cashier_user_id, prices_include_tax) VALUES ('INV000001', 'crash-key', ?, 1, 1)"
).run(${BASE_TIME}).lastInsertRowid)
variants.slice(0, 2).forEach((variantId, i) => {
  db.prepare(
    "INSERT INTO sale_items (sale_id, line_number, variant_id, description, unit_code, quantity_milli, unit_price_minor) VALUES (?, ?, ?, 'item', 'pcs', 1000, 10000)"
  ).run(saleId, i + 1, variantId)
})
db.prepare(
  "INSERT INTO sale_payments (sale_id, payment_method_id, amount_minor) SELECT ?, payment_method_id, 20000 FROM payment_methods WHERE method_code = 'cash'"
).run(saleId)
if (mode === 'commit') db.exec('COMMIT')
console.log(mode === 'commit' ? 'COMMITTED' : 'WRITTEN')
setInterval(() => {}, 1000)
`

describe('crash recovery (M30-07)', () => {
  const tempDir = useTempDir()

  function createStore(): string {
    const path = join(tempDir(), 'storepro.db')
    const db = Database.open(path)
    migrate(db, migrations, {
      appVersion: 'test',
      backupDir: null,
      clock: fixedClock,
      logger: createTestLogger()
    })
    insertBusiness(db)
    insertUser(db, 'owner', 'administrator')
    const taxClassId = insertTaxClass(db, 'GST 5%', 500)
    insertProduct(db, {
      name: 'Tata Tea Gold',
      taxClassId,
      variants: [{ sku: 'TEA-1', priceMinor: 10_000, costMinor: 8000 }]
    })
    insertProduct(db, {
      name: 'Parle-G',
      taxClassId,
      variants: [{ sku: 'BISC-1', priceMinor: 10_000, costMinor: 8000 }]
    })
    db.close()
    return path
  }

  /** Run the till against the database, wait until it reports, then kill it without warning. */
  async function runAndKill(path: string, mode: 'commit' | 'uncommitted'): Promise<void> {
    const script = join(tempDir(), 'till.mjs')
    writeFileSync(script, TILL_SCRIPT)
    const child = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', script, path, mode],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += String(chunk)))
    const expected = mode === 'commit' ? 'COMMITTED' : 'WRITTEN'
    await new Promise<void>((resolve, reject) => {
      let out = ''
      child.stdout.on('data', (chunk) => {
        out += String(chunk)
        if (out.includes(expected)) resolve()
      })
      child.once('exit', () => reject(new Error(`The till exited early: ${stderr}`)))
    })
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGKILL')
    await exited
  }

  function count(db: Database, table: string): number {
    return db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)!.n
  }

  it('leaves no trace of a sale that was not yet committed', async () => {
    const path = createStore()
    await runAndKill(path, 'uncommitted')

    const db = Database.open(path)
    try {
      expect(count(db, 'sales')).toBe(0)
      expect(count(db, 'sale_items')).toBe(0)
      expect(count(db, 'sale_payments')).toBe(0)
      expect(checkIntegrity(db, 'full').ok).toBe(true)

      // The till is usable again, and the unused invoice number is not lost.
      db.run(
        `INSERT INTO sales (invoice_number, checkout_key, completed_at, cashier_user_id, prices_include_tax)
         VALUES ('INV000001', 'crash-key', ?, 1, 1)`,
        [BASE_TIME]
      )
      expect(count(db, 'sales')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('keeps a sale that was committed just before the kill, whole', async () => {
    const path = createStore()
    await runAndKill(path, 'commit')

    const db = Database.open(path)
    try {
      expect(count(db, 'sales')).toBe(1)
      expect(count(db, 'sale_items')).toBe(2)
      expect(count(db, 'sale_payments')).toBe(1)
      expect(
        db.get<{ n: number }>(
          `SELECT count(*) AS n FROM v_sale_totals WHERE paid_minor = grand_total_minor`
        )?.n
      ).toBe(1)
      const report = checkIntegrity(db, 'full')
      expect(report.ok).toBe(true)
      expect(report.consistencyViolations.filter((v) => v.count > 0)).toEqual([])
    } finally {
      db.close()
    }
  })
})
