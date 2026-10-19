import type {
  AdjustmentListFilter,
  AdjustmentListPage,
  AdjustmentReason,
  MovementListFilter,
  MovementListPage,
  StockAdjustmentDetail,
  StockAdjustmentInput,
  StockCountInput,
  StockListFilter,
  StockListPage
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { formatQuantity, QUANTITY_SCALE } from '@shared/quantity'
import type { AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import { invalid } from '../catalog/catalogService'
import type { Database } from '../db/database'
import type { StoreRepository } from '../store/storeRepository'
import type { InventoryRepository, VariantStockInfo } from './inventoryRepository'

export interface InventoryServiceDeps {
  db: Database
  inventory: InventoryRepository
  store: StoreRepository
  audit: AuditLog
}

function formatSignedQuantity(milli: number): string {
  return `${milli > 0 ? '+' : ''}${formatQuantity(milli)}`
}

/**
 * Stock levels, movements, adjustments and physical stock counts (M14-01 to
 * M14-08).
 *
 * Every stock movement is recorded as a document line (`sale_items`,
 * `sale_voids`, `sale_return_items`, `goods_receipt_items`,
 * `stock_adjustment_items`) and surfaced through `v_inventory_movements` and
 * `v_stock_on_hand`. This service is the single entry point for manual stock
 * changes, physical count reconciliation and negative-stock enforcement.
 */
export class InventoryService {
  constructor(private readonly deps: InventoryServiceDeps) {}

  listReasons(actor: Actor): AdjustmentReason[] {
    assertCan(actor, 'inventory.view')
    return this.deps.inventory.listReasons()
  }

  /** M14-02, M14-05: current stock and low-stock list. */
  list(actor: Actor, filter: StockListFilter = {}): StockListPage {
    assertCan(actor, 'inventory.view')
    return this.deps.inventory.listStock(filter)
  }

  /** M14-07: movement history for one item, newest first. */
  movements(actor: Actor, filter: MovementListFilter): MovementListPage {
    assertCan(actor, 'inventory.view')
    const variant = this.requireTrackedVariant(filter.variantId)
    const page = this.deps.inventory.listMovements(filter)
    return {
      variantId: variant.variantId,
      name: variant.name,
      sku: variant.sku,
      unitCode: variant.unitCode,
      allowsFraction: variant.allowsFraction,
      onHandMilli: variant.onHandMilli,
      reorderLevelMilli: variant.reorderLevelMilli,
      items: page.items,
      total: page.total
    }
  }

  listAdjustments(actor: Actor, filter: AdjustmentListFilter = {}): AdjustmentListPage {
    assertCan(actor, 'inventory.view')
    return this.deps.inventory.listAdjustments(filter)
  }

  /**
   * M14-01, M14-03: check whether an outgoing stock movement (a sale or a
   * downward stock adjustment) is allowed under the store's negative-stock
   * policy. Aggregates duplicate lines for the same variant before checking.
   */
  assertOutflowAllowed(lines: readonly { variantId: number; quantityMilli: number }[]): void {
    const neededByVariant = new Map<number, number>()
    for (const line of lines) {
      if (line.quantityMilli <= 0) continue
      neededByVariant.set(
        line.variantId,
        (neededByVariant.get(line.variantId) ?? 0) + line.quantityMilli
      )
    }
    if (neededByVariant.size === 0) return

    const allowNegativeStock = this.deps.store.get()?.allowNegativeStock ?? false
    if (allowNegativeStock) return

    for (const [variantId, neededMilli] of neededByVariant) {
      const variant = this.deps.inventory.findVariantStock(variantId)
      if (!variant) throw new AppError('NOT_FOUND', 'That item no longer exists.')
      if (!variant.tracksInventory) continue
      if (variant.onHandMilli - neededMilli < 0) {
        throw new AppError(
          'CONFLICT',
          `Not enough ${variant.name} in stock (${formatQuantity(variant.onHandMilli)} ${variant.unitCode} on hand, ${formatQuantity(neededMilli)} ${variant.unitCode} needed).`,
          {
            field: 'quantityDeltaMilli',
            variantId,
            onHandMilli: variant.onHandMilli,
            requestedMilli: neededMilli
          }
        )
      }
    }
  }

  /** M14-04: adjust stock for one or more items with a reason and audit log entry. */
  adjust(actor: Actor, input: StockAdjustmentInput): StockAdjustmentDetail {
    assertCan(actor, 'stock.adjust')
    const { db, inventory, audit } = this.deps
    return db.transaction(() => {
      const reason = inventory.findReason(input.reasonCode)
      if (!reason) throw invalid('reasonCode', 'Choose a reason for the adjustment')

      input.items.forEach((line, index) => {
        const variant = this.requireActiveTrackedVariant(line.variantId, `items.${index}.variantId`)
        if (!variant.allowsFraction && Math.abs(line.quantityDeltaMilli) % QUANTITY_SCALE !== 0) {
          throw invalid(
            `items.${index}.quantityDeltaMilli`,
            'This item is counted in whole numbers'
          )
        }
      })

      this.assertOutflowAllowed(
        input.items
          .filter((line) => line.quantityDeltaMilli < 0)
          .map((line) => ({ variantId: line.variantId, quantityMilli: -line.quantityDeltaMilli }))
      )

      const created = inventory.createAdjustment({
        reasonCode: input.reasonCode,
        adjustedByUserId: actor.userId,
        notes: input.notes,
        items: input.items
      })

      audit.change({
        action: 'stock.adjusted',
        actor,
        entity: { type: 'stock_adjustment', id: created.stockAdjustmentId },
        details: {
          adjustmentNumber: created.adjustmentNumber,
          reason: created.reasonName,
          ...(created.notes ? { notes: created.notes } : {}),
          items: created.items.map((item) => ({
            item: item.name,
            change: `${formatSignedQuantity(item.quantityDeltaMilli)} ${item.unitCode}`,
            onHandAfter: `${formatQuantity(item.onHandAfterMilli)} ${item.unitCode}`
          }))
        }
      })

      return created
    })
  }

  /**
   * M14-06: reconcile physical stock counts against recorded stock. Computes
   * each item's variance inside the transaction, records a `count_correction`
   * stock adjustment for items with a non-zero variance, and returns null when
   * every counted item already matches its recorded stock.
   */
  reconcile(actor: Actor, input: StockCountInput): StockAdjustmentDetail | null {
    assertCan(actor, 'stock.adjust')
    const { db, inventory, audit } = this.deps
    return db.transaction(() => {
      const variances: {
        variant: VariantStockInfo
        recordedMilli: number
        countedMilli: number
        quantityDeltaMilli: number
      }[] = []

      input.items.forEach((line, index) => {
        const variant = this.requireActiveTrackedVariant(line.variantId, `items.${index}.variantId`)
        if (!variant.allowsFraction && line.countedMilli % QUANTITY_SCALE !== 0) {
          throw invalid(`items.${index}.countedMilli`, 'This item is counted in whole numbers')
        }
        const quantityDeltaMilli = line.countedMilli - variant.onHandMilli
        if (quantityDeltaMilli !== 0) {
          variances.push({
            variant,
            recordedMilli: variant.onHandMilli,
            countedMilli: line.countedMilli,
            quantityDeltaMilli
          })
        }
      })

      if (variances.length === 0) return null

      this.assertOutflowAllowed(
        variances
          .filter((v) => v.quantityDeltaMilli < 0)
          .map((v) => ({ variantId: v.variant.variantId, quantityMilli: -v.quantityDeltaMilli }))
      )

      const created = inventory.createAdjustment({
        reasonCode: 'count_correction',
        adjustedByUserId: actor.userId,
        notes: input.notes,
        items: variances.map((v) => ({
          variantId: v.variant.variantId,
          quantityDeltaMilli: v.quantityDeltaMilli
        }))
      })

      audit.change({
        action: 'stock.counted',
        actor,
        entity: { type: 'stock_adjustment', id: created.stockAdjustmentId },
        details: {
          adjustmentNumber: created.adjustmentNumber,
          ...(created.notes ? { notes: created.notes } : {}),
          items: variances.map((v) => ({
            item: v.variant.name,
            recorded: `${formatQuantity(v.recordedMilli)} ${v.variant.unitCode}`,
            counted: `${formatQuantity(v.countedMilli)} ${v.variant.unitCode}`,
            change: `${formatSignedQuantity(v.quantityDeltaMilli)} ${v.variant.unitCode}`
          }))
        }
      })

      return created
    })
  }

  /** M14-08: check that every tracked variant's stock balance equals its ledger sum. */
  verifyLedgerConsistency(): {
    ok: boolean
    mismatches: { variantId: number; onHandMilli: number; ledgerSumMilli: number }[]
  } {
    const mismatches = this.deps.inventory.findLedgerMismatches()
    return { ok: mismatches.length === 0, mismatches }
  }

  private requireTrackedVariant(variantId: number): VariantStockInfo {
    const variant = this.deps.inventory.findVariantStock(variantId)
    if (!variant) throw new AppError('NOT_FOUND', 'That item no longer exists.')
    if (!variant.tracksInventory) {
      throw new AppError('CONFLICT', `Stock is not tracked for ${variant.name}.`)
    }
    return variant
  }

  private requireActiveTrackedVariant(variantId: number, field: string): VariantStockInfo {
    const variant = this.deps.inventory.findVariantStock(variantId)
    if (!variant) throw invalid(field, 'Choose an item')
    if (!variant.tracksInventory) {
      throw new AppError('CONFLICT', `Stock is not tracked for ${variant.name}.`)
    }
    if (!variant.active) {
      throw new AppError(
        'CONFLICT',
        `${variant.name} is archived. Restore it before adjusting stock.`
      )
    }
    return variant
  }
}
