import type {
  ReturnableLine,
  ReturnableSale,
  ReturnDetail,
  ReturnLineDetail,
  ReturnListFilter,
  ReturnListItem,
  ReturnListPage,
  ReturnSummary
} from '@shared/ipc/contract'
import type { PaymentKind } from '@shared/payments'
import type { ReturnableItemFacts, ReturnLineQuote, ReturnTaxShare } from '@shared/returns'
import type { SQLInputValue } from 'node:sqlite'
import type { Clock } from '../lib/clock'
import type { Database } from '../db/database'
import { Repository } from '../db/repository'
import { likePattern } from '../db/search'
import type { PaymentRepository } from '../payments/paymentRepository'

export const DEFAULT_RETURN_PAGE_SIZE = 50

interface LineRow {
  sale_item_id: number
  line_number: number
  variant_id: number
  description: string
  sku: string
  unit_code: string
  allows_fraction: number
  quantity_milli: number
  unit_price_minor: number
  net_minor: number
  returned_milli: number
}

interface TaxRow {
  sale_item_id: number
  tax_component_code: string
  rate_bp: number
  amount_minor: number
}

function toShare(row: TaxRow): ReturnTaxShare {
  return { code: row.tax_component_code, rateBp: row.rate_bp, amountMinor: row.amount_minor }
}

/**
 * Returns and refunds (M16): reads what an invoice sold and what has come back,
 * and writes the immutable return documents. Stock needs no write of its own:
 * the ledger view (`v_inventory_movements`) adds back the lines whose
 * disposition is `restock`, and ignores quarantined and written-off goods.
 */
export class ReturnRepository extends Repository {
  constructor(
    db: Database,
    clock: Clock,
    private readonly payments: PaymentRepository
  ) {
    super(db, clock)
  }

  findSaleId(invoiceNumber: string): number | null {
    return (
      this.db.get<{ sale_id: number }>(
        'SELECT sale_id FROM sales WHERE invoice_number = ? COLLATE NOCASE',
        [invoiceNumber.trim()]
      )?.sale_id ?? null
    )
  }

  /** The facts `quoteReturn` needs, line by line, in invoice order. */
  loadFacts(saleId: number): (ReturnableItemFacts & { line: ReturnableLine })[] {
    const lines = this.db.all<LineRow>(
      `SELECT si.sale_item_id, si.line_number, si.variant_id, si.description, v.sku, si.unit_code,
              u.allows_fraction, si.quantity_milli, si.unit_price_minor, a.net_minor,
              (SELECT coalesce(sum(ri.quantity_milli), 0) FROM sale_return_items ri
               WHERE ri.sale_item_id = si.sale_item_id) AS returned_milli
       FROM sale_items si
       JOIN v_sale_item_amounts a ON a.sale_item_id = si.sale_item_id
       JOIN product_variants v ON v.variant_id = si.variant_id
       JOIN units u ON u.unit_code = si.unit_code
       WHERE si.sale_id = ?
       ORDER BY si.line_number`,
      [saleId]
    )
    const taxes = this.db.all<TaxRow>(
      `SELECT t.sale_item_id, t.tax_component_code, t.rate_bp, t.amount_minor
       FROM sale_item_taxes t JOIN sale_items si ON si.sale_item_id = t.sale_item_id
       WHERE si.sale_id = ?
       ORDER BY t.sale_item_id, t.tax_component_code`,
      [saleId]
    )
    return lines.map((row) => {
      const itemTaxes = taxes.filter((t) => t.sale_item_id === row.sale_item_id).map(toShare)
      return {
        saleItemId: row.sale_item_id,
        soldMilli: row.quantity_milli,
        netMinor: row.net_minor,
        taxes: itemTaxes,
        priorReturnedMilli: row.returned_milli,
        line: {
          saleItemId: row.sale_item_id,
          lineNumber: row.line_number,
          variantId: row.variant_id,
          description: row.description,
          sku: row.sku,
          unitCode: row.unit_code,
          allowsFraction: row.allows_fraction === 1,
          soldMilli: row.quantity_milli,
          returnedMilli: row.returned_milli,
          returnableMilli: Math.max(0, row.quantity_milli - row.returned_milli),
          unitPriceMinor: row.unit_price_minor,
          netMinor: row.net_minor,
          taxes: itemTaxes
        }
      }
    })
  }

