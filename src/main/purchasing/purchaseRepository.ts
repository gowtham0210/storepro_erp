import type {
  CostHistory,
  CostHistoryEntry,
  GoodsReceiptDetail,
  GoodsReceiptListFilter,
  GoodsReceiptListItem,
  GoodsReceiptListPage,
  GoodsReceiptStatus,
  PurchaseLineDetail,
  PurchaseLineInput,
  PurchaseOrderDetail,
  PurchaseOrderLineDetail,
  PurchaseOrderListFilter,
  PurchaseOrderListItem,
  PurchaseOrderListPage,
  PurchaseOrderReceiptRef,
  PurchaseOrderStatus
} from '@shared/ipc/contract'
import { multiplyByQuantity } from '@shared/money'
import type { SQLInputValue } from 'node:sqlite'
import { itemName } from '../catalog/productRepository'
import { Repository } from '../db/repository'
import { likePattern } from '../db/search'

export const DEFAULT_PURCHASE_PAGE_SIZE = 50

/** What the purchase rules need to know about an item. */
export interface PurchaseVariant {
  variantId: number
  name: string
  sku: string
  unitCode: string
  allowsFraction: boolean
  tracksInventory: boolean
  active: boolean
  costPriceMinor: number | null
}

export interface OrderHeader {
  purchaseOrderId: number
  orderNumber: string
  status: PurchaseOrderStatus
  supplierId: number
  supplierName: string
}

export interface ReceiptHeader {
  goodsReceiptId: number
  receiptNumber: string
  status: GoodsReceiptStatus
  supplierId: number
  supplierName: string
  purchaseOrderId: number | null
  orderNumber: string | null
  supplierInvoiceNumber: string | null
}

interface VariantRow {
  variant_id: number
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string
  allows_fraction: number
  tracks_inventory: number
  active: number
  cost_price_minor: number | null
}

interface OrderRow {
  purchase_order_id: number
  order_number: string
  status: PurchaseOrderStatus
  supplier_id: number
  supplier_name: string
  notes: string | null
  created_by_name: string
  created_at: number
  updated_at: number
  confirmed_at: number | null
  closed_at: number | null
  cancelled_at: number | null
}

interface LineRow {
  line_number: number
  variant_id: number
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string
  allows_fraction: number
  quantity_milli: number
  unit_cost_minor: number
  received_milli?: number
}

interface ReceiptRow {
  goods_receipt_id: number
  receipt_number: string
  status: GoodsReceiptStatus
  supplier_id: number
  supplier_name: string
  purchase_order_id: number | null
  order_number: string | null
  supplier_invoice_number: string | null
  supplier_invoice_date: string | null
  created_by_name: string
  created_at: number
  posted_at: number | null
  posted_by_name: string | null
}

/** Quantity × cost per line, rounded exactly as `multiplyByQuantity` does (half up). */
const LINE_TOTAL = '((l.quantity_milli * l.unit_cost_minor * 2 + 1000) / 2000)'

const ORDER_SELECT = `SELECT po.purchase_order_id, po.order_number, po.status, po.supplier_id,
         s.name AS supplier_name, po.notes, u.display_name AS created_by_name,
         po.created_at, po.updated_at, po.confirmed_at, po.closed_at, po.cancelled_at
  FROM v_purchase_orders po
  JOIN suppliers s ON s.supplier_id = po.supplier_id
  JOIN users u ON u.user_id = po.created_by_user_id`

const RECEIPT_SELECT = `SELECT g.goods_receipt_id, g.receipt_number,
         CASE WHEN g.posted_at IS NULL THEN 'draft' ELSE 'posted' END AS status,
         g.supplier_id, s.name AS supplier_name, link.purchase_order_id,
         po.order_number, g.supplier_invoice_number, g.supplier_invoice_date,
         cu.display_name AS created_by_name, g.created_at, g.posted_at,
         pu.display_name AS posted_by_name
  FROM goods_receipts g
  JOIN suppliers s ON s.supplier_id = g.supplier_id
  JOIN users cu ON cu.user_id = g.created_by_user_id
  LEFT JOIN users pu ON pu.user_id = g.posted_by_user_id
  LEFT JOIN goods_receipt_purchase_orders link ON link.goods_receipt_id = g.goods_receipt_id
  LEFT JOIN purchase_orders po ON po.purchase_order_id = link.purchase_order_id`

