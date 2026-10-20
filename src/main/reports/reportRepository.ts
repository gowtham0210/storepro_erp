import type {
  ExpenseCategoryTotal,
  ExpenseMethodTotal,
  MovementType,
  PurchaseReceiptRow,
  PurchaseSupplierRow,
  StockLevelFilter,
  StockMovementRow,
  StockReportRow,
  StockReportTotals,
  TopProductRank,
  TopProductRow
} from '@shared/ipc/contract'
import type { PaymentKind } from '@shared/payments'
import { Repository } from '../db/repository'
import { buildPrefixMatchQuery } from '../db/search'
import type { SQLInputValue } from 'node:sqlite'

/** Quantity × cost per receipt line, rounded half up exactly as `multiplyByQuantity` does. */
const RECEIPT_LINE_TOTAL = '((l.quantity_milli * l.unit_cost_minor * 2 + 1000) / 2000)'

/** Stock worth at cost: what is on hand (never negative) × the cost price, rounded the same way. */
const STOCK_VALUE =
  '(CASE WHEN s.on_hand_milli > 0 AND v.cost_price_minor IS NOT NULL ' +
  'THEN (s.on_hand_milli * v.cost_price_minor * 2 + 1000) / 2000 END)'

const LOW_STOCK =
  '(s.on_hand_milli <= 0 OR (v.reorder_level_milli IS NOT NULL AND s.on_hand_milli <= v.reorder_level_milli))'

/** Sums over finalised, non-voided sales in a period (see `src/shared/reports.ts`). */
export interface SalesTotals {
  billCount: number
  grossMinor: number
  discountMinor: number
  taxMinor: number
  roundOffMinor: number
  billedMinor: number
  voidedCount: number
  voidedMinor: number
}

export interface SaleFigures {
  completedAt: number
  grossMinor: number
  discountMinor: number
  taxMinor: number
  billedMinor: number
}

export interface ReturnFigures {
  returnedAt: number
  refundDueMinor: number
  taxMinor: number
}

export interface MethodMoney {
  paymentMethodId: number
  methodName: string
  kind: PaymentKind
  amountMinor: number
}

/**
 * Report queries (M19-01). Every period is a half-open range of instants
 * `[from, to)`, which the service works out from business dates in the store's
 * time zone, so nothing here knows about time zones. The ledger views are the
 * single definition of every total (`v_sale_totals`, `v_sale_return_totals`),
 * so a report can't add things up differently from an invoice.
 */
export class ReportRepository extends Repository {
  salesTotals(from: number, to: number): SalesTotals {
    const row = this.db.get<{
      bill_count: number | null
      gross: number | null
      discount: number | null
      tax: number | null
      round_off: number | null
      billed: number | null
      voided_count: number | null
      voided: number | null
    }>(
      `SELECT
         sum(CASE WHEN is_voided = 0 THEN 1 ELSE 0 END) AS bill_count,
         sum(CASE WHEN is_voided = 0 THEN gross_minor ELSE 0 END) AS gross,
         sum(CASE WHEN is_voided = 0 THEN discount_minor ELSE 0 END) AS discount,
         sum(CASE WHEN is_voided = 0 THEN tax_minor ELSE 0 END) AS tax,
         sum(CASE WHEN is_voided = 0 THEN round_off_minor ELSE 0 END) AS round_off,
         sum(CASE WHEN is_voided = 0 THEN grand_total_minor ELSE 0 END) AS billed,
         sum(CASE WHEN is_voided = 1 THEN 1 ELSE 0 END) AS voided_count,
         sum(CASE WHEN is_voided = 1 THEN grand_total_minor ELSE 0 END) AS voided
       FROM v_sale_totals
       WHERE completed_at >= ? AND completed_at < ?`,
      [from, to]
    )
    return {
      billCount: row?.bill_count ?? 0,
      grossMinor: row?.gross ?? 0,
      discountMinor: row?.discount ?? 0,
      taxMinor: row?.tax ?? 0,
      roundOffMinor: row?.round_off ?? 0,
      billedMinor: row?.billed ?? 0,
      voidedCount: row?.voided_count ?? 0,
      voidedMinor: row?.voided ?? 0
    }
  }

