/**
 * Raw-SQL builders for test fixtures and the performance seed. They write
 * well-formed documents directly, bypassing the (future) domain services, so
 * they must only be used by tests and dev tooling.
 */
import type { Database } from '../database'

const DAY_MS = 24 * 60 * 60 * 1000
export const BASE_TIME = Date.UTC(2026, 9, 1, 4, 30) // 2026-10-01 10:00 IST

export function insertBusiness(db: Database, overrides: { pricesIncludeTax?: boolean } = {}): void {
  db.run(
    `INSERT INTO businesses (business_id, name, address_line1, city, region_code, country_code, phone,
       currency_code, time_zone, business_type_code, prices_include_tax, created_at, updated_at)
     VALUES (1, 'Test Store', '1 Market Road', 'Chennai', '33', 'IN', '+91 44 0000 0000',
       'INR', 'Asia/Kolkata', 'grocery', ?, ?, ?)`,
    [overrides.pricesIncludeTax === false ? 0 : 1, BASE_TIME, BASE_TIME]
  )
}

export function insertUser(db: Database, username: string, roleCode = 'cashier'): number {
  return db.run(
    `INSERT INTO users (username, display_name, password_hash, role_id, created_at, updated_at)
     SELECT ?, ?, 'not-a-real-hash', role_id, ?, ? FROM roles WHERE role_code = ?`,
    [username, username, BASE_TIME, BASE_TIME, roleCode]
  ).lastInsertRowid
}

export function insertTaxClass(db: Database, name: string, rateBp: number): number {
  return db.run(
    'INSERT INTO tax_classes (name, rate_bp, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [name, rateBp, BASE_TIME, BASE_TIME]
  ).lastInsertRowid
}

export function insertCategory(db: Database, name: string): number {
  return db.run('INSERT INTO categories (name, created_at, updated_at) VALUES (?, ?, ?)', [
    name,
    BASE_TIME,
    BASE_TIME
  ]).lastInsertRowid
}

export function insertSupplier(db: Database, name: string): number {
  return db.run('INSERT INTO suppliers (name, created_at, updated_at) VALUES (?, ?, ?)', [
    name,
    BASE_TIME,
    BASE_TIME
  ]).lastInsertRowid
}

export interface VariantSpec {
  variantName?: string | null
  sku: string
  unitCode?: string
  priceMinor: number
  mrpMinor?: number | null
  costMinor?: number | null
  barcodes?: string[]
}

export interface ProductSpec {
  name: string
  taxClassId: number
  categoryId?: number | null
  hsnCode?: string | null
  tracksInventory?: boolean
  variants: VariantSpec[]
}

export function insertProduct(
  db: Database,
  spec: ProductSpec
): { productId: number; variantIds: number[] } {
  const productId = db.run(
    `INSERT INTO products (name, category_id, tax_class_id, hsn_code, tracks_inventory, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      spec.name,
      spec.categoryId ?? null,
      spec.taxClassId,
      spec.hsnCode ?? null,
      spec.tracksInventory === false ? 0 : 1,
      BASE_TIME,
      BASE_TIME
    ]
  ).lastInsertRowid
  const variantIds = spec.variants.map((variant) => {
    const variantId = db.run(
      `INSERT INTO product_variants (product_id, variant_name, sku, unit_code, selling_price_minor,
         mrp_minor, cost_price_minor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        variant.variantName ?? null,
        variant.sku,
        variant.unitCode ?? 'pcs',
        variant.priceMinor,
        variant.mrpMinor ?? null,
        variant.costMinor ?? null,
        BASE_TIME,
        BASE_TIME
      ]
    ).lastInsertRowid
    for (const barcode of variant.barcodes ?? []) {
      db.run('INSERT INTO barcodes (barcode, variant_id, created_at) VALUES (?, ?, ?)', [
        barcode,
        variantId,
        BASE_TIME
      ])
    }
    return variantId
  })
  return { productId, variantIds }
}

export interface TaxSpec {
  code: string
  rateBp: number
  amountMinor: number
}

export interface SaleLineSpec {
  variantId: number
  quantityMilli: number
  unitPriceMinor: number
  discountMinor?: number
  taxes?: TaxSpec[]
}

