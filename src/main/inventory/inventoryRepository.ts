import type {
  AdjustmentListFilter,
  AdjustmentListPage,
  AdjustmentReason,
  AdjustmentReasonCode,
  InventoryMovement,
  MovementListFilter,
  MovementType,
  StockAdjustmentDetail,
  StockAdjustmentLineDetail,
  StockListFilter,
  StockListItem,
  StockListPage
} from '@shared/ipc/contract'
import type { SQLInputValue } from 'node:sqlite'
import { itemName } from '../catalog/productRepository'
import { Repository } from '../db/repository'
import { buildPrefixMatchQuery } from '../db/search'

export const DEFAULT_STOCK_PAGE_SIZE = 50

export interface VariantStockInfo {
  variantId: number
  productId: number
  productName: string
  variantName: string | null
  name: string
  sku: string
  unitCode: string
  allowsFraction: boolean
  tracksInventory: boolean
  active: boolean
  onHandMilli: number
  reorderLevelMilli: number | null
}

interface StockRow {
  variant_id: number
  product_id: number
  product_name: string
  variant_name: string | null
  sku: string
  barcodes: string | null
  category_name: string | null
  unit_code: string
  allows_fraction: number
  selling_price_minor: number
  cost_price_minor: number | null
  on_hand_milli: number
  reorder_level_milli: number | null
}

interface VariantStockRow {
  variant_id: number
  product_id: number
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string
  allows_fraction: number
  tracks_inventory: number
  active: number
  on_hand_milli: number
  reorder_level_milli: number | null
}

interface MovementRow {
  movement_type: MovementType
  occurred_at: number
  variant_id: number
  quantity_delta_milli: number
  balance_after_milli: number
  source_table: string
  source_id: number
  document_number: string
  reason_code: AdjustmentReasonCode | null
  reason_name: string | null
  actor_name: string | null
  notes: string | null
}

interface AdjustmentHeaderRow {
  stock_adjustment_id: number
  adjustment_number: string
  adjustment_reason_code: AdjustmentReasonCode
  reason_name: string
  adjusted_at: number
  adjusted_by_name: string
  notes: string | null
}

interface AdjustmentLineRow {
  variant_id: number
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string
  quantity_delta_milli: number
  on_hand_milli: number
}

function splitList(value: string | null): string[] {
  return value ? value.split('\u001f') : []
}

const BARCODES = `(SELECT group_concat(b.barcode, char(31)) FROM
  (SELECT barcode FROM barcodes WHERE variant_id = v.variant_id ORDER BY created_at, barcode) b)`

const ON_HAND_SUBQUERY = `(SELECT coalesce(sum(m.quantity_delta_milli), 0)
  FROM v_inventory_movements m WHERE m.variant_id = v.variant_id)`

/**
 * The stock ledger and adjustments repository (M14): reads stock balances and
 * movement history from `v_inventory_movements` / `v_stock_on_hand`, and writes
 * `stock_adjustments` and `stock_adjustment_items`.
 */
export class InventoryRepository extends Repository {
  listReasons(): AdjustmentReason[] {
    return this.db
      .all<{ adjustment_reason_code: AdjustmentReasonCode; name: string }>(
        `SELECT adjustment_reason_code, name
         FROM adjustment_reasons
         ORDER BY CASE adjustment_reason_code
           WHEN 'opening_stock' THEN 1
           WHEN 'count_correction' THEN 2
           WHEN 'damage' THEN 3
           WHEN 'expiry' THEN 4
           WHEN 'theft_loss' THEN 5
           ELSE 6
         END`
      )
      .map((row) => ({
        adjustmentReasonCode: row.adjustment_reason_code,
        name: row.name
      }))
  }

  findReason(code: string): AdjustmentReason | null {
    const row = this.db.get<{ adjustment_reason_code: AdjustmentReasonCode; name: string }>(
      'SELECT adjustment_reason_code, name FROM adjustment_reasons WHERE adjustment_reason_code = ?',
      [code]
    )
    return row ? { adjustmentReasonCode: row.adjustment_reason_code, name: row.name } : null
  }

