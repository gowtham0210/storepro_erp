import type {
  HeldBillDetail,
  HeldBillLineDetail,
  HeldBillLineInput,
  HeldBillSummary,
  ItemLookup,
  SaleDetail,
  SaleLineDetail,
  SaleListFilter,
  SaleListItem,
  SaleListPage,
  SaleVoidInfo
} from '@shared/ipc/contract'
import type { CalculatedPayment } from '@shared/payments'
import type { TaxAmount, TaxComponentCode, TaxSummaryRow } from '@shared/pricing'
import type { SQLInputValue } from 'node:sqlite'
import { itemName } from '../catalog/productRepository'
import type { Database } from '../db/database'
import { Repository } from '../db/repository'
import type { Clock } from '../lib/clock'
import type { PaymentRepository } from '../payments/paymentRepository'

export const DEFAULT_PAGE_SIZE = 50

export interface CheckoutVariantSnapshot {
  variantId: number
  productId: number
  name: string
  sku: string
  hsnCode: string | null
  unitCode: string
  allowsFraction: boolean
  sellingPriceMinor: number
  mrpMinor: number | null
  costPriceMinor: number | null
  taxClassId: number
  rateBp: number
  cessRateBp: number
  tracksInventory: boolean
  active: boolean
}

interface VariantSnapshotRow {
  variant_id: number
  product_id: number
  product_name: string
  variant_name: string | null
  sku: string
  hsn_code: string | null
  unit_code: string
  allows_fraction: number
  selling_price_minor: number
  mrp_minor: number | null
  cost_price_minor: number | null
  tax_class_id: number
  rate_bp: number
  cess_rate_bp: number
  tracks_inventory: number
  product_archived_at: number | null
  variant_archived_at: number | null
}

export interface CreateSaleLineRecord {
  variantId: number
  description: string
  hsnCode: string | null
  unitCode: string
  quantityMilli: number
  unitPriceMinor: number
  discountMinor: number
  unitCostMinor: number | null
  taxes: TaxAmount[]
}

export interface CreateSaleRecord {
  checkoutKey: string
  cashierUserId: number
  customerId: number | null
  pricesIncludeTax: boolean
  roundOffMinor: number
  lines: CreateSaleLineRecord[]
  payments: CalculatedPayment[]
  heldBillId: number | null
}

interface SaleHeaderRow {
  sale_id: number
  invoice_number: string
  checkout_key: string
  completed_at: number
  cashier_user_id: number
  cashier_name: string
  customer_id: number | null
  customer_name: string | null
  prices_include_tax: number
  gross_minor: number
  discount_minor: number
  taxable_minor: number
  tax_minor: number
  round_off_minor: number
  grand_total_minor: number
  paid_minor: number
}

interface SaleLineRow {
  sale_item_id: number
  line_number: number
  variant_id: number
  description: string
  sku: string
  hsn_code: string | null
  unit_code: string
  allows_fraction: number
  quantity_milli: number
  unit_price_minor: number
  gross_minor: number
  discount_minor: number
  net_minor: number
  taxable_minor: number
  tax_minor: number
  total_minor: number
}

interface SaleItemTaxRow {
  sale_item_id: number
  tax_component_code: TaxComponentCode
  rate_bp: number
  amount_minor: number
}

interface SaleVoidRow {
  voided_at: number
  voided_by_user_id: number
  voided_by_name: string
  approved_by_user_id: number | null
  approved_by_name: string | null
  reason: string
}

interface SaleListRow {
  sale_id: number
  invoice_number: string
  completed_at: number
  cashier_name: string
  customer_name: string | null
  line_count: number
  grand_total_minor: number
  payment_summary: string | null
  is_voided: number
}

interface HeldBillSummaryRow {
  held_bill_id: number
  label: string | null
  customer_id: number | null
  customer_name: string | null
  held_by_user_id: number
  held_by_name: string
  held_at: number
  line_count: number
  item_summary: string | null
}

