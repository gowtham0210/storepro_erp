import type { TaxClassSummary } from '@shared/ipc/contract'
import { defaultTaxClasses } from '@shared/tax'
import { Repository } from '../db/repository'

interface Row {
  tax_class_id: number
  name: string
  rate_bp: number
  cess_rate_bp: number
  archived_at: number | null
  product_count: number
}

function toSummary(row: Row): TaxClassSummary {
  return {
    taxClassId: row.tax_class_id,
    name: row.name,
    rateBp: row.rate_bp,
    cessRateBp: row.cess_rate_bp,
    active: row.archived_at === null,
    productCount: row.product_count
  }
}

const SELECT = `
  SELECT t.tax_class_id, t.name, t.rate_bp, t.cess_rate_bp, t.archived_at,
         (SELECT count(*) FROM products p WHERE p.tax_class_id = t.tax_class_id) AS product_count
  FROM tax_classes t`

/** Tax classes (M09, M10). The only code that writes `tax_classes`. */
export class TaxClassRepository extends Repository {
  list(): TaxClassSummary[] {
    return this.db
      .all<Row>(`${SELECT} ORDER BY t.archived_at IS NOT NULL, t.rate_bp, t.name`)
      .map(toSummary)
  }

  find(taxClassId: number): TaxClassSummary | null {
    const row = this.db.get<Row>(`${SELECT} WHERE t.tax_class_id = ?`, [taxClassId])
    return row ? toSummary(row) : null
  }

  findByName(name: string): TaxClassSummary | null {
    const row = this.db.get<Row>(`${SELECT} WHERE t.name = ? COLLATE NOCASE`, [name])
    return row ? toSummary(row) : null
  }

  /** The classes a new store starts with (src/shared/tax.ts). Does nothing if any exist. */
  seedDefaults(countryCode: string): void {
    if (this.db.get('SELECT 1 AS found FROM tax_classes LIMIT 1')) return
    for (const taxClass of defaultTaxClasses(countryCode)) {
      this.insertWithTimestamps('tax_classes', {
        name: taxClass.name,
        rate_bp: taxClass.rateBp,
        cess_rate_bp: taxClass.cessRateBp
      })
    }
  }

  create(input: { name: string; rateBp: number; cessRateBp: number }): number {
    return this.insertWithTimestamps('tax_classes', {
      name: input.name,
      rate_bp: input.rateBp,
      cess_rate_bp: input.cessRateBp
    })
  }

  updateClass(
    taxClassId: number,
    input: { name: string; rateBp: number; cessRateBp: number }
  ): void {
    this.update('tax_classes', 'tax_class_id', taxClassId, {
      name: input.name,
      rate_bp: input.rateBp,
      cess_rate_bp: input.cessRateBp
    })
  }

  setActive(taxClassId: number, active: boolean): void {
    if (active) this.update('tax_classes', 'tax_class_id', taxClassId, { archived_at: null })
    else this.archive('tax_classes', 'tax_class_id', taxClassId)
  }
}