  /** Each non-voided sale in the period, for grouping by the store's day. */
  saleFigures(from: number, to: number): SaleFigures[] {
    return this.db
      .all<{
        completed_at: number
        gross_minor: number
        discount_minor: number
        tax_minor: number
        grand_total_minor: number
      }>(
        `SELECT completed_at, gross_minor, discount_minor, tax_minor, grand_total_minor
         FROM v_sale_totals
         WHERE completed_at >= ? AND completed_at < ? AND is_voided = 0`,
        [from, to]
      )
      .map((row) => ({
        completedAt: row.completed_at,
        grossMinor: row.gross_minor,
        discountMinor: row.discount_minor,
        taxMinor: row.tax_minor,
        billedMinor: row.grand_total_minor
      }))
  }

  /** Each return in the period, with what it refunds and the tax in that. */
  returnFigures(from: number, to: number): ReturnFigures[] {
    return this.db
      .all<{ returned_at: number; refund_due_minor: number; tax_minor: number }>(
        `SELECT returned_at, refund_due_minor, tax_minor
         FROM v_sale_return_totals
         WHERE returned_at >= ? AND returned_at < ?`,
        [from, to]
      )
      .map((row) => ({
        returnedAt: row.returned_at,
        refundDueMinor: row.refund_due_minor,
        taxMinor: row.tax_minor
      }))
  }

  /** Money received per payment method on non-voided sales in the period. */
  collections(from: number, to: number): MethodMoney[] {
    return this.methodMoney(
      `SELECT m.payment_method_id, m.name, m.kind, sum(p.amount_minor) AS amount_minor
       FROM sale_payments p
       JOIN sales s ON s.sale_id = p.sale_id
       JOIN payment_methods m ON m.payment_method_id = p.payment_method_id
       WHERE s.completed_at >= ? AND s.completed_at < ?
         AND NOT EXISTS (SELECT 1 FROM sale_voids v WHERE v.sale_id = s.sale_id)
       GROUP BY m.payment_method_id`,
      from,
      to
    )
  }

  /** Refund money paid out per payment method on returns in the period. */
  refundPayouts(from: number, to: number): MethodMoney[] {
    return this.methodMoney(
      `SELECT m.payment_method_id, m.name, m.kind, sum(f.amount_minor) AS amount_minor
       FROM return_refunds f
       JOIN sale_returns r ON r.sale_return_id = f.sale_return_id
       JOIN payment_methods m ON m.payment_method_id = f.payment_method_id
       WHERE r.returned_at >= ? AND r.returned_at < ?
       GROUP BY m.payment_method_id`,
      from,
      to
    )
  }

  private methodMoney(sql: string, from: number, to: number): MethodMoney[] {
    return this.db
      .all<{
        payment_method_id: number
        name: string
        kind: PaymentKind
        amount_minor: number
      }>(sql, [from, to])
      .map((row) => ({
        paymentMethodId: row.payment_method_id,
        methodName: row.name,
        kind: row.kind,
        amountMinor: row.amount_minor
      }))
  }