function toLine(row: LineRow): PurchaseLineDetail {
  return {
    lineNumber: row.line_number,
    variantId: row.variant_id,
    name: itemName(row.product_name, row.variant_name),
    sku: row.sku,
    unitCode: row.unit_code,
    allowsFraction: row.allows_fraction === 1,
    quantityMilli: row.quantity_milli,
    unitCostMinor: row.unit_cost_minor,
    totalMinor: multiplyByQuantity(row.unit_cost_minor, row.quantity_milli)
  }
}

function sumTotals(lines: readonly { totalMinor: number }[]): number {
  return lines.reduce((sum, line) => sum + line.totalMinor, 0)
}

/**
 * Purchase orders, goods receipts and purchase cost history (M15-02 to
 * M15-05). Posting a goods receipt is the only thing that adds stock: the
 * stock ledger (`v_inventory_movements`) reads posted receipts, so there is no
 * separate movement to write and nothing that can drift.
 */
export class PurchaseRepository extends Repository {
  findVariant(variantId: number): PurchaseVariant | null {
    const row = this.db.get<VariantRow>(
      `SELECT v.variant_id, p.name AS product_name, v.variant_name, v.sku, v.unit_code,
              u.allows_fraction, p.tracks_inventory, v.cost_price_minor,
              (v.archived_at IS NULL AND p.archived_at IS NULL) AS active
       FROM product_variants v
       JOIN products p ON p.product_id = v.product_id
       JOIN units u ON u.unit_code = v.unit_code
       WHERE v.variant_id = ?`,
      [variantId]
    )
    if (!row) return null
    return {
      variantId: row.variant_id,
      name: itemName(row.product_name, row.variant_name),
      sku: row.sku,
      unitCode: row.unit_code,
      allowsFraction: row.allows_fraction === 1,
      tracksInventory: row.tracks_inventory === 1,
      active: row.active === 1,
      costPriceMinor: row.cost_price_minor
    }
  }

  /** The item's cost price changes to what was paid (M15-05). */
  setVariantCost(variantId: number, costPriceMinor: number): void {
    this.update('product_variants', 'variant_id', variantId, { cost_price_minor: costPriceMinor })
  }

  // ---- Purchase orders -----------------------------------------------------

  findOrderHeader(purchaseOrderId: number): OrderHeader | null {
    const row = this.db.get<OrderRow>(`${ORDER_SELECT} WHERE po.purchase_order_id = ?`, [
      purchaseOrderId
    ])
    return row
      ? {
          purchaseOrderId: row.purchase_order_id,
          orderNumber: row.order_number,
          status: row.status,
          supplierId: row.supplier_id,
          supplierName: row.supplier_name
        }
      : null
  }

  createOrder(input: {
    supplierId: number
    userId: number
    notes: string | null
    lines: readonly PurchaseLineInput[]
  }): number {
    const orderNumber = this.nextDocumentNumber(
      'purchase_order',
      (candidate) =>
        this.db.get('SELECT 1 FROM purchase_orders WHERE order_number = ?', [candidate]) !==
        undefined
    )
    const id = this.insertWithTimestamps('purchase_orders', {
      order_number: orderNumber,
      supplier_id: input.supplierId,
      created_by_user_id: input.userId,
      notes: input.notes
    })
    this.insertOrderLines(id, input.lines)
    return id
  }

  /** Replace a draft order's supplier, note and lines. */
  replaceOrder(
    purchaseOrderId: number,
    input: { supplierId: number; notes: string | null; lines: readonly PurchaseLineInput[] }
  ): void {
    this.update('purchase_orders', 'purchase_order_id', purchaseOrderId, {
      supplier_id: input.supplierId,
      notes: input.notes
    })
    this.db.run('DELETE FROM purchase_order_items WHERE purchase_order_id = ?', [purchaseOrderId])
    this.insertOrderLines(purchaseOrderId, input.lines)
  }

  private insertOrderLines(purchaseOrderId: number, lines: readonly PurchaseLineInput[]): void {
    lines.forEach((line, index) => {
      this.insert('purchase_order_items', {
        purchase_order_id: purchaseOrderId,
        line_number: index + 1,
        variant_id: line.variantId,
        quantity_milli: line.quantityMilli,
        unit_cost_minor: line.unitCostMinor
      })
    })
  }