export interface SaleSpec {
  invoiceNumber: string
  cashierId: number
  completedAt?: number
  pricesIncludeTax?: boolean
  roundOffMinor?: number
  customerId?: number | null
  lines: SaleLineSpec[]
  payments: { methodCode: string; amountMinor: number; tenderedMinor?: number | null }[]
}

export function insertSale(
  db: Database,
  spec: SaleSpec
): { saleId: number; saleItemIds: number[] } {
  return db.transaction(() => {
    const saleId = db.run(
      `INSERT INTO sales (invoice_number, checkout_key, completed_at, cashier_user_id, customer_id,
         prices_include_tax, round_off_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        spec.invoiceNumber,
        `checkout-${spec.invoiceNumber}`,
        spec.completedAt ?? BASE_TIME,
        spec.cashierId,
        spec.customerId ?? null,
        spec.pricesIncludeTax === false ? 0 : 1,
        spec.roundOffMinor ?? 0
      ]
    ).lastInsertRowid
    const saleItemIds = spec.lines.map((line, index) => {
      const saleItemId = db.run(
        `INSERT INTO sale_items (sale_id, line_number, variant_id, description, hsn_code, unit_code,
           quantity_milli, unit_price_minor, discount_minor, unit_cost_minor)
         SELECT ?, ?, v.variant_id, p.name || coalesce(' ' || v.variant_name, ''), p.hsn_code, v.unit_code,
           ?, ?, ?, v.cost_price_minor
         FROM product_variants v JOIN products p ON p.product_id = v.product_id
         WHERE v.variant_id = ?`,
        [
          saleId,
          index + 1,
          line.quantityMilli,
          line.unitPriceMinor,
          line.discountMinor ?? 0,
          line.variantId
        ]
      ).lastInsertRowid
      for (const tax of line.taxes ?? []) {
        db.run(
          `INSERT INTO sale_item_taxes (sale_item_id, tax_component_code, rate_bp, amount_minor)
           VALUES (?, ?, ?, ?)`,
          [saleItemId, tax.code, tax.rateBp, tax.amountMinor]
        )
      }
      return saleItemId
    })
    for (const payment of spec.payments) {
      db.run(
        `INSERT INTO sale_payments (sale_id, payment_method_id, amount_minor, tendered_minor)
         SELECT ?, payment_method_id, ?, ? FROM payment_methods WHERE method_code = ?`,
        [saleId, payment.amountMinor, payment.tenderedMinor ?? null, payment.methodCode]
      )
    }
    return { saleId, saleItemIds }
  })
}

export function insertVoid(
  db: Database,
  saleId: number,
  userId: number,
  at = BASE_TIME + DAY_MS
): void {
  db.run(
    `INSERT INTO sale_voids (sale_id, voided_at, voided_by_user_id, reason) VALUES (?, ?, ?, 'Customer cancelled')`,
    [saleId, at, userId]
  )
}

export interface ReturnSpec {
  returnNumber: string
  saleId: number
  userId: number
  returnedAt?: number
  items: {
    saleItemId: number
    quantityMilli: number
    disposition?: 'restock' | 'quarantine' | 'write_off'
    creditAmountMinor: number
    taxes?: TaxSpec[]
  }[]
  refunds?: { methodCode: string; amountMinor: number }[]
}

export function insertReturn(db: Database, spec: ReturnSpec): number {
  return db.transaction(() => {
    const returnId = db.run(
      `INSERT INTO sale_returns (return_number, sale_id, returned_at, processed_by_user_id)
       VALUES (?, ?, ?, ?)`,
      [spec.returnNumber, spec.saleId, spec.returnedAt ?? BASE_TIME + DAY_MS, spec.userId]
    ).lastInsertRowid
    for (const item of spec.items) {
      const returnItemId = db.run(
        `INSERT INTO sale_return_items (sale_return_id, sale_item_id, disposition, quantity_milli,
           credit_amount_minor) VALUES (?, ?, ?, ?, ?)`,
        [
          returnId,
          item.saleItemId,
          item.disposition ?? 'restock',
          item.quantityMilli,
          item.creditAmountMinor
        ]
      ).lastInsertRowid
      for (const tax of item.taxes ?? []) {
        db.run(
          `INSERT INTO sale_return_item_taxes (sale_return_item_id, tax_component_code, rate_bp, amount_minor)
           VALUES (?, ?, ?, ?)`,
          [returnItemId, tax.code, tax.rateBp, tax.amountMinor]
        )
      }
    }
    for (const refund of spec.refunds ?? []) {
      db.run(
        `INSERT INTO return_refunds (sale_return_id, payment_method_id, amount_minor)
         SELECT ?, payment_method_id, ? FROM payment_methods WHERE method_code = ?`,
        [returnId, refund.amountMinor, refund.methodCode]
      )
    }
    return returnId
  })
}

export interface GoodsReceiptSpec {
  receiptNumber: string
  supplierId: number
  userId: number
  purchaseOrderId?: number
  supplierInvoiceNumber?: string
  post?: boolean
  postedAt?: number
  lines: { variantId: number; quantityMilli: number; unitCostMinor: number }[]
}

export function insertGoodsReceipt(db: Database, spec: GoodsReceiptSpec): number {
  return db.transaction(() => {
    const receiptId = db.run(
      `INSERT INTO goods_receipts (receipt_number, supplier_id, supplier_invoice_number,
         created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        spec.receiptNumber,
        spec.supplierId,
        spec.supplierInvoiceNumber ?? null,
        spec.userId,
        BASE_TIME,
        BASE_TIME
      ]
    ).lastInsertRowid
    if (spec.purchaseOrderId !== undefined) {
      db.run(
        'INSERT INTO goods_receipt_purchase_orders (goods_receipt_id, purchase_order_id) VALUES (?, ?)',
        [receiptId, spec.purchaseOrderId]
      )
    }
    spec.lines.forEach((line, index) => {
      db.run(
        `INSERT INTO goods_receipt_items (goods_receipt_id, line_number, variant_id, quantity_milli, unit_cost_minor)
         VALUES (?, ?, ?, ?, ?)`,
        [receiptId, index + 1, line.variantId, line.quantityMilli, line.unitCostMinor]
      )
    })
    if (spec.post !== false) {
      db.run(
        'UPDATE goods_receipts SET posted_at = ?, posted_by_user_id = ? WHERE goods_receipt_id = ?',
        [spec.postedAt ?? BASE_TIME, spec.userId, receiptId]
      )
    }
    return receiptId
  })
}