  findVariantStock(variantId: number): VariantStockInfo | null {
    const row = this.db.get<VariantStockRow>(
      `SELECT v.variant_id, p.product_id, p.name AS product_name, v.variant_name, v.sku,
              v.unit_code, u.allows_fraction, p.tracks_inventory,
              (v.archived_at IS NULL AND p.archived_at IS NULL) AS active,
              ${ON_HAND_SUBQUERY} AS on_hand_milli,
              v.reorder_level_milli
       FROM product_variants v
       JOIN products p ON p.product_id = v.product_id
       JOIN units u ON u.unit_code = v.unit_code
       WHERE v.variant_id = ?`,
      [variantId]
    )
    if (!row) return null
    return {
      variantId: row.variant_id,
      productId: row.product_id,
      productName: row.product_name,
      variantName: row.variant_name,
      name: itemName(row.product_name, row.variant_name),
      sku: row.sku,
      unitCode: row.unit_code,
      allowsFraction: row.allows_fraction === 1,
      tracksInventory: row.tracks_inventory === 1,
      active: row.active === 1,
      onHandMilli: row.on_hand_milli,
      reorderLevelMilli: row.reorder_level_milli
    }
  }

  /** M14-02, M14-05: current stock levels for active inventory-tracked items. */
  listStock(filter: StockListFilter = {}): StockListPage {
    const summary = this.db.get<{ low_count: number; out_count: number }>(
      `SELECT
         coalesce(sum(CASE WHEN s.on_hand_milli <= 0
                            OR (v.reorder_level_milli IS NOT NULL AND s.on_hand_milli <= v.reorder_level_milli)
                           THEN 1 ELSE 0 END), 0) AS low_count,
         coalesce(sum(CASE WHEN s.on_hand_milli <= 0 THEN 1 ELSE 0 END), 0) AS out_count
       FROM product_variants v
       JOIN products p ON p.product_id = v.product_id
       JOIN v_stock_on_hand s ON s.variant_id = v.variant_id
       WHERE p.tracks_inventory = 1 AND v.archived_at IS NULL AND p.archived_at IS NULL`
    )
    const lowStockCount = summary?.low_count ?? 0
    const outOfStockCount = summary?.out_count ?? 0

    const where: string[] = [
      'p.tracks_inventory = 1',
      'v.archived_at IS NULL',
      'p.archived_at IS NULL'
    ]
    const params: SQLInputValue[] = []
    const match = filter.search ? buildPrefixMatchQuery(filter.search) : null
    if (filter.search && match === null) {
      return { items: [], total: 0, lowStockCount, outOfStockCount }
    }
    if (match !== null) {
      where.push('v.variant_id IN (SELECT rowid FROM variant_search WHERE variant_search MATCH ?)')
      params.push(match)
    }
    if (filter.categoryId !== undefined) {
      where.push('p.category_id = ?')
      params.push(filter.categoryId)
    }
    const level = filter.level ?? 'all'
    if (level === 'low') {
      where.push(
        '(s.on_hand_milli <= 0 OR (v.reorder_level_milli IS NOT NULL AND s.on_hand_milli <= v.reorder_level_milli))'
      )
    } else if (level === 'out') {
      where.push('s.on_hand_milli <= 0')
    }

    const from = `FROM product_variants v
                  JOIN products p ON p.product_id = v.product_id
                  JOIN units u ON u.unit_code = v.unit_code
                  JOIN v_stock_on_hand s ON s.variant_id = v.variant_id
                  LEFT JOIN categories c ON c.category_id = p.category_id`
    const whereSql = `WHERE ${where.join(' AND ')}`

    const total =
      this.db.get<{ n: number }>(`SELECT count(*) AS n ${from} ${whereSql}`, params)?.n ?? 0
    const rows = this.db.all<StockRow>(
      `SELECT v.variant_id, p.product_id, p.name AS product_name, v.variant_name, v.sku,
              ${BARCODES} AS barcodes, c.name AS category_name, v.unit_code, u.allows_fraction,
              v.selling_price_minor, v.cost_price_minor, s.on_hand_milli, v.reorder_level_milli
       ${from}
       ${whereSql}
       ORDER BY p.name COLLATE NOCASE, p.product_id, v.variant_name IS NOT NULL, v.variant_name, v.variant_id
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_STOCK_PAGE_SIZE, filter.offset ?? 0]
    )

    return {
      total,
      lowStockCount,
      outOfStockCount,
      items: rows.map((row): StockListItem => ({
        variantId: row.variant_id,
        productId: row.product_id,
        productName: row.product_name,
        variantName: row.variant_name,
        name: itemName(row.product_name, row.variant_name),
        sku: row.sku,
        barcodes: splitList(row.barcodes),
        categoryName: row.category_name,
        unitCode: row.unit_code,
        allowsFraction: row.allows_fraction === 1,
        sellingPriceMinor: row.selling_price_minor,
        costPriceMinor: row.cost_price_minor,
        onHandMilli: row.on_hand_milli,
        reorderLevelMilli: row.reorder_level_milli,
        isLowStock:
          row.on_hand_milli <= 0 ||
          (row.reorder_level_milli !== null && row.on_hand_milli <= row.reorder_level_milli)
      }))
    }
  }

  /**
   * M14-07: stock movement history for one variant, newest first, with the
   * running balance after each movement.
   */
  listMovements(filter: MovementListFilter): { items: InventoryMovement[]; total: number } {
    const params: SQLInputValue[] = [filter.variantId]
    const typeFilter = filter.movementType ? 'WHERE l.movement_type = ?' : ''
    if (filter.movementType) params.push(filter.movementType)

    const cte = `
      WITH ledger AS (
        SELECT
          m.movement_type,
          m.occurred_at,
          m.variant_id,
          m.quantity_delta_milli,
          m.source_table,
          m.source_id,
          m.document_number,
          sum(m.quantity_delta_milli) OVER (
            ORDER BY m.occurred_at ASC, m.source_table ASC, m.source_id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS balance_after_milli,
          row_number() OVER (
            ORDER BY m.occurred_at ASC, m.source_table ASC, m.source_id ASC
          ) AS seq
        FROM v_inventory_movements m
        WHERE m.variant_id = ?
      )`

    const total =
      this.db.get<{ n: number }>(`${cte} SELECT count(*) AS n FROM ledger l ${typeFilter}`, params)
        ?.n ?? 0

    const rows = this.db.all<MovementRow>(
      `${cte}
       SELECT
         l.movement_type,
         l.occurred_at,
         l.variant_id,
         l.quantity_delta_milli,
         l.balance_after_milli,
         l.source_table,
         l.source_id,
         l.document_number,
         CASE WHEN l.movement_type = 'adjustment' THEN a.adjustment_reason_code END AS reason_code,
         CASE WHEN l.movement_type = 'adjustment' THEN ar.name END AS reason_name,
         CASE l.movement_type
           WHEN 'adjustment' THEN au.display_name
           WHEN 'sale' THEN su.display_name
           WHEN 'sale_void' THEN vu.display_name
           WHEN 'sale_return' THEN ru.display_name
           WHEN 'goods_receipt' THEN gu.display_name
         END AS actor_name,
         CASE l.movement_type
           WHEN 'adjustment' THEN a.notes
           WHEN 'sale_void' THEN sv.reason
           WHEN 'sale_return' THEN sr.reason
           WHEN 'goods_receipt' THEN gr.supplier_invoice_number
         END AS notes
       FROM ledger l
       LEFT JOIN stock_adjustment_items sai
         ON l.source_table = 'stock_adjustment_item' AND sai.stock_adjustment_item_id = l.source_id
       LEFT JOIN stock_adjustments a ON a.stock_adjustment_id = sai.stock_adjustment_id
       LEFT JOIN adjustment_reasons ar ON ar.adjustment_reason_code = a.adjustment_reason_code
       LEFT JOIN users au ON au.user_id = a.adjusted_by_user_id
       LEFT JOIN sale_items si ON l.source_table = 'sale_item' AND si.sale_item_id = l.source_id
       LEFT JOIN sales s ON s.sale_id = si.sale_id
       LEFT JOIN users su ON su.user_id = s.cashier_user_id
       LEFT JOIN sale_voids sv ON sv.sale_id = si.sale_id AND l.movement_type = 'sale_void'
       LEFT JOIN users vu ON vu.user_id = sv.voided_by_user_id
       LEFT JOIN sale_return_items sri
         ON l.source_table = 'sale_return_item' AND sri.sale_return_item_id = l.source_id
       LEFT JOIN sale_returns sr ON sr.sale_return_id = sri.sale_return_id
       LEFT JOIN users ru ON ru.user_id = sr.processed_by_user_id
       LEFT JOIN goods_receipt_items gri
         ON l.source_table = 'goods_receipt_item' AND gri.goods_receipt_item_id = l.source_id
       LEFT JOIN goods_receipts gr ON gr.goods_receipt_id = gri.goods_receipt_id
       LEFT JOIN users gu ON gu.user_id = gr.posted_by_user_id
       ${typeFilter}
       ORDER BY l.seq DESC
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_STOCK_PAGE_SIZE, filter.offset ?? 0]
    )

    return {
      total,
      items: rows.map((row): InventoryMovement => ({
        movementType: row.movement_type,
        occurredAt: row.occurred_at,
        variantId: row.variant_id,
        quantityDeltaMilli: row.quantity_delta_milli,
        balanceAfterMilli: row.balance_after_milli,
        sourceTable: row.source_table,
        sourceId: row.source_id,
        documentNumber: row.document_number,
        reasonCode: row.reason_code,
        reasonName: row.reason_name,
        actorName: row.actor_name,
        notes: row.notes
      }))
    }
  }

