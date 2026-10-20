import type {
  SupplierInput,
  SupplierListFilter,
  SupplierListPage,
  SupplierSummary
} from '@shared/ipc/contract'
import type { SQLInputValue } from 'node:sqlite'
import { Repository } from '../db/repository'
import { likePattern } from '../db/search'

export const DEFAULT_SUPPLIER_PAGE_SIZE = 50

interface SupplierRow {
  supplier_id: number
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  tax_registration_number: string | null
  archived_at: number | null
  document_count: number
}

const DOCUMENT_COUNT = `(
  (SELECT count(*) FROM purchase_orders x WHERE x.supplier_id = s.supplier_id) +
  (SELECT count(*) FROM goods_receipts x WHERE x.supplier_id = s.supplier_id)
)`

function toSupplier(row: SupplierRow): SupplierSummary {
  return {
    supplierId: row.supplier_id,
    name: row.name,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxRegistrationNumber: row.tax_registration_number,
    active: row.archived_at === null,
    documentCount: row.document_count
  }
}

/** Suppliers (M15-01). Archived, never deleted, so past purchases keep their supplier. */
export class SupplierRepository extends Repository {
  list(filter: SupplierListFilter = {}): SupplierListPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    const status = filter.status ?? 'active'
    if (status === 'active') where.push('s.archived_at IS NULL')
    else if (status === 'archived') where.push('s.archived_at IS NOT NULL')

    const search = filter.search?.trim()
    if (search) {
      const pattern = likePattern(search)
      where.push(
        `(s.name LIKE ? ESCAPE '\\' OR s.contact_person LIKE ? ESCAPE '\\'
          OR s.phone LIKE ? ESCAPE '\\' OR s.tax_registration_number LIKE ? ESCAPE '\\')`
      )
      params.push(pattern, pattern, pattern, pattern)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const total =
      this.db.get<{ n: number }>(`SELECT count(*) AS n FROM suppliers s ${whereSql}`, params)?.n ??
      0
    const rows = this.db.all<SupplierRow>(
      `SELECT s.*, ${DOCUMENT_COUNT} AS document_count
       FROM suppliers s
       ${whereSql}
       ORDER BY s.name COLLATE NOCASE, s.supplier_id
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_SUPPLIER_PAGE_SIZE, filter.offset ?? 0]
    )
    return { total, items: rows.map(toSupplier) }
  }

  find(supplierId: number): SupplierSummary | null {
    const row = this.db.get<SupplierRow>(
      `SELECT s.*, ${DOCUMENT_COUNT} AS document_count FROM suppliers s WHERE s.supplier_id = ?`,
      [supplierId]
    )
    return row ? toSupplier(row) : null
  }

  findByName(name: string): SupplierSummary | null {
    const row = this.db.get<SupplierRow>(
      `SELECT s.*, ${DOCUMENT_COUNT} AS document_count
       FROM suppliers s WHERE s.name = ? COLLATE NOCASE`,
      [name]
    )
    return row ? toSupplier(row) : null
  }

  create(input: SupplierInput): number {
    return this.insertWithTimestamps('suppliers', {
      name: input.name,
      contact_person: input.contactPerson,
      phone: input.phone,
      email: input.email,
      address: input.address,
      tax_registration_number: input.taxRegistrationNumber
    })
  }

  updateDetails(supplierId: number, input: SupplierInput): void {
    this.update('suppliers', 'supplier_id', supplierId, {
      name: input.name,
      contact_person: input.contactPerson,
      phone: input.phone,
      email: input.email,
      address: input.address,
      tax_registration_number: input.taxRegistrationNumber
    })
  }

  setActive(supplierId: number, active: boolean): void {
    if (active) {
      this.update('suppliers', 'supplier_id', supplierId, { archived_at: null })
    } else {
      this.archive('suppliers', 'supplier_id', supplierId)
    }
  }
}