interface HeldBillLineRow {
  line_number: number
  variant_id: number
  product_id: number
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string
  allows_fraction: number
  selling_price_minor: number
  mrp_minor: number | null
  tax_class_id: number
  tracks_inventory: number
  on_hand_milli: number | null
  quantity_milli: number
  unit_price_override_minor: number | null
  discount_minor: number
}

const ON_HAND = `CASE WHEN p.tracks_inventory = 1
  THEN (SELECT coalesce(sum(m.quantity_delta_milli), 0) FROM v_inventory_movements m
        WHERE m.variant_id = v.variant_id)
  END`

/**
 * Completed sales, sale items, item taxes, sale voids and held bills (M11, M13-01).
 */
export class SalesRepository extends Repository {
  constructor(
    db: Database,
    clock: Clock,
    private readonly payments: PaymentRepository
  ) {
    super(db, clock)
  }

  findVariantForCheckout(variantId: number): CheckoutVariantSnapshot | null {
    const row = this.db.get<VariantSnapshotRow>(
      `SELECT v.variant_id, p.product_id, p.name AS product_name, v.variant_name, v.sku,
              p.hsn_code, v.unit_code, u.allows_fraction, v.selling_price_minor, v.mrp_minor,
              v.cost_price_minor, p.tax_class_id, tc.rate_bp, tc.cess_rate_bp, p.tracks_inventory,
              p.archived_at AS product_archived_at, v.archived_at AS variant_archived_at
       FROM product_variants v
       JOIN products p ON p.product_id = v.product_id
       JOIN units u ON u.unit_code = v.unit_code
       JOIN tax_classes tc ON tc.tax_class_id = p.tax_class_id
       WHERE v.variant_id = ?`,
      [variantId]
    )
    if (!row) return null
    return {
      variantId: row.variant_id,
      productId: row.product_id,
      name: itemName(row.product_name, row.variant_name),
      sku: row.sku,
      hsnCode: row.hsn_code,
      unitCode: row.unit_code,
      allowsFraction: row.allows_fraction === 1,
      sellingPriceMinor: row.selling_price_minor,
      mrpMinor: row.mrp_minor,
      costPriceMinor: row.cost_price_minor,
      taxClassId: row.tax_class_id,
      rateBp: row.rate_bp,
      cessRateBp: row.cess_rate_bp,
      tracksInventory: row.tracks_inventory === 1,
      active: row.product_archived_at === null && row.variant_archived_at === null
    }
  }

  findCustomer(customerId: number): { customerId: number; name: string; active: boolean } | null {
    const row = this.db.get<{ customer_id: number; name: string; archived_at: number | null }>(
      'SELECT customer_id, name, archived_at FROM customers WHERE customer_id = ?',
      [customerId]
    )
    if (!row) return null
    return {
      customerId: row.customer_id,
      name: row.name,
      active: row.archived_at === null
    }
  }

  findSaleIdByCheckoutKey(checkoutKey: string): number | null {
    return (
      this.db.get<{ sale_id: number }>('SELECT sale_id FROM sales WHERE checkout_key = ?', [
        checkoutKey
      ])?.sale_id ?? null
    )
  }

  /**
   * Persist a sale, its item snapshots, tax rows and payment records inside an
   * active transaction, allocating the next sequential invoice number (M11-07, M13-01).
   */
  createSale(input: CreateSaleRecord): number {
    const invoiceNumber = this.nextDocumentNumber('sale_invoice', (candidate) =>
      Boolean(this.db.get('SELECT 1 FROM sales WHERE invoice_number = ?', [candidate]))
    )
    const saleId = this.insert('sales', {
      invoice_number: invoiceNumber,
      checkout_key: input.checkoutKey,
      completed_at: this.now(),
      cashier_user_id: input.cashierUserId,
      customer_id: input.customerId,
      prices_include_tax: input.pricesIncludeTax ? 1 : 0,
      round_off_minor: input.roundOffMinor
    })

    input.lines.forEach((line, index) => {
      const saleItemId = this.insert('sale_items', {
        sale_id: saleId,
        line_number: index + 1,
        variant_id: line.variantId,
        description: line.description,
        hsn_code: line.hsnCode,
        unit_code: line.unitCode,
        quantity_milli: line.quantityMilli,
        unit_price_minor: line.unitPriceMinor,
        discount_minor: line.discountMinor,
        unit_cost_minor: line.unitCostMinor
      })
      for (const tax of line.taxes) {
        this.insert('sale_item_taxes', {
          sale_item_id: saleItemId,
          tax_component_code: tax.code,
          rate_bp: tax.rateBp,
          amount_minor: tax.amountMinor
        })
      }
    })

    this.payments.recordSalePayments(saleId, input.payments)

    if (input.heldBillId !== null) {
      this.deleteHeldBill(input.heldBillId)
    }

    return saleId
  }

