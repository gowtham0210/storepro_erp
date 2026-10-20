import type {
  CustomerInput,
  CustomerListFilter,
  CustomerListPage,
  CustomerPurchase,
  CustomerPurchasePage,
  CustomerSummary
} from '@shared/ipc/contract'
import type { SQLInputValue } from 'node:sqlite'
import { Repository } from '../db/repository'
import { likePattern } from '../db/search'

export const DEFAULT_CUSTOMER_PAGE_SIZE = 50

interface CustomerRow {
  customer_id: number
  name: string
  phone: string | null
  email: string | null
  address: string | null
  tax_registration_number: string | null
  archived_at: number | null
  sale_count: number
  last_purchase_at: number | null
}

const NOT_VOIDED = `NOT EXISTS (SELECT 1 FROM sale_voids v WHERE v.sale_id = s.sale_id)`

const CUSTOMER_SELECT = `SELECT c.*,
  (SELECT count(*) FROM sales s WHERE s.customer_id = c.customer_id AND ${NOT_VOIDED}) AS sale_count,
  (SELECT max(s.completed_at) FROM sales s
   WHERE s.customer_id = c.customer_id AND ${NOT_VOIDED}) AS last_purchase_at
  FROM customers c`

function toCustomer(row: CustomerRow): CustomerSummary {
  return {
    customerId: row.customer_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxRegistrationNumber: row.tax_registration_number,
    active: row.archived_at === null,
    saleCount: row.sale_count,
    lastPurchaseAt: row.last_purchase_at
  }
}

/** Customers (M17-01). Archived, never deleted, so past sales keep their customer. */
export class CustomerRepository extends Repository {
  list(filter: CustomerListFilter = {}): CustomerListPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    const status = filter.status ?? 'active'
    if (status === 'active') where.push('c.archived_at IS NULL')
    else if (status === 'archived') where.push('c.archived_at IS NOT NULL')

    const search = filter.search?.trim()
    if (search) {
      const clauses = [
        `c.name LIKE ? ESCAPE '\\'`,
        `c.email LIKE ? ESCAPE '\\'`,
        `c.tax_registration_number LIKE ? ESCAPE '\\'`
      ]
      params.push(likePattern(search), likePattern(search), likePattern(search))
      // Phones are stored without spaces or dashes, so match what was typed the same way.
      const digits = search.replace(/[\s\-().]/g, '')
      if (/^\+?\d+$/.test(digits)) {
        clauses.push(`c.phone LIKE ? ESCAPE '\\'`)
        params.push(likePattern(digits))
      }
      where.push(`(${clauses.join(' OR ')})`)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const total =
      this.db.get<{ n: number }>(`SELECT count(*) AS n FROM customers c ${whereSql}`, params)?.n ??
      0
    const rows = this.db.all<CustomerRow>(
      `${CUSTOMER_SELECT}
       ${whereSql}
       ORDER BY c.name COLLATE NOCASE, c.customer_id
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_CUSTOMER_PAGE_SIZE, filter.offset ?? 0]
    )
    return { total, items: rows.map(toCustomer) }
  }

  find(customerId: number): CustomerSummary | null {
    const row = this.db.get<CustomerRow>(`${CUSTOMER_SELECT} WHERE c.customer_id = ?`, [customerId])
    return row ? toCustomer(row) : null
  }

  findByPhone(phone: string): CustomerSummary | null {
    const row = this.db.get<CustomerRow>(`${CUSTOMER_SELECT} WHERE c.phone = ?`, [phone])
    return row ? toCustomer(row) : null
  }

  create(input: CustomerInput): number {
    return this.insertWithTimestamps('customers', {
      name: input.name,
      phone: input.phone,
      email: input.email,
      address: input.address,
      tax_registration_number: input.taxRegistrationNumber
    })
  }

  updateDetails(customerId: number, input: CustomerInput): void {
    this.update('customers', 'customer_id', customerId, {
      name: input.name,
      phone: input.phone,
      email: input.email,
      address: input.address,
      tax_registration_number: input.taxRegistrationNumber
    })
  }

  setActive(customerId: number, active: boolean): void {
    if (active) this.update('customers', 'customer_id', customerId, { archived_at: null })
    else this.archive('customers', 'customer_id', customerId)
  }

  /** M17-03: a customer's invoices, newest first, with what was refunded on each. */
  purchases(
    customerId: number,
    page: { offset?: number | undefined; limit?: number | undefined }
  ): Omit<CustomerPurchasePage, 'customerName'> {
    const returned = `(SELECT coalesce(sum(r.refund_due_minor), 0) FROM v_sale_return_totals r
                       WHERE r.sale_id = t.sale_id)`
    const totals = this.db.get<{ n: number; spent: number | null }>(
      `SELECT count(*) AS n,
              sum(CASE WHEN t.is_voided = 0 THEN t.grand_total_minor - ${returned} ELSE 0 END) AS spent
       FROM v_sale_totals t WHERE t.customer_id = ?`,
      [customerId]
    )
    const rows = this.db.all<{
      sale_id: number
      invoice_number: string
      completed_at: number
      line_count: number
      grand_total_minor: number
      returned_minor: number
      is_voided: number
    }>(
      `SELECT t.sale_id, t.invoice_number, t.completed_at, t.line_count, t.grand_total_minor,
              ${returned} AS returned_minor, t.is_voided
       FROM v_sale_totals t
       WHERE t.customer_id = ?
       ORDER BY t.completed_at DESC, t.sale_id DESC
       LIMIT ? OFFSET ?`,
      [customerId, page.limit ?? DEFAULT_CUSTOMER_PAGE_SIZE, page.offset ?? 0]
    )
    return {
      customerId,
      total: totals?.n ?? 0,
      totalSpentMinor: totals?.spent ?? 0,
      items: rows.map((row): CustomerPurchase => ({
        saleId: row.sale_id,
        invoiceNumber: row.invoice_number,
        completedAt: row.completed_at,
        lineCount: row.line_count,
        grandTotalMinor: row.grand_total_minor,
        returnedMinor: row.returned_minor,
        isVoided: row.is_voided === 1
      }))
    }
  }
}
