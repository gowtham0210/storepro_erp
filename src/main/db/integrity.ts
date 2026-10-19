import type { Database } from './database'

export type IntegrityMode = 'quick' | 'full'

export interface ForeignKeyViolation {
  table: string
  rowid: number | null
  parent: string
}

export interface IntegrityReport {
  ok: boolean
  mode: IntegrityMode
  /** Problems reported by SQLite's own page/index checks. */
  storageProblems: string[]
  foreignKeyViolations: ForeignKeyViolation[]
  /** Business invariants the schema cannot express as constraints. */
  consistencyViolations: { check: string; count: number }[]
  durationMs: number
}

/**
 * Invariants that hold across rows and are kept by the application services
 * (checkout, returns) rather than by constraints. Each query counts violating rows.
 */
const CONSISTENCY_CHECKS: readonly { name: string; sql: string }[] = [
  {
    name: 'sale_without_items',
    sql: `SELECT count(*) AS n FROM sales s
          WHERE NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.sale_id)`
  },
  {
    name: 'sale_payments_do_not_match_total',
    sql: `SELECT count(*) AS n FROM v_sale_totals WHERE paid_minor <> grand_total_minor`
  },
  {
    name: 'return_without_items',
    sql: `SELECT count(*) AS n FROM sale_returns r
          WHERE NOT EXISTS (SELECT 1 FROM sale_return_items i WHERE i.sale_return_id = r.sale_return_id)`
  },
  {
    name: 'refunds_exceed_amount_due',
    sql: `SELECT count(*) AS n FROM v_sale_return_totals WHERE refunded_minor > refund_due_minor`
  },
  {
    name: 'returned_quantity_exceeds_sold',
    sql: `SELECT count(*) AS n FROM sale_items si
          WHERE (SELECT coalesce(sum(quantity_milli), 0) FROM sale_return_items r
                 WHERE r.sale_item_id = si.sale_item_id) > si.quantity_milli`
  },
  {
    name: 'stock_adjustment_without_items',
    sql: `SELECT count(*) AS n FROM stock_adjustments a
          WHERE NOT EXISTS (SELECT 1 FROM stock_adjustment_items i
                            WHERE i.stock_adjustment_id = a.stock_adjustment_id)`
  }
]

/**
 * Check the database. `quick` (run at startup after an unclean shutdown) skips
 * the slow index-content verification; `full` is for maintenance and backups.
 */
export function checkIntegrity(db: Database, mode: IntegrityMode): IntegrityReport {
  const started = Date.now()
  const pragma = mode === 'quick' ? 'quick_check' : 'integrity_check'
  const storageProblems = db
    .all<Record<string, string>>(`PRAGMA ${pragma}(100)`)
    .map((row) => Object.values(row)[0] ?? '')
    .filter((message) => message !== 'ok')

  if (mode === 'full') {
    try {
      db.exec(`INSERT INTO variant_search (variant_search) VALUES ('integrity-check')`)
    } catch (error) {
      storageProblems.push(`variant_search: ${String(error)}`)
    }
  }

  const foreignKeyViolations = db
    .all<{ table: string; rowid: number | null; parent: string }>('PRAGMA foreign_key_check')
    .map(({ table, rowid, parent }) => ({ table, rowid, parent }))

  // Business checks need a readable schema; skip them if storage is damaged.
  const consistencyViolations =
    storageProblems.length > 0
      ? []
      : CONSISTENCY_CHECKS.map(({ name, sql }) => ({
          check: name,
          count: db.get<{ n: number }>(sql)?.n ?? 0
        })).filter(({ count }) => count > 0)

  return {
    ok:
      storageProblems.length === 0 &&
      foreignKeyViolations.length === 0 &&
      consistencyViolations.length === 0,
    mode,
    storageProblems,
    foreignKeyViolations,
    consistencyViolations,
    durationMs: Date.now() - started
  }
}