  get(saleId: number): SaleDetail | null {
    const header = this.db.get<SaleHeaderRow>(
      `SELECT t.sale_id, t.invoice_number, s.checkout_key, t.completed_at, t.cashier_user_id,
              u.display_name AS cashier_name, t.customer_id, c.name AS customer_name,
              s.prices_include_tax, t.gross_minor, t.discount_minor, t.taxable_minor,
              t.tax_minor, t.round_off_minor, t.grand_total_minor, t.paid_minor
       FROM v_sale_totals t
       JOIN sales s ON s.sale_id = t.sale_id
       JOIN users u ON u.user_id = t.cashier_user_id
       LEFT JOIN customers c ON c.customer_id = t.customer_id
       WHERE t.sale_id = ?`,
      [saleId]
    )
    if (!header) return null

    const taxRows = this.db.all<SaleItemTaxRow>(
      `SELECT sit.sale_item_id, sit.tax_component_code, sit.rate_bp, sit.amount_minor
       FROM sale_item_taxes sit
       JOIN sale_items si ON si.sale_item_id = sit.sale_item_id
       WHERE si.sale_id = ?
       ORDER BY sit.sale_item_id, sit.tax_component_code`,
      [saleId]
    )
    const taxesByItem = new Map<number, TaxAmount[]>()
    for (const row of taxRows) {
      const list = taxesByItem.get(row.sale_item_id) ?? []
      list.push({
        code: row.tax_component_code,
        rateBp: row.rate_bp,
        amountMinor: row.amount_minor
      })
      taxesByItem.set(row.sale_item_id, list)
    }

    const lines = this.db
      .all<SaleLineRow>(
        `SELECT si.sale_item_id, si.line_number, si.variant_id, si.description, v.sku,
                si.hsn_code, si.unit_code, un.allows_fraction, si.quantity_milli,
                si.unit_price_minor, a.gross_minor, a.discount_minor, a.net_minor,
                a.taxable_minor, a.tax_minor, a.total_minor
         FROM sale_items si
         JOIN v_sale_item_amounts a ON a.sale_item_id = si.sale_item_id
         JOIN product_variants v ON v.variant_id = si.variant_id
         JOIN units un ON un.unit_code = si.unit_code
         WHERE si.sale_id = ?
         ORDER BY si.line_number`,
        [saleId]
      )
      .map(
        (row): SaleLineDetail => ({
          saleItemId: row.sale_item_id,
          lineNumber: row.line_number,
          variantId: row.variant_id,
          description: row.description,
          sku: row.sku,
          hsnCode: row.hsn_code,
          unitCode: row.unit_code,
          allowsFraction: row.allows_fraction === 1,
          quantityMilli: row.quantity_milli,
          unitPriceMinor: row.unit_price_minor,
          grossMinor: row.gross_minor,
          discountMinor: row.discount_minor,
          netMinor: row.net_minor,
          taxableMinor: row.taxable_minor,
          taxMinor: row.tax_minor,
          totalMinor: row.total_minor,
          taxes: taxesByItem.get(row.sale_item_id) ?? []
        })
      )

    const summary = new Map<string, TaxSummaryRow>()
    for (const line of lines) {
      for (const tax of line.taxes) {
        const key = `${tax.code}:${tax.rateBp}`
        const existing = summary.get(key) ?? { ...tax, amountMinor: 0, taxableMinor: 0 }
        existing.amountMinor += tax.amountMinor
        existing.taxableMinor += line.taxableMinor
        summary.set(key, existing)
      }
    }

    const payments = this.payments.listSalePayments(saleId)
    const refunds = this.payments.listRefundsForSale(saleId)
    const tenderedMinor = payments.reduce((sum, p) => sum + (p.tenderedMinor ?? p.amountMinor), 0)
    const changeMinor = payments.reduce((sum, p) => sum + p.changeMinor, 0)

    const voidRow = this.db.get<SaleVoidRow>(
      `SELECT sv.voided_at, sv.voided_by_user_id, u.display_name AS voided_by_name,
              sv.approved_by_user_id, ap.display_name AS approved_by_name, sv.reason
       FROM sale_voids sv
       JOIN users u ON u.user_id = sv.voided_by_user_id
       LEFT JOIN users ap ON ap.user_id = sv.approved_by_user_id
       WHERE sv.sale_id = ?`,
      [saleId]
    )
    const voidInfo: SaleVoidInfo | null = voidRow
      ? {
          voidedAt: voidRow.voided_at,
          voidedByUserId: voidRow.voided_by_user_id,
          voidedByName: voidRow.voided_by_name,
          approvedByUserId: voidRow.approved_by_user_id,
          approvedByName: voidRow.approved_by_name,
          reason: voidRow.reason
        }
      : null

    return {
      saleId: header.sale_id,
      invoiceNumber: header.invoice_number,
      checkoutKey: header.checkout_key,
      completedAt: header.completed_at,
      cashierUserId: header.cashier_user_id,
      cashierName: header.cashier_name,
      customerId: header.customer_id,
      customerName: header.customer_name,
      pricesIncludeTax: header.prices_include_tax === 1,
      grossMinor: header.gross_minor,
      discountMinor: header.discount_minor,
      taxableMinor: header.taxable_minor,
      taxMinor: header.tax_minor,
      roundOffMinor: header.round_off_minor,
      grandTotalMinor: header.grand_total_minor,
      paidMinor: header.paid_minor,
      tenderedMinor,
      changeMinor,
      lines,
      taxSummary: [...summary.values()],
      payments,
      refunds,
      voidInfo
    }
  }