  /**
   * Items sold in the period, with what came back on returns in the same
   * period (M19-05). Ranked by net quantity or net value, highest first;
   * items whose net is nothing or less are left out.
   */
  topProducts(from: number, to: number, rankBy: TopProductRank, limit: number): TopProductRow[] {
    const order = rankBy === 'quantity' ? 'net_milli' : 'net_value_minor'
    return this.db
      .all<{
        variant_id: number
        product_name: string
        variant_name: string | null
        sku: string
        unit_code: string
        sold_milli: number
        returned_milli: number
        sold_value_minor: number
        returned_value_minor: number
      }>(
        `WITH sold AS (
           SELECT si.variant_id, sum(si.quantity_milli) AS milli, sum(a.net_minor) AS value_minor
           FROM sale_items si
           JOIN sales s ON s.sale_id = si.sale_id
           JOIN v_sale_item_amounts a ON a.sale_item_id = si.sale_item_id
           WHERE s.completed_at >= ?1 AND s.completed_at < ?2
             AND NOT EXISTS (SELECT 1 FROM sale_voids v WHERE v.sale_id = s.sale_id)
           GROUP BY si.variant_id
         ),
         returned AS (
           SELECT si.variant_id, sum(ri.quantity_milli) AS milli,
                  sum(ri.credit_amount_minor) AS value_minor
           FROM sale_return_items ri
           JOIN sale_returns r ON r.sale_return_id = ri.sale_return_id
           JOIN sale_items si ON si.sale_item_id = ri.sale_item_id
           WHERE r.returned_at >= ?1 AND r.returned_at < ?2
           GROUP BY si.variant_id
         )
         SELECT v.variant_id, p.name AS product_name, v.variant_name, v.sku, v.unit_code,
                sold.milli AS sold_milli, coalesce(returned.milli, 0) AS returned_milli,
                sold.value_minor AS sold_value_minor,
                coalesce(returned.value_minor, 0) AS returned_value_minor,
                sold.milli - coalesce(returned.milli, 0) AS net_milli,
                sold.value_minor - coalesce(returned.value_minor, 0) AS net_value_minor
         FROM sold
         LEFT JOIN returned ON returned.variant_id = sold.variant_id
         JOIN product_variants v ON v.variant_id = sold.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE ${order} > 0
         ORDER BY ${order} DESC, p.name COLLATE NOCASE, v.variant_id
         LIMIT ?3`,
        [from, to, limit]
      )
      .map((row) => ({
        variantId: row.variant_id,
        name: row.variant_name ? `${row.product_name} ${row.variant_name}` : row.product_name,
        sku: row.sku,
        unitCode: row.unit_code,
        soldMilli: row.sold_milli,
        returnedMilli: row.returned_milli,
        netMilli: row.sold_milli - row.returned_milli,
        soldValueMinor: row.sold_value_minor,
        returnedValueMinor: row.returned_value_minor,
        netValueMinor: row.sold_value_minor - row.returned_value_minor
      }))
  }

  // ---- Stock (M19-06) ------------------------------------------------------

