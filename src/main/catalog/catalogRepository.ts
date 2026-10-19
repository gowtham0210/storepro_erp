import type { CategorySummary, UnitInfo } from '@shared/ipc/contract'
import { Repository } from '../db/repository'

interface CategoryRow {
  category_id: number
  name: string
  archived_at: number | null
  product_count: number
}

interface UnitRow {
  unit_code: string
  name: string
  allows_fraction: number
  in_use: number
}

const SELECT_CATEGORY = `
  SELECT c.category_id, c.name, c.archived_at,
         (SELECT count(*) FROM products p WHERE p.category_id = c.category_id) AS product_count
  FROM categories c`

const SELECT_UNIT = `
  SELECT u.unit_code, u.name, u.allows_fraction,
         EXISTS (SELECT 1 FROM product_variants v WHERE v.unit_code = u.unit_code) AS in_use
  FROM units u`

function toCategory(row: CategoryRow): CategorySummary {
  return {
    categoryId: row.category_id,
    name: row.name,
    active: row.archived_at === null,
    productCount: row.product_count
  }
}

function toUnit(row: UnitRow): UnitInfo {
  return {
    unitCode: row.unit_code,
    name: row.name,
    allowsFraction: row.allows_fraction === 1,
    inUse: row.in_use === 1
  }
}

/** Categories and units of measure (M09-01): the catalogue's reference data. */
export class CatalogRepository extends Repository {
  listCategories(): CategorySummary[] {
    return this.db
      .all<CategoryRow>(`${SELECT_CATEGORY} ORDER BY c.archived_at IS NOT NULL, c.name`)
      .map(toCategory)
  }

  findCategory(categoryId: number): CategorySummary | null {
    const row = this.db.get<CategoryRow>(`${SELECT_CATEGORY} WHERE c.category_id = ?`, [categoryId])
    return row ? toCategory(row) : null
  }

  /** Case-insensitive, like the UNIQUE constraint. */
  findCategoryByName(name: string): CategorySummary | null {
    const row = this.db.get<CategoryRow>(`${SELECT_CATEGORY} WHERE c.name = ? COLLATE NOCASE`, [
      name
    ])
    return row ? toCategory(row) : null
  }

  createCategory(name: string): number {
    return this.insertWithTimestamps('categories', { name })
  }

  renameCategory(categoryId: number, name: string): void {
    this.update('categories', 'category_id', categoryId, { name })
  }

  setCategoryActive(categoryId: number, active: boolean): void {
    if (active) this.update('categories', 'category_id', categoryId, { archived_at: null })
    else this.archive('categories', 'category_id', categoryId)
  }

  listUnits(): UnitInfo[] {
    return this.db.all<UnitRow>(`${SELECT_UNIT} ORDER BY u.rowid`).map(toUnit)
  }

  findUnit(unitCode: string): UnitInfo | null {
    const row = this.db.get<UnitRow>(`${SELECT_UNIT} WHERE u.unit_code = ?`, [unitCode])
    return row ? toUnit(row) : null
  }

  findUnitByName(name: string): UnitInfo | null {
    const row = this.db.get<UnitRow>(`${SELECT_UNIT} WHERE u.name = ? COLLATE NOCASE`, [name])
    return row ? toUnit(row) : null
  }

  /** Units have no timestamps: they are a lookup table keyed by their code. */
  createUnit(unit: { unitCode: string; name: string; allowsFraction: boolean }): void {
    this.insert('units', {
      unit_code: unit.unitCode,
      name: unit.name,
      allows_fraction: unit.allowsFraction ? 1 : 0
    })
  }

  renameUnit(unitCode: string, name: string): void {
    this.db.run('UPDATE units SET name = ? WHERE unit_code = ?', [name, unitCode])
  }
}