  getReturnableSale(saleId: number): ReturnableSale | null {
    const sale = this.db.get<{
      sale_id: number
      invoice_number: string
      completed_at: number
      prices_include_tax: number
      customer_name: string | null
      is_voided: number
    }>(
      `SELECT s.sale_id, s.invoice_number, s.completed_at, s.prices_include_tax,
              c.name AS customer_name,
              EXISTS (SELECT 1 FROM sale_voids v WHERE v.sale_id = s.sale_id) AS is_voided
       FROM sales s LEFT JOIN customers c ON c.customer_id = s.customer_id
       WHERE s.sale_id = ?`,
      [saleId]
    )
    if (!sale) return null
    const payments = this.db
      .all<{
        payment_method_id: number
        name: string
        kind: PaymentKind
        amount_minor: number
      }>(
        `SELECT p.payment_method_id, m.name, m.kind, p.amount_minor
         FROM sale_payments p JOIN payment_methods m ON m.payment_method_id = p.payment_method_id
         WHERE p.sale_id = ? ORDER BY p.sale_payment_id`,
        [saleId]
      )
      .map((row) => ({
        paymentMethodId: row.payment_method_id,
        methodName: row.name,
        kind: row.kind,
        amountMinor: row.amount_minor
      }))
    return {
      saleId: sale.sale_id,
      invoiceNumber: sale.invoice_number,
      completedAt: sale.completed_at,
      customerName: sale.customer_name,
      pricesIncludeTax: sale.prices_include_tax === 1,
      isVoided: sale.is_voided === 1,
      lines: this.loadFacts(saleId).map((facts) => facts.line),
      payments,
      returns: this.returnsForSale(saleId)
    }
  }

  returnsForSale(saleId: number): ReturnSummary[] {
    return this.db
      .all<{
        sale_return_id: number
        return_number: string
        returned_at: number
        refund_due_minor: number
      }>(
        `SELECT sale_return_id, return_number, returned_at, refund_due_minor
         FROM v_sale_return_totals WHERE sale_id = ?
         ORDER BY returned_at DESC, sale_return_id DESC`,
        [saleId]
      )
      .map((row) => ({
        saleReturnId: row.sale_return_id,
        returnNumber: row.return_number,
        returnedAt: row.returned_at,
        refundDueMinor: row.refund_due_minor
      }))
  }

  /** M16-04: the return, its lines, its tax and its refunds, as one record. Returns the new id. */
  create(input: {
    saleId: number
    userId: number
    reason: string | null
    lines: readonly ReturnLineQuote[]
    refunds: readonly { paymentMethodId: number; amountMinor: number; reference: string | null }[]
  }): number {
    const returnNumber = this.nextDocumentNumber(
      'sale_return',
      (candidate) =>
        this.db.get('SELECT 1 FROM sale_returns WHERE return_number = ?', [candidate]) !== undefined
    )
    const saleReturnId = this.insert('sale_returns', {
      return_number: returnNumber,
      sale_id: input.saleId,
      returned_at: this.now(),
      processed_by_user_id: input.userId,
      reason: input.reason
    })
    for (const line of input.lines) {
      const itemId = this.insert('sale_return_items', {
        sale_return_id: saleReturnId,
        sale_item_id: line.saleItemId,
        disposition: line.disposition,
        quantity_milli: line.quantityMilli,
        credit_amount_minor: line.creditMinor
      })
      for (const tax of line.taxes) {
        this.insert('sale_return_item_taxes', {
          sale_return_item_id: itemId,
          tax_component_code: tax.code,
          rate_bp: tax.rateBp,
          amount_minor: tax.amountMinor
        })
      }
    }
    this.payments.recordReturnRefunds(saleReturnId, input.refunds)
    return saleReturnId
  }