  findByInvoice(invoiceNumber: string): SaleDetail | null {
    const row = this.db.get<{ sale_id: number }>(
      'SELECT sale_id FROM sales WHERE invoice_number = ? COLLATE NOCASE',
      [invoiceNumber.trim()]
    )
    return row ? this.get(row.sale_id) : null
  }

  list(filter: SaleListFilter): SaleListPage {
    const conditions: string[] = []
    const params: SQLInputValue[] = []

    const search = filter.search?.trim()
    if (search) {
      const pattern = `%${search}%`
      conditions.push(
        '(t.invoice_number LIKE ? COLLATE NOCASE OR c.name LIKE ? COLLATE NOCASE OR u.display_name LIKE ? COLLATE NOCASE)'
      )
      params.push(pattern, pattern, pattern)
    }

    if (filter.status === 'completed') {
      conditions.push('t.is_voided = 0')
    } else if (filter.status === 'voided') {
      conditions.push('t.is_voided = 1')
    }

    if (filter.from !== undefined) {
      conditions.push('t.completed_at >= ?')
      params.push(filter.from)
    }
    if (filter.to !== undefined) {
      conditions.push('t.completed_at < ?')
      params.push(filter.to)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const total =
      this.db.get<{ n: number }>(
        `SELECT count(*) AS n
         FROM v_sale_totals t
         JOIN users u ON u.user_id = t.cashier_user_id
         LEFT JOIN customers c ON c.customer_id = t.customer_id
         ${where}`,
        params
      )?.n ?? 0

    const limit = filter.limit ?? DEFAULT_PAGE_SIZE
    const offset = filter.offset ?? 0

    const items = this.db
      .all<SaleListRow>(
        `SELECT t.sale_id, t.invoice_number, t.completed_at, u.display_name AS cashier_name,
                c.name AS customer_name, t.line_count, t.grand_total_minor, t.is_voided,
                (SELECT group_concat(m.name, ', ')
                 FROM (SELECT DISTINCT pm.name, pm.sort_order
                       FROM sale_payments sp
                       JOIN payment_methods pm ON pm.payment_method_id = sp.payment_method_id
                       WHERE sp.sale_id = t.sale_id
                       ORDER BY pm.sort_order, pm.name) m) AS payment_summary
         FROM v_sale_totals t
         JOIN users u ON u.user_id = t.cashier_user_id
         LEFT JOIN customers c ON c.customer_id = t.customer_id
         ${where}
         ORDER BY t.completed_at DESC, t.sale_id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      )
      .map(
        (row): SaleListItem => ({
          saleId: row.sale_id,
          invoiceNumber: row.invoice_number,
          completedAt: row.completed_at,
          cashierName: row.cashier_name,
          customerName: row.customer_name,
          lineCount: row.line_count,
          grandTotalMinor: row.grand_total_minor,
          paymentSummary: row.payment_summary ?? '—',
          isVoided: row.is_voided === 1
        })
      )

    return { items, total }
  }

  hasReturns(saleId: number): boolean {
    return (
      this.db.get('SELECT 1 AS found FROM sale_returns WHERE sale_id = ? LIMIT 1', [saleId]) !==
      undefined
    )
  }

  voidSale(input: {
    saleId: number
    voidedByUserId: number
    approvedByUserId: number | null
    reason: string
  }): void {
    this.insert('sale_voids', {
      sale_id: input.saleId,
      voided_at: this.now(),
      voided_by_user_id: input.voidedByUserId,
      approved_by_user_id: input.approvedByUserId,
      reason: input.reason
    })
  }

  holdBill(input: {
    label: string | null
    customerId: number | null
    heldByUserId: number
    items: readonly HeldBillLineInput[]
  }): HeldBillSummary {
    const heldBillId = this.insert('held_bills', {
      label: input.label,
      customer_id: input.customerId,
      held_by_user_id: input.heldByUserId,
      held_at: this.now()
    })
    input.items.forEach((line, index) => {
      this.insert('held_bill_items', {
        held_bill_id: heldBillId,
        line_number: index + 1,
        variant_id: line.variantId,
        quantity_milli: line.quantityMilli,
        unit_price_override_minor: line.unitPriceOverrideMinor ?? null,
        discount_minor: line.discountMinor ?? 0
      })
    })
    const summary = this.findHeldBillSummary(heldBillId)
    if (!summary) throw new Error(`Held bill ${heldBillId} not found after insert`)
    return summary
  }

  listHeldBills(): HeldBillSummary[] {
    return this.db
      .all<HeldBillSummaryRow>(
        `SELECT hb.held_bill_id, hb.label, hb.customer_id, c.name AS customer_name,
                hb.held_by_user_id, u.display_name AS held_by_name, hb.held_at,
                (SELECT count(*) FROM held_bill_items hbi WHERE hbi.held_bill_id = hb.held_bill_id) AS line_count,
                (SELECT group_concat(item_name, ', ')
                 FROM (SELECT p.name || coalesce(' ' || v.variant_name, '') AS item_name
                       FROM held_bill_items hbi
                       JOIN product_variants v ON v.variant_id = hbi.variant_id
                       JOIN products p ON p.product_id = v.product_id
                       WHERE hbi.held_bill_id = hb.held_bill_id
                       ORDER BY hbi.line_number
                       LIMIT 4)) AS item_summary
         FROM held_bills hb
         JOIN users u ON u.user_id = hb.held_by_user_id
         LEFT JOIN customers c ON c.customer_id = hb.customer_id
         ORDER BY hb.held_at DESC, hb.held_bill_id DESC`
      )
      .map((row) => ({
        heldBillId: row.held_bill_id,
        label: row.label,
        customerId: row.customer_id,
        customerName: row.customer_name,
        heldByUserId: row.held_by_user_id,
        heldByName: row.held_by_name,
        heldAt: row.held_at,
        lineCount: row.line_count,
        itemSummary: row.item_summary ?? ''
      }))
  }

  findHeldBillSummary(heldBillId: number): HeldBillSummary | null {
    const row = this.db.get<HeldBillSummaryRow>(
      `SELECT hb.held_bill_id, hb.label, hb.customer_id, c.name AS customer_name,
              hb.held_by_user_id, u.display_name AS held_by_name, hb.held_at,
              (SELECT count(*) FROM held_bill_items hbi WHERE hbi.held_bill_id = hb.held_bill_id) AS line_count,
              (SELECT group_concat(item_name, ', ')
               FROM (SELECT p.name || coalesce(' ' || v.variant_name, '') AS item_name
                     FROM held_bill_items hbi
                     JOIN product_variants v ON v.variant_id = hbi.variant_id
                     JOIN products p ON p.product_id = v.product_id
                     WHERE hbi.held_bill_id = hb.held_bill_id
                     ORDER BY hbi.line_number
                     LIMIT 4)) AS item_summary
       FROM held_bills hb
       JOIN users u ON u.user_id = hb.held_by_user_id
       LEFT JOIN customers c ON c.customer_id = hb.customer_id
       WHERE hb.held_bill_id = ?`,
      [heldBillId]
    )
    if (!row) return null
    return {
      heldBillId: row.held_bill_id,
      label: row.label,
      customerId: row.customer_id,
      customerName: row.customer_name,
      heldByUserId: row.held_by_user_id,
      heldByName: row.held_by_name,
      heldAt: row.held_at,
      lineCount: row.line_count,
      itemSummary: row.item_summary ?? ''
    }
  }

  getHeldBill(heldBillId: number): HeldBillDetail | null {
    const header = this.findHeldBillSummary(heldBillId)
    if (!header) return null
    const items = this.db
      .all<HeldBillLineRow>(
        `SELECT hbi.line_number, v.variant_id, p.product_id, p.name AS product_name, v.variant_name,
                v.sku, v.unit_code, u.allows_fraction, v.selling_price_minor, v.mrp_minor,
                p.tax_class_id, p.tracks_inventory, ${ON_HAND} AS on_hand_milli,
                hbi.quantity_milli, hbi.unit_price_override_minor, hbi.discount_minor
         FROM held_bill_items hbi
         JOIN product_variants v ON v.variant_id = hbi.variant_id
         JOIN products p ON p.product_id = v.product_id
         JOIN units u ON u.unit_code = v.unit_code
         WHERE hbi.held_bill_id = ?
         ORDER BY hbi.line_number`,
        [heldBillId]
      )
      .map((row): HeldBillLineDetail => {
        const item: ItemLookup = {
          variantId: row.variant_id,
          productId: row.product_id,
          name: itemName(row.product_name, row.variant_name),
          sku: row.sku,
          unitCode: row.unit_code,
          allowsFraction: row.allows_fraction === 1,
          sellingPriceMinor: row.selling_price_minor,
          mrpMinor: row.mrp_minor,
          taxClassId: row.tax_class_id,
          tracksInventory: row.tracks_inventory === 1,
          onHandMilli: row.on_hand_milli
        }
        return {
          lineNumber: row.line_number,
          item,
          quantityMilli: row.quantity_milli,
          unitPriceOverrideMinor: row.unit_price_override_minor,
          discountMinor: row.discount_minor
        }
      })

    return {
      heldBillId: header.heldBillId,
      label: header.label,
      customerId: header.customerId,
      customerName: header.customerName,
      heldByName: header.heldByName,
      heldAt: header.heldAt,
      items
    }
  }

  deleteHeldBill(heldBillId: number): boolean {
    return (
      this.db.run('DELETE FROM held_bills WHERE held_bill_id = ?', [heldBillId]).changes > 0
    )
  }
}