  confirmOrder(purchaseOrderId: number): void {
    this.update('purchase_orders', 'purchase_order_id', purchaseOrderId, {
      confirmed_at: this.now()
    })
  }

  closeOrder(purchaseOrderId: number): void {
    this.update('purchase_orders', 'purchase_order_id', purchaseOrderId, {
      closed_at: this.now()
    })
  }

  cancelOrder(purchaseOrderId: number): void {
    this.update('purchase_orders', 'purchase_order_id', purchaseOrderId, {
      cancelled_at: this.now()
    })
  }

  deleteOrder(purchaseOrderId: number): void {
    this.db.run('DELETE FROM purchase_orders WHERE purchase_order_id = ?', [purchaseOrderId])
  }

  /** Receipts linked to an order, by whether they are posted yet. */
  countOrderReceipts(purchaseOrderId: number): { posted: number; drafts: number } {
    const row = this.db.get<{ posted: number | null; drafts: number | null }>(
      `SELECT sum(g.posted_at IS NOT NULL) AS posted, sum(g.posted_at IS NULL) AS drafts
       FROM goods_receipt_purchase_orders l
       JOIN goods_receipts g ON g.goods_receipt_id = l.goods_receipt_id
       WHERE l.purchase_order_id = ?`,
      [purchaseOrderId]
    )
    return { posted: row?.posted ?? 0, drafts: row?.drafts ?? 0 }
  }

  /** True once every order line has received at least what was ordered. */
  isOrderFullyReceived(purchaseOrderId: number): boolean {
    const row = this.db.get<{ open_lines: number }>(
      `SELECT count(*) AS open_lines FROM v_purchase_order_receipts
       WHERE purchase_order_id = ? AND received_milli < ordered_milli`,
      [purchaseOrderId]
    )
    return (row?.open_lines ?? 0) === 0
  }

  getOrder(purchaseOrderId: number): PurchaseOrderDetail | null {
    const header = this.db.get<OrderRow>(`${ORDER_SELECT} WHERE po.purchase_order_id = ?`, [
      purchaseOrderId
    ])
    if (!header) return null
    const lines = this.db
      .all<LineRow>(
        `SELECT l.line_number, l.variant_id, p.name AS product_name, v.variant_name, v.sku,
                v.unit_code, un.allows_fraction, l.quantity_milli, l.unit_cost_minor,
                r.received_milli
         FROM purchase_order_items l
         JOIN product_variants v ON v.variant_id = l.variant_id
         JOIN products p ON p.product_id = v.product_id
         JOIN units un ON un.unit_code = v.unit_code
         JOIN v_purchase_order_receipts r
           ON r.purchase_order_item_id = l.purchase_order_item_id
         WHERE l.purchase_order_id = ?
         ORDER BY l.line_number`,
        [purchaseOrderId]
      )
      .map((row): PurchaseOrderLineDetail => {
        const received = row.received_milli ?? 0
        return {
          ...toLine(row),
          receivedMilli: received,
          outstandingMilli: Math.max(0, row.quantity_milli - received)
        }
      })
    const receipts = this.db
      .all<{
        goods_receipt_id: number
        receipt_number: string
        posted_at: number | null
      }>(
        `SELECT g.goods_receipt_id, g.receipt_number, g.posted_at
         FROM goods_receipt_purchase_orders l
         JOIN goods_receipts g ON g.goods_receipt_id = l.goods_receipt_id
         WHERE l.purchase_order_id = ?
         ORDER BY g.goods_receipt_id`,
        [purchaseOrderId]
      )
      .map((row): PurchaseOrderReceiptRef => ({
        goodsReceiptId: row.goods_receipt_id,
        receiptNumber: row.receipt_number,
        status: row.posted_at === null ? 'draft' : 'posted',
        postedAt: row.posted_at,
        totalMinor: this.receiptTotal(row.goods_receipt_id)
      }))
    return {
      purchaseOrderId: header.purchase_order_id,
      orderNumber: header.order_number,
      status: header.status,
      supplierId: header.supplier_id,
      supplierName: header.supplier_name,
      notes: header.notes,
      createdByName: header.created_by_name,
      createdAt: header.created_at,
      updatedAt: header.updated_at,
      confirmedAt: header.confirmed_at,
      closedAt: header.closed_at,
      cancelledAt: header.cancelled_at,
      totalMinor: sumTotals(lines),
      lines,
      receipts
    }
  }