  get(saleReturnId: number): ReturnDetail | null {
    const header = this.db.get<{
      sale_return_id: number
      return_number: string
      sale_id: number
      invoice_number: string
      returned_at: number
      processed_by_name: string
      reason: string | null
      customer_name: string | null
      prices_include_tax: number
      refund_due_minor: number
      refunded_minor: number
    }>(
      `SELECT r.sale_return_id, r.return_number, r.sale_id, s.invoice_number, r.returned_at,
              u.display_name AS processed_by_name, r.reason, c.name AS customer_name,
              s.prices_include_tax, t.refund_due_minor, t.refunded_minor
       FROM sale_returns r
       JOIN sales s ON s.sale_id = r.sale_id
       JOIN users u ON u.user_id = r.processed_by_user_id
       LEFT JOIN customers c ON c.customer_id = s.customer_id
       JOIN v_sale_return_totals t ON t.sale_return_id = r.sale_return_id
       WHERE r.sale_return_id = ?`,
      [saleReturnId]
    )
    if (!header) return null
    const lines = this.db
      .all<{
        sale_return_item_id: number
        sale_item_id: number
        line_number: number
        description: string
        sku: string
        unit_code: string
        disposition: ReturnLineDetail['disposition']
        quantity_milli: number
        unit_price_minor: number
        credit_amount_minor: number
        tax_minor: number
      }>(
        `SELECT ri.sale_return_item_id, ri.sale_item_id, si.line_number, si.description, v.sku,
                si.unit_code, ri.disposition, ri.quantity_milli, si.unit_price_minor,
                ri.credit_amount_minor, a.tax_minor
         FROM sale_return_items ri
         JOIN sale_items si ON si.sale_item_id = ri.sale_item_id
         JOIN product_variants v ON v.variant_id = si.variant_id
         JOIN v_sale_return_item_amounts a ON a.sale_return_item_id = ri.sale_return_item_id
         WHERE ri.sale_return_id = ?
         ORDER BY si.line_number, ri.sale_return_item_id`,
        [saleReturnId]
      )
      .map((row): ReturnLineDetail => ({
        saleReturnItemId: row.sale_return_item_id,
        saleItemId: row.sale_item_id,
        lineNumber: row.line_number,
        description: row.description,
        sku: row.sku,
        unitCode: row.unit_code,
        disposition: row.disposition,
        quantityMilli: row.quantity_milli,
        unitPriceMinor: row.unit_price_minor,
        creditMinor: row.credit_amount_minor,
        taxMinor: row.tax_minor
      }))
    const taxSummary = this.db
      .all<{ tax_component_code: string; rate_bp: number; amount_minor: number }>(
        `SELECT t.tax_component_code, t.rate_bp, sum(t.amount_minor) AS amount_minor
         FROM sale_return_item_taxes t
         JOIN sale_return_items ri ON ri.sale_return_item_id = t.sale_return_item_id
         WHERE ri.sale_return_id = ?
         GROUP BY t.tax_component_code, t.rate_bp
         ORDER BY t.tax_component_code, t.rate_bp`,
        [saleReturnId]
      )
      .map((row): ReturnTaxShare => ({
        code: row.tax_component_code,
        rateBp: row.rate_bp,
        amountMinor: row.amount_minor
      }))
    return {
      saleReturnId: header.sale_return_id,
      returnNumber: header.return_number,
      saleId: header.sale_id,
      invoiceNumber: header.invoice_number,
      returnedAt: header.returned_at,
      processedByName: header.processed_by_name,
      reason: header.reason,
      customerName: header.customer_name,
      pricesIncludeTax: header.prices_include_tax === 1,
      lines,
      creditMinor: lines.reduce((sum, line) => sum + line.creditMinor, 0),
      taxMinor: lines.reduce((sum, line) => sum + line.taxMinor, 0),
      taxSummary,
      refundDueMinor: header.refund_due_minor,
      refundedMinor: header.refunded_minor,
      refunds: this.payments.listReturnRefunds(saleReturnId)
    }
  }

  list(filter: ReturnListFilter = {}): ReturnListPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    const search = filter.search?.trim()
    if (search) {
      const pattern = likePattern(search)
      where.push(
        `(r.return_number LIKE ? ESCAPE '\\' OR s.invoice_number LIKE ? ESCAPE '\\'
          OR c.name LIKE ? ESCAPE '\\')`
      )
      params.push(pattern, pattern, pattern)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const from = `FROM sale_returns r
      JOIN sales s ON s.sale_id = r.sale_id
      JOIN users u ON u.user_id = r.processed_by_user_id
      LEFT JOIN customers c ON c.customer_id = s.customer_id
      JOIN v_sale_return_totals t ON t.sale_return_id = r.sale_return_id`
    const total =
      this.db.get<{ n: number }>(`SELECT count(*) AS n ${from} ${whereSql}`, params)?.n ?? 0
    const rows = this.db.all<{
      sale_return_id: number
      return_number: string
      sale_id: number
      invoice_number: string
      returned_at: number
      processed_by_name: string
      customer_name: string | null
      item_count: number
      refund_due_minor: number
    }>(
      `SELECT r.sale_return_id, r.return_number, r.sale_id, s.invoice_number, r.returned_at,
              u.display_name AS processed_by_name, c.name AS customer_name,
              (SELECT count(*) FROM sale_return_items x
               WHERE x.sale_return_id = r.sale_return_id) AS item_count,
              t.refund_due_minor
       ${from}
       ${whereSql}
       ORDER BY r.returned_at DESC, r.sale_return_id DESC
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_RETURN_PAGE_SIZE, filter.offset ?? 0]
    )
    return {
      total,
      items: rows.map((row): ReturnListItem => ({
        saleReturnId: row.sale_return_id,
        returnNumber: row.return_number,
        saleId: row.sale_id,
        invoiceNumber: row.invoice_number,
        returnedAt: row.returned_at,
        processedByName: row.processed_by_name,
        customerName: row.customer_name,
        itemCount: row.item_count,
        refundDueMinor: row.refund_due_minor
      }))
    }
  }
}