  /** Current stock of active, stock-tracked items, with each item's worth at cost. */
  stock(filter: {
    search?: string | undefined
    categoryId?: number | undefined
    level?: StockLevelFilter | undefined
    offset: number
    limit: number
  }): { items: StockReportRow[]; totals: StockReportTotals } {
    const where = ['p.tracks_inventory = 1', 'v.archived_at IS NULL', 'p.archived_at IS NULL']
    const params: SQLInputValue[] = []
    const match = filter.search ? buildPrefixMatchQuery(filter.search) : null
    if (filter.search && match === null) {
      return {
        items: [],
        totals: { itemCount: 0, lowCount: 0, outCount: 0, valueMinor: 0, itemsWithoutCost: 0 }
      }
    }
    if (match !== null) {
      where.push('v.variant_id IN (SELECT rowid FROM variant_search WHERE variant_search MATCH ?)')
      params.push(match)
    }
    if (filter.categoryId !== undefined) {
      where.push('p.category_id = ?')
      params.push(filter.categoryId)
    }
    if (filter.level === 'low') where.push(LOW_STOCK)
    else if (filter.level === 'out') where.push('s.on_hand_milli <= 0')
    const from = `FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      JOIN v_stock_on_hand s ON s.variant_id = v.variant_id
      LEFT JOIN categories c ON c.category_id = p.category_id
      WHERE ${where.join(' AND ')}`

    const totals = this.db.get<{
      n: number
      low: number | null
      out: number | null
      value: number | null
      no_cost: number | null
    }>(
      `SELECT count(*) AS n,
              sum(CASE WHEN ${LOW_STOCK} THEN 1 ELSE 0 END) AS low,
              sum(CASE WHEN s.on_hand_milli <= 0 THEN 1 ELSE 0 END) AS out,
              sum(${STOCK_VALUE}) AS value,
              sum(CASE WHEN s.on_hand_milli > 0 AND v.cost_price_minor IS NULL THEN 1 ELSE 0 END) AS no_cost
       ${from}`,
      params
    )
    const rows = this.db.all<{
      variant_id: number
      product_name: string
      variant_name: string | null
      sku: string
      unit_code: string
      category_name: string | null
      on_hand_milli: number
      reorder_level_milli: number | null
      cost_price_minor: number | null
      value_minor: number | null
      is_low: number
    }>(
      `SELECT v.variant_id, p.name AS product_name, v.variant_name, v.sku, v.unit_code,
              c.name AS category_name, s.on_hand_milli, v.reorder_level_milli,
              v.cost_price_minor, ${STOCK_VALUE} AS value_minor,
              ${LOW_STOCK} AS is_low
       ${from}
       ORDER BY p.name COLLATE NOCASE, p.product_id, v.variant_name IS NOT NULL, v.variant_name, v.variant_id
       LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset]
    )
    return {
      totals: {
        itemCount: totals?.n ?? 0,
        lowCount: totals?.low ?? 0,
        outCount: totals?.out ?? 0,
        valueMinor: totals?.value ?? 0,
        itemsWithoutCost: totals?.no_cost ?? 0
      },
      items: rows.map((row) => ({
        variantId: row.variant_id,
        name: row.variant_name ? `${row.product_name} ${row.variant_name}` : row.product_name,
        sku: row.sku,
        unitCode: row.unit_code,
        categoryName: row.category_name,
        onHandMilli: row.on_hand_milli,
        reorderLevelMilli: row.reorder_level_milli,
        costPriceMinor: row.cost_price_minor,
        valueMinor: row.value_minor,
        isLow: row.is_low === 1
      }))
    }
  }

  /** Every stock movement in the period across all items, newest first. */
  stockMovements(
    from: number,
    to: number,
    filter: { movementType?: MovementType | undefined; offset: number; limit: number }
  ): { items: StockMovementRow[]; total: number } {
    const params: SQLInputValue[] = [from, to]
    let where = 'm.occurred_at >= ? AND m.occurred_at < ?'
    if (filter.movementType) {
      where += ' AND m.movement_type = ?'
      params.push(filter.movementType)
    }
    const total =
      this.db.get<{ n: number }>(
        `SELECT count(*) AS n FROM v_inventory_movements m WHERE ${where}`,
        params
      )?.n ?? 0
    const rows = this.db.all<{
      occurred_at: number
      movement_type: MovementType
      variant_id: number
      product_name: string
      variant_name: string | null
      sku: string
      unit_code: string
      quantity_delta_milli: number
      document_number: string
    }>(
      `SELECT m.occurred_at, m.movement_type, m.variant_id, p.name AS product_name,
              v.variant_name, v.sku, v.unit_code, m.quantity_delta_milli, m.document_number
       FROM v_inventory_movements m
       JOIN product_variants v ON v.variant_id = m.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE ${where}
       ORDER BY m.occurred_at DESC, m.source_table DESC, m.source_id DESC
       LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset]
    )
    return {
      total,
      items: rows.map((row) => ({
        occurredAt: row.occurred_at,
        movementType: row.movement_type,
        variantId: row.variant_id,
        name: row.variant_name ? `${row.product_name} ${row.variant_name}` : row.product_name,
        sku: row.sku,
        unitCode: row.unit_code,
        quantityDeltaMilli: row.quantity_delta_milli,
        documentNumber: row.document_number
      }))
    }
  }

  // ---- Purchases (M19-07) --------------------------------------------------

  /** Posted goods receipts in the period, by supplier. */
  purchasesBySupplier(from: number, to: number, supplierId?: number): PurchaseSupplierRow[] {
    const params: SQLInputValue[] = [from, to]
    let where = 'g.posted_at >= ? AND g.posted_at < ?'
    if (supplierId !== undefined) {
      where += ' AND g.supplier_id = ?'
      params.push(supplierId)
    }
    return this.db
      .all<{ supplier_id: number; name: string; receipt_count: number; total_minor: number }>(
        `SELECT s.supplier_id, s.name,
                count(DISTINCT g.goods_receipt_id) AS receipt_count,
                coalesce(sum(${RECEIPT_LINE_TOTAL}), 0) AS total_minor
         FROM goods_receipts g
         JOIN suppliers s ON s.supplier_id = g.supplier_id
         JOIN goods_receipt_items l ON l.goods_receipt_id = g.goods_receipt_id
         WHERE ${where}
         GROUP BY s.supplier_id
         ORDER BY total_minor DESC, s.name COLLATE NOCASE`,
        params
      )
      .map((row) => ({
        supplierId: row.supplier_id,
        supplierName: row.name,
        receiptCount: row.receipt_count,
        totalMinor: row.total_minor
      }))
  }

  purchaseReceipts(
    from: number,
    to: number,
    filter: { supplierId?: number | undefined; offset: number; limit: number }
  ): PurchaseReceiptRow[] {
    const params: SQLInputValue[] = [from, to]
    let where = 'g.posted_at >= ? AND g.posted_at < ?'
    if (filter.supplierId !== undefined) {
      where += ' AND g.supplier_id = ?'
      params.push(filter.supplierId)
    }
    return this.db
      .all<{
        goods_receipt_id: number
        receipt_number: string
        supplier_id: number
        supplier_name: string
        posted_at: number
        supplier_invoice_number: string | null
        order_number: string | null
        total_minor: number
      }>(
        `SELECT g.goods_receipt_id, g.receipt_number, g.supplier_id, s.name AS supplier_name,
                g.posted_at, g.supplier_invoice_number, po.order_number,
                (SELECT coalesce(sum(${RECEIPT_LINE_TOTAL}), 0) FROM goods_receipt_items l
                 WHERE l.goods_receipt_id = g.goods_receipt_id) AS total_minor
         FROM goods_receipts g
         JOIN suppliers s ON s.supplier_id = g.supplier_id
         LEFT JOIN goods_receipt_purchase_orders link ON link.goods_receipt_id = g.goods_receipt_id
         LEFT JOIN purchase_orders po ON po.purchase_order_id = link.purchase_order_id
         WHERE ${where}
         ORDER BY g.posted_at DESC, g.goods_receipt_id DESC
         LIMIT ? OFFSET ?`,
        [...params, filter.limit, filter.offset]
      )
      .map((row) => ({
        goodsReceiptId: row.goods_receipt_id,
        receiptNumber: row.receipt_number,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        postedAt: row.posted_at,
        supplierInvoiceNumber: row.supplier_invoice_number,
        orderNumber: row.order_number,
        totalMinor: row.total_minor
      }))
  }

  // ---- Expenses (M19-08) ---------------------------------------------------

  /** Expenses dated within the business dates `first` to `last`, both included. */
  expenseTotals(
    first: string,
    last: string
  ): {
    count: number
    totalMinor: number
    voidedCount: number
    voidedMinor: number
    byCategory: ExpenseCategoryTotal[]
    byMethod: ExpenseMethodTotal[]
  } {
    const overall = this.db.get<{
      n: number | null
      total: number | null
      voided_n: number | null
      voided: number | null
    }>(
      `SELECT sum(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS n,
              sum(CASE WHEN archived_at IS NULL THEN amount_minor ELSE 0 END) AS total,
              sum(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS voided_n,
              sum(CASE WHEN archived_at IS NOT NULL THEN amount_minor ELSE 0 END) AS voided
       FROM expenses WHERE expense_date >= ? AND expense_date <= ?`,
      [first, last]
    )
    const byCategory = this.db
      .all<{ expense_category_id: number; name: string; n: number; total: number }>(
        `SELECT c.expense_category_id, c.name, count(*) AS n, sum(e.amount_minor) AS total
         FROM expenses e JOIN expense_categories c ON c.expense_category_id = e.expense_category_id
         WHERE e.expense_date >= ? AND e.expense_date <= ? AND e.archived_at IS NULL
         GROUP BY c.expense_category_id
         ORDER BY total DESC, c.name COLLATE NOCASE`,
        [first, last]
      )
      .map((row) => ({
        expenseCategoryId: row.expense_category_id,
        name: row.name,
        count: row.n,
        totalMinor: row.total
      }))
    const byMethod = this.db
      .all<{ payment_method_id: number; name: string; n: number; total: number }>(
        `SELECT m.payment_method_id, m.name, count(*) AS n, sum(e.amount_minor) AS total
         FROM expenses e JOIN payment_methods m ON m.payment_method_id = e.payment_method_id
         WHERE e.expense_date >= ? AND e.expense_date <= ? AND e.archived_at IS NULL
         GROUP BY m.payment_method_id
         ORDER BY total DESC, m.name COLLATE NOCASE`,
        [first, last]
      )
      .map((row) => ({
        paymentMethodId: row.payment_method_id,
        methodName: row.name,
        count: row.n,
        totalMinor: row.total
      }))
    return {
      count: overall?.n ?? 0,
      totalMinor: overall?.total ?? 0,
      voidedCount: overall?.voided_n ?? 0,
      voidedMinor: overall?.voided ?? 0,
      byCategory,
      byMethod
    }
  }
}