  /** M14-04: record an immutable stock adjustment document and its lines. */
  createAdjustment(input: {
    reasonCode: AdjustmentReasonCode
    adjustedByUserId: number
    notes: string | null
    items: readonly { variantId: number; quantityDeltaMilli: number }[]
  }): StockAdjustmentDetail {
    const adjustmentNumber = this.nextDocumentNumber('stock_adjustment', (candidate) =>
      this.adjustmentNumberExists(candidate)
    )
    const stockAdjustmentId = this.insert('stock_adjustments', {
      adjustment_number: adjustmentNumber,
      adjustment_reason_code: input.reasonCode,
      adjusted_at: this.now(),
      adjusted_by_user_id: input.adjustedByUserId,
      notes: input.notes
    })
    for (const line of input.items) {
      this.insert('stock_adjustment_items', {
        stock_adjustment_id: stockAdjustmentId,
        variant_id: line.variantId,
        quantity_delta_milli: line.quantityDeltaMilli
      })
    }
    const created = this.getAdjustment(stockAdjustmentId)
    if (!created) throw new Error(`Stock adjustment ${stockAdjustmentId} not found after insert`)
    return created
  }

  getAdjustment(stockAdjustmentId: number): StockAdjustmentDetail | null {
    const header = this.db.get<AdjustmentHeaderRow>(
      `SELECT a.stock_adjustment_id, a.adjustment_number, a.adjustment_reason_code,
              r.name AS reason_name, a.adjusted_at, u.display_name AS adjusted_by_name, a.notes
       FROM stock_adjustments a
       JOIN adjustment_reasons r ON r.adjustment_reason_code = a.adjustment_reason_code
       JOIN users u ON u.user_id = a.adjusted_by_user_id
       WHERE a.stock_adjustment_id = ?`,
      [stockAdjustmentId]
    )
    if (!header) return null
    return this.attachAdjustmentLines(header)
  }