export function insertPurchaseOrder(
  db: Database,
  spec: {
    orderNumber: string
    supplierId: number
    userId: number
    confirm?: boolean
    lines: { variantId: number; quantityMilli: number; unitCostMinor: number }[]
  }
): number {
  return db.transaction(() => {
    const orderId = db.run(
      `INSERT INTO purchase_orders (order_number, supplier_id, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [spec.orderNumber, spec.supplierId, spec.userId, BASE_TIME, BASE_TIME]
    ).lastInsertRowid
    spec.lines.forEach((line, index) => {
      db.run(
        `INSERT INTO purchase_order_items (purchase_order_id, line_number, variant_id, quantity_milli, unit_cost_minor)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, index + 1, line.variantId, line.quantityMilli, line.unitCostMinor]
      )
    })
    if (spec.confirm !== false) {
      db.run('UPDATE purchase_orders SET confirmed_at = ? WHERE purchase_order_id = ?', [
        BASE_TIME,
        orderId
      ])
    }
    return orderId
  })
}

export function insertAdjustment(
  db: Database,
  spec: {
    adjustmentNumber: string
    reasonCode: string
    userId: number
    adjustedAt?: number
    lines: { variantId: number; quantityDeltaMilli: number }[]
  }
): number {
  return db.transaction(() => {
    const adjustmentId = db.run(
      `INSERT INTO stock_adjustments (adjustment_number, adjustment_reason_code, adjusted_at, adjusted_by_user_id)
       VALUES (?, ?, ?, ?)`,
      [spec.adjustmentNumber, spec.reasonCode, spec.adjustedAt ?? BASE_TIME, spec.userId]
    ).lastInsertRowid
    for (const line of spec.lines) {
      db.run(
        `INSERT INTO stock_adjustment_items (stock_adjustment_id, variant_id, quantity_delta_milli) VALUES (?, ?, ?)`,
        [adjustmentId, line.variantId, line.quantityDeltaMilli]
      )
    }
    return adjustmentId
  })
}

export function stockOnHand(db: Database, variantId: number): number {
  return (
    db.get<{ q: number }>(
      'SELECT coalesce(sum(quantity_delta_milli), 0) AS q FROM v_inventory_movements WHERE variant_id = ?',
      [variantId]
    )?.q ?? 0
  )
}