  listOrders(filter: PurchaseOrderListFilter = {}): PurchaseOrderListPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    const search = filter.search?.trim()
    if (search) {
      const pattern = likePattern(search)
      where.push(`(po.order_number LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')`)
      params.push(pattern, pattern)
    }
    if (filter.status && filter.status !== 'all') {
      where.push('po.status = ?')
      params.push(filter.status)
    }
    if (filter.supplierId !== undefined) {
      where.push('po.supplier_id = ?')
      params.push(filter.supplierId)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const from = `FROM v_purchase_orders po JOIN suppliers s ON s.supplier_id = po.supplier_id`

    const total =
      this.db.get<{ n: number }>(`SELECT count(*) AS n ${from} ${whereSql}`, params)?.n ?? 0
    const rows = this.db.all<{
      purchase_order_id: number
      order_number: string
      status: PurchaseOrderStatus
      supplier_id: number
      supplier_name: string
      created_at: number
      line_count: number
      total_minor: number
    }>(
      `SELECT po.purchase_order_id, po.order_number, po.status, po.supplier_id,
              s.name AS supplier_name, po.created_at,
              (SELECT count(*) FROM purchase_order_items l
               WHERE l.purchase_order_id = po.purchase_order_id) AS line_count,
              (SELECT coalesce(sum(${LINE_TOTAL}), 0) FROM purchase_order_items l
               WHERE l.purchase_order_id = po.purchase_order_id) AS total_minor
       ${from}
       ${whereSql}
       ORDER BY po.created_at DESC, po.purchase_order_id DESC
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_PURCHASE_PAGE_SIZE, filter.offset ?? 0]
    )
    return {
      total,
      items: rows.map((row): PurchaseOrderListItem => ({
        purchaseOrderId: row.purchase_order_id,
        orderNumber: row.order_number,
        status: row.status,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        createdAt: row.created_at,
        lineCount: row.line_count,
        totalMinor: row.total_minor
      }))
    }
  }

  // ---- Goods receipts ------------------------------------------------------

  findReceiptHeader(goodsReceiptId: number): ReceiptHeader | null {
    const row = this.db.get<ReceiptRow>(`${RECEIPT_SELECT} WHERE g.goods_receipt_id = ?`, [
      goodsReceiptId
    ])
    return row
      ? {
          goodsReceiptId: row.goods_receipt_id,
          receiptNumber: row.receipt_number,
          status: row.status,
          supplierId: row.supplier_id,
          supplierName: row.supplier_name,
          purchaseOrderId: row.purchase_order_id,
          orderNumber: row.order_number,
          supplierInvoiceNumber: row.supplier_invoice_number
        }
      : null
  }

  /** The receipt already entered for this supplier bill, if any. */
  findReceiptBySupplierInvoice(
    supplierId: number,
    supplierInvoiceNumber: string
  ): ReceiptHeader | null {
    const row = this.db.get<{ goods_receipt_id: number }>(
      `SELECT goods_receipt_id FROM goods_receipts
       WHERE supplier_id = ? AND supplier_invoice_number = ?`,
      [supplierId, supplierInvoiceNumber]
    )
    return row ? this.findReceiptHeader(row.goods_receipt_id) : null
  }

  createReceipt(input: {
    supplierId: number
    purchaseOrderId: number | null
    supplierInvoiceNumber: string | null
    supplierInvoiceDate: string | null
    userId: number
    lines: readonly PurchaseLineInput[]
  }): number {
    const receiptNumber = this.nextDocumentNumber(
      'goods_receipt',
      (candidate) =>
        this.db.get('SELECT 1 FROM goods_receipts WHERE receipt_number = ?', [candidate]) !==
        undefined
    )
    const id = this.insertWithTimestamps('goods_receipts', {
      receipt_number: receiptNumber,
      supplier_id: input.supplierId,
      supplier_invoice_number: input.supplierInvoiceNumber,
      supplier_invoice_date: input.supplierInvoiceDate,
      created_by_user_id: input.userId
    })
    if (input.purchaseOrderId !== null) this.linkReceipt(id, input.purchaseOrderId)
    this.insertReceiptLines(id, input.lines)
    return id
  }

  /** Replace a draft receipt's header, order link and lines. */
  replaceReceipt(
    goodsReceiptId: number,
    input: {
      supplierId: number
      purchaseOrderId: number | null
      supplierInvoiceNumber: string | null
      supplierInvoiceDate: string | null
      lines: readonly PurchaseLineInput[]
    }
  ): void {
    this.update('goods_receipts', 'goods_receipt_id', goodsReceiptId, {
      supplier_id: input.supplierId,
      supplier_invoice_number: input.supplierInvoiceNumber,
      supplier_invoice_date: input.supplierInvoiceDate
    })
    this.db.run('DELETE FROM goods_receipt_purchase_orders WHERE goods_receipt_id = ?', [
      goodsReceiptId
    ])
    if (input.purchaseOrderId !== null) this.linkReceipt(goodsReceiptId, input.purchaseOrderId)
    this.db.run('DELETE FROM goods_receipt_items WHERE goods_receipt_id = ?', [goodsReceiptId])
    this.insertReceiptLines(goodsReceiptId, input.lines)
  }

  private linkReceipt(goodsReceiptId: number, purchaseOrderId: number): void {
    this.insert('goods_receipt_purchase_orders', {
      goods_receipt_id: goodsReceiptId,
      purchase_order_id: purchaseOrderId
    })
  }

  private insertReceiptLines(goodsReceiptId: number, lines: readonly PurchaseLineInput[]): void {
    lines.forEach((line, index) => {
      this.insert('goods_receipt_items', {
        goods_receipt_id: goodsReceiptId,
        line_number: index + 1,
        variant_id: line.variantId,
        quantity_milli: line.quantityMilli,
        unit_cost_minor: line.unitCostMinor
      })
    })
  }

  /** Posting freezes the receipt and, through the ledger view, adds its quantities to stock. */
  postReceipt(goodsReceiptId: number, userId: number): void {
    this.update('goods_receipts', 'goods_receipt_id', goodsReceiptId, {
      posted_at: this.now(),
      posted_by_user_id: userId
    })
  }

  deleteReceipt(goodsReceiptId: number): void {
    this.db.run('DELETE FROM goods_receipts WHERE goods_receipt_id = ?', [goodsReceiptId])
  }

  private receiptTotal(goodsReceiptId: number): number {
    return (
      this.db.get<{ total: number }>(
        `SELECT coalesce(sum(${LINE_TOTAL}), 0) AS total
         FROM goods_receipt_items l WHERE l.goods_receipt_id = ?`,
        [goodsReceiptId]
      )?.total ?? 0
    )
  }

  receiptLines(goodsReceiptId: number): PurchaseLineDetail[] {
    return this.db
      .all<LineRow>(
        `SELECT l.line_number, l.variant_id, p.name AS product_name, v.variant_name, v.sku,
                v.unit_code, un.allows_fraction, l.quantity_milli, l.unit_cost_minor
         FROM goods_receipt_items l
         JOIN product_variants v ON v.variant_id = l.variant_id
         JOIN products p ON p.product_id = v.product_id
         JOIN units un ON un.unit_code = v.unit_code
         WHERE l.goods_receipt_id = ?
         ORDER BY l.line_number`,
        [goodsReceiptId]
      )
      .map(toLine)
  }

  getReceipt(goodsReceiptId: number): GoodsReceiptDetail | null {
    const row = this.db.get<ReceiptRow>(`${RECEIPT_SELECT} WHERE g.goods_receipt_id = ?`, [
      goodsReceiptId
    ])
    if (!row) return null
    const lines = this.receiptLines(goodsReceiptId)
    return {
      goodsReceiptId: row.goods_receipt_id,
      receiptNumber: row.receipt_number,
      status: row.status,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      purchaseOrderId: row.purchase_order_id,
      orderNumber: row.order_number,
      supplierInvoiceNumber: row.supplier_invoice_number,
      supplierInvoiceDate: row.supplier_invoice_date,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
      postedAt: row.posted_at,
      postedByName: row.posted_by_name,
      totalMinor: sumTotals(lines),
      lines
    }
  }

  listReceipts(filter: GoodsReceiptListFilter = {}): GoodsReceiptListPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    const search = filter.search?.trim()
    if (search) {
      const pattern = likePattern(search)
      where.push(
        `(g.receipt_number LIKE ? ESCAPE '\\' OR g.supplier_invoice_number LIKE ? ESCAPE '\\'
          OR s.name LIKE ? ESCAPE '\\' OR po.order_number LIKE ? ESCAPE '\\')`
      )
      params.push(pattern, pattern, pattern, pattern)
    }
    if (filter.status === 'draft') where.push('g.posted_at IS NULL')
    else if (filter.status === 'posted') where.push('g.posted_at IS NOT NULL')
    if (filter.supplierId !== undefined) {
      where.push('g.supplier_id = ?')
      params.push(filter.supplierId)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const from = `FROM goods_receipts g
      JOIN suppliers s ON s.supplier_id = g.supplier_id
      LEFT JOIN goods_receipt_purchase_orders link ON link.goods_receipt_id = g.goods_receipt_id
      LEFT JOIN purchase_orders po ON po.purchase_order_id = link.purchase_order_id`

    const total =
      this.db.get<{ n: number }>(`SELECT count(*) AS n ${from} ${whereSql}`, params)?.n ?? 0
    const rows = this.db.all<{
      goods_receipt_id: number
      receipt_number: string
      status: GoodsReceiptStatus
      supplier_id: number
      supplier_name: string
      order_number: string | null
      supplier_invoice_number: string | null
      occurred_at: number
      line_count: number
      total_minor: number
    }>(
      `SELECT g.goods_receipt_id, g.receipt_number,
              CASE WHEN g.posted_at IS NULL THEN 'draft' ELSE 'posted' END AS status,
              g.supplier_id, s.name AS supplier_name, po.order_number,
              g.supplier_invoice_number, coalesce(g.posted_at, g.created_at) AS occurred_at,
              (SELECT count(*) FROM goods_receipt_items l
               WHERE l.goods_receipt_id = g.goods_receipt_id) AS line_count,
              (SELECT coalesce(sum(${LINE_TOTAL}), 0) FROM goods_receipt_items l
               WHERE l.goods_receipt_id = g.goods_receipt_id) AS total_minor
       ${from}
       ${whereSql}
       ORDER BY occurred_at DESC, g.goods_receipt_id DESC
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_PURCHASE_PAGE_SIZE, filter.offset ?? 0]
    )
    return {
      total,
      items: rows.map((row): GoodsReceiptListItem => ({
        goodsReceiptId: row.goods_receipt_id,
        receiptNumber: row.receipt_number,
        status: row.status,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        orderNumber: row.order_number,
        supplierInvoiceNumber: row.supplier_invoice_number,
        occurredAt: row.occurred_at,
        lineCount: row.line_count,
        totalMinor: row.total_minor
      }))
    }
  }

  // ---- Cost history (M15-05) ----------------------------------------------

  costHistory(variantId: number, limit: number): CostHistory | null {
    const variant = this.findVariant(variantId)
    if (!variant) return null
    const entries = this.db
      .all<{
        goods_receipt_id: number
        receipt_number: string
        supplier_name: string
        posted_at: number
        quantity_milli: number
        unit_cost_minor: number
      }>(
        `SELECT g.goods_receipt_id, g.receipt_number, s.name AS supplier_name, g.posted_at,
                l.quantity_milli, l.unit_cost_minor
         FROM goods_receipt_items l
         JOIN goods_receipts g ON g.goods_receipt_id = l.goods_receipt_id
         JOIN suppliers s ON s.supplier_id = g.supplier_id
         WHERE l.variant_id = ? AND g.posted_at IS NOT NULL
         ORDER BY g.posted_at DESC, g.goods_receipt_id DESC
         LIMIT ?`,
        [variantId, limit]
      )
      .map((row): CostHistoryEntry => ({
        goodsReceiptId: row.goods_receipt_id,
        receiptNumber: row.receipt_number,
        supplierName: row.supplier_name,
        postedAt: row.posted_at,
        quantityMilli: row.quantity_milli,
        unitCostMinor: row.unit_cost_minor
      }))
    return {
      variantId,
      name: variant.name,
      sku: variant.sku,
      unitCode: variant.unitCode,
      currentCostMinor: variant.costPriceMinor,
      entries
    }
  }
}