  listAdjustments(filter: AdjustmentListFilter = {}): AdjustmentListPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (filter.reasonCode) {
      where.push('a.adjustment_reason_code = ?')
      params.push(filter.reasonCode)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const total =
      this.db.get<{ n: number }>(
        `SELECT count(*) AS n FROM stock_adjustments a ${whereSql}`,
        params
      )?.n ?? 0
    const headers = this.db.all<AdjustmentHeaderRow>(
      `SELECT a.stock_adjustment_id, a.adjustment_number, a.adjustment_reason_code,
              r.name AS reason_name, a.adjusted_at, u.display_name AS adjusted_by_name, a.notes
       FROM stock_adjustments a
       JOIN adjustment_reasons r ON r.adjustment_reason_code = a.adjustment_reason_code
       JOIN users u ON u.user_id = a.adjusted_by_user_id
       ${whereSql}
       ORDER BY a.adjusted_at DESC, a.stock_adjustment_id DESC
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_STOCK_PAGE_SIZE, filter.offset ?? 0]
    )
    return {
      total,
      items: headers.map((header) => this.attachAdjustmentLines(header))
    }
  }

  /**
   * M14-08: verify that every tracked variant's stock-on-hand balance equals
   * the sum of its ledger movements. Returns any mismatches (always empty in 3NF).
   */
  findLedgerMismatches(): { variantId: number; onHandMilli: number; ledgerSumMilli: number }[] {
    return this.db
      .all<{ variant_id: number; on_hand_milli: number; ledger_sum_milli: number }>(
        `SELECT s.variant_id, s.on_hand_milli,
                (SELECT coalesce(sum(m.quantity_delta_milli), 0)
                 FROM v_inventory_movements m WHERE m.variant_id = s.variant_id) AS ledger_sum_milli
         FROM v_stock_on_hand s
         WHERE s.on_hand_milli <> (
           SELECT coalesce(sum(m.quantity_delta_milli), 0)
           FROM v_inventory_movements m WHERE m.variant_id = s.variant_id
         )`
      )
      .map((row) => ({
        variantId: row.variant_id,
        onHandMilli: row.on_hand_milli,
        ledgerSumMilli: row.ledger_sum_milli
      }))
  }

  private adjustmentNumberExists(adjustmentNumber: string): boolean {
    return (
      this.db.get<{ n: number }>(
        'SELECT 1 AS n FROM stock_adjustments WHERE adjustment_number = ?',
        [adjustmentNumber]
      ) !== undefined
    )
  }

  private attachAdjustmentLines(header: AdjustmentHeaderRow): StockAdjustmentDetail {
    const lines = this.db.all<AdjustmentLineRow>(
      `SELECT i.variant_id, p.name AS product_name, v.variant_name, v.sku, v.unit_code,
              i.quantity_delta_milli, ${ON_HAND_SUBQUERY} AS on_hand_milli
       FROM stock_adjustment_items i
       JOIN product_variants v ON v.variant_id = i.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE i.stock_adjustment_id = ?
       ORDER BY i.stock_adjustment_item_id`,
      [header.stock_adjustment_id]
    )
    return {
      stockAdjustmentId: header.stock_adjustment_id,
      adjustmentNumber: header.adjustment_number,
      reasonCode: header.adjustment_reason_code,
      reasonName: header.reason_name,
      adjustedAt: header.adjusted_at,
      adjustedByName: header.adjusted_by_name,
      notes: header.notes,
      items: lines.map((line): StockAdjustmentLineDetail => ({
        variantId: line.variant_id,
        name: itemName(line.product_name, line.variant_name),
        sku: line.sku,
        unitCode: line.unit_code,
        quantityDeltaMilli: line.quantity_delta_milli,
        onHandAfterMilli: line.on_hand_milli
      }))
    }
  }
}
