import type {
  CostHistory,
  GoodsReceiptDetail,
  GoodsReceiptInput,
  GoodsReceiptListFilter,
  GoodsReceiptListPage,
  GoodsReceiptPostInput,
  PurchaseLineInput,
  PurchaseOrderCancelInput,
  PurchaseOrderDetail,
  PurchaseOrderInput,
  PurchaseOrderListFilter,
  PurchaseOrderListPage
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { formatMoney, multiplyByQuantity, type CurrencyFormat } from '@shared/money'
import { formatQuantity, QUANTITY_SCALE } from '@shared/quantity'
import type { AuditLog } from '../audit/auditLog'
import { changesBetween, MAX_LISTED_LINES, summariseLines } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import { conflict, invalid } from '../catalog/catalogService'
import type { Database } from '../db/database'
import type { PurchaseRepository, PurchaseVariant } from './purchaseRepository'
import type { SupplierRepository } from './supplierRepository'

export interface PurchaseServiceDeps {
  db: Database
  purchases: PurchaseRepository
  suppliers: SupplierRepository
  audit: AuditLog
  /** The store's currency, for amounts in audit entries. */
  currency: () => CurrencyFormat
}

const DEFAULT_COST_HISTORY_LIMIT = 50

/**
 * Purchase orders and goods receipts (M15-02 to M15-05).
 *
 * - A **draft** order or receipt can be edited or deleted and has no effect on
 *   stock. A **confirmed** order is a fixed request to a supplier; it can only
 *   be closed or cancelled.
 * - **Posting** a goods receipt is the one action that adds stock, and it is a
 *   single transaction: the receipt is frozen, the stock ledger (which reads
 *   posted receipts) gains its lines, an order that is now fully received
 *   closes, and the audit entry is written. If any step fails, nothing is kept.
 * - Only active, stock-tracked items can be bought, in whole numbers where
 *   their unit needs it. Costs are recorded as paid, before any GST input
 *   credit.
 */
export class PurchaseService {
  constructor(private readonly deps: PurchaseServiceDeps) {}

  // ---- Reading -------------------------------------------------------------

  listOrders(actor: Actor, filter: PurchaseOrderListFilter = {}): PurchaseOrderListPage {
    assertCan(actor, 'purchase.view')
    return this.deps.purchases.listOrders(filter)
  }

  getOrder(actor: Actor, { purchaseOrderId }: { purchaseOrderId: number }): PurchaseOrderDetail {
    assertCan(actor, 'purchase.view')
    return this.requireOrder(purchaseOrderId)
  }

  listReceipts(actor: Actor, filter: GoodsReceiptListFilter = {}): GoodsReceiptListPage {
    assertCan(actor, 'purchase.view')
    return this.deps.purchases.listReceipts(filter)
  }

  getReceipt(actor: Actor, { goodsReceiptId }: { goodsReceiptId: number }): GoodsReceiptDetail {
    assertCan(actor, 'purchase.view')
    return this.requireReceipt(goodsReceiptId)
  }

  /** M15-05: what an item has cost on posted receipts, newest first. */
  costHistory(
    actor: Actor,
    { variantId, limit }: { variantId: number; limit?: number | undefined }
  ): CostHistory {
    assertCan(actor, 'purchase.view')
    const history = this.deps.purchases.costHistory(variantId, limit ?? DEFAULT_COST_HISTORY_LIMIT)
    if (!history) throw new AppError('NOT_FOUND', 'That item no longer exists.')
    return history
  }

  // ---- Purchase orders -----------------------------------------------------

  /** M15-02: create a draft order, or replace a draft's contents; optionally confirm it. */
  saveOrder(actor: Actor, input: PurchaseOrderInput): PurchaseOrderDetail {
    assertCan(actor, 'purchase.manage')
    const { db, purchases, audit } = this.deps
    const purchaseOrderId = db.transaction(() => {
      this.requireActiveSupplier(input.supplierId)
      const variants = this.checkLines(input.lines)
      let id: number
      if (input.purchaseOrderId === undefined) {
        id = purchases.createOrder({
          supplierId: input.supplierId,
          userId: actor.userId,
          notes: input.notes,
          lines: input.lines
        })
        const created = this.requireOrder(id)
        audit.change({
          action: 'purchase_order.created',
          actor,
          entity: { type: 'purchase_order', id },
          details: {
            orderNumber: created.orderNumber,
            supplier: created.supplierName,
            ...(created.notes ? { notes: created.notes } : {}),
            ...summariseLines(this.describeLines(input.lines, variants)),
            total: this.money(created.totalMinor)
          }
        })
      } else {
        id = input.purchaseOrderId
        const before = this.requireOrder(id)
        if (before.status !== 'draft') {
          throw new AppError(
            'CONFLICT',
            `Order ${before.orderNumber} is ${before.status}, so it can no longer be edited.`
          )
        }
        purchases.replaceOrder(id, {
          supplierId: input.supplierId,
          notes: input.notes,
          lines: input.lines
        })
        const after = this.requireOrder(id)
        audit.change({
          action: 'purchase_order.updated',
          actor,
          entity: { type: 'purchase_order', id },
          details: {
            orderNumber: after.orderNumber,
            changes:
              changesBetween(
                {
                  supplier: before.supplierName,
                  notes: before.notes,
                  total: this.money(before.totalMinor)
                },
                {
                  supplier: after.supplierName,
                  notes: after.notes,
                  total: this.money(after.totalMinor)
                }
              ) ?? {},
            ...summariseLines(this.describeLines(input.lines, variants))
          }
        })
      }
      if (input.confirm) this.confirmInTransaction(actor, id)
      return id
    })
    return this.requireOrder(purchaseOrderId)
  }

  /** M15-02: confirm a draft order. Confirmed orders are fixed. */
  confirmOrder(
    actor: Actor,
    { purchaseOrderId }: { purchaseOrderId: number }
  ): PurchaseOrderDetail {
    assertCan(actor, 'purchase.manage')
    this.deps.db.transaction(() => this.confirmInTransaction(actor, purchaseOrderId))
    return this.requireOrder(purchaseOrderId)
  }

  /** Cancel a confirmed order that nothing has arrived for. */
  cancelOrder(actor: Actor, input: PurchaseOrderCancelInput): PurchaseOrderDetail {
    assertCan(actor, 'purchase.manage')
    const { db, purchases, audit } = this.deps
    db.transaction(() => {
      const order = this.requireOrder(input.purchaseOrderId)
      if (order.status === 'draft') {
        throw new AppError('CONFLICT', 'A draft order is deleted, not cancelled.')
      }
      this.assertOpen(order.orderNumber, order.status)
      const counts = purchases.countOrderReceipts(order.purchaseOrderId)
      if (counts.posted > 0) {
        throw new AppError(
          'CONFLICT',
          `Goods have already arrived for order ${order.orderNumber}, so it can't be cancelled. Close it instead.`
        )
      }
      this.assertNoDraftReceipts(order.orderNumber, counts.drafts)
      purchases.cancelOrder(order.purchaseOrderId)
      audit.change({
        action: 'purchase_order.cancelled',
        actor,
        entity: { type: 'purchase_order', id: order.purchaseOrderId },
        details: {
          orderNumber: order.orderNumber,
          supplier: order.supplierName,
          ...(input.reason ? { reason: input.reason } : {})
        }
      })
    })
    return this.requireOrder(input.purchaseOrderId)
  }

  /** Close a confirmed order without receiving the rest (the supplier won't send it). */
  closeOrder(actor: Actor, { purchaseOrderId }: { purchaseOrderId: number }): PurchaseOrderDetail {
    assertCan(actor, 'purchase.manage')
    const { db, purchases, audit } = this.deps
    db.transaction(() => {
      const order = this.requireOrder(purchaseOrderId)
      if (order.status === 'draft') {
        throw new AppError('CONFLICT', 'Confirm the order before closing it, or delete the draft.')
      }
      this.assertOpen(order.orderNumber, order.status)
      this.assertNoDraftReceipts(
        order.orderNumber,
        purchases.countOrderReceipts(purchaseOrderId).drafts
      )
      purchases.closeOrder(purchaseOrderId)
      audit.change({
        action: 'purchase_order.closed',
        actor,
        entity: { type: 'purchase_order', id: purchaseOrderId },
        details: {
          orderNumber: order.orderNumber,
          supplier: order.supplierName,
          reason: 'closed by hand'
        }
      })
    })
    return this.requireOrder(purchaseOrderId)
  }

  deleteOrder(actor: Actor, { purchaseOrderId }: { purchaseOrderId: number }): void {
    assertCan(actor, 'purchase.manage')
    const { db, purchases, audit } = this.deps
    db.transaction(() => {
      const order = this.requireOrder(purchaseOrderId)
      if (order.status !== 'draft') {
        throw new AppError(
          'CONFLICT',
          `Order ${order.orderNumber} is ${order.status}. Only a draft can be deleted; cancel a confirmed order instead.`
        )
      }
      purchases.deleteOrder(purchaseOrderId)
      audit.change({
        action: 'purchase_order.deleted',
        actor,
        entity: { type: 'purchase_order', id: purchaseOrderId },
        details: { orderNumber: order.orderNumber, supplier: order.supplierName }
      })
    })
  }

  // ---- Goods receipts ------------------------------------------------------

  /**
   * M15-03, M15-04: save a draft receipt (against an order, or a direct
   * purchase), or replace a draft's contents; optionally post it.
   */
  saveReceipt(actor: Actor, input: GoodsReceiptInput): GoodsReceiptDetail {
    assertCan(actor, 'purchase.manage')
    const { db, purchases, audit } = this.deps
    const goodsReceiptId = db.transaction(() => {
      const supplier = this.requireActiveSupplier(input.supplierId)
      const variants = this.checkLines(input.lines)
      if (input.purchaseOrderId !== null) {
        this.checkAgainstOrder(input.purchaseOrderId, input.supplierId, input.lines, variants)
      }
      const existing =
        input.goodsReceiptId === undefined ? null : this.requireReceipt(input.goodsReceiptId)
      if (existing && existing.status !== 'draft') {
        throw new AppError(
          'CONFLICT',
          `Receipt ${existing.receiptNumber} has been posted and can't be changed.`
        )
      }
      if (input.supplierInvoiceNumber) {
        const duplicate = purchases.findReceiptBySupplierInvoice(
          input.supplierId,
          input.supplierInvoiceNumber
        )
        if (duplicate && duplicate.goodsReceiptId !== existing?.goodsReceiptId) {
          throw conflict(
            'supplierInvoiceNumber',
            `Supplier bill ${input.supplierInvoiceNumber} was already entered as ${duplicate.receiptNumber}`
          )
        }
      }

      let id: number
      if (existing) {
        id = existing.goodsReceiptId
        purchases.replaceReceipt(id, input)
        const after = this.requireReceipt(id)
        audit.change({
          action: 'goods_receipt.updated',
          actor,
          entity: { type: 'goods_receipt', id },
          details: {
            receiptNumber: after.receiptNumber,
            changes:
              changesBetween(
                {
                  supplier: existing.supplierName,
                  order: existing.orderNumber,
                  supplierBill: existing.supplierInvoiceNumber,
                  supplierBillDate: existing.supplierInvoiceDate,
                  total: this.money(existing.totalMinor)
                },
                {
                  supplier: after.supplierName,
                  order: after.orderNumber,
                  supplierBill: after.supplierInvoiceNumber,
                  supplierBillDate: after.supplierInvoiceDate,
                  total: this.money(after.totalMinor)
                }
              ) ?? {},
            ...summariseLines(this.describeLines(input.lines, variants))
          }
        })
      } else {
        id = purchases.createReceipt({
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId,
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          supplierInvoiceDate: input.supplierInvoiceDate,
          userId: actor.userId,
          lines: input.lines
        })
        const created = this.requireReceipt(id)
        audit.change({
          action: 'goods_receipt.created',
          actor,
          entity: { type: 'goods_receipt', id },
          details: {
            receiptNumber: created.receiptNumber,
            supplier: supplier.name,
            ...(created.orderNumber ? { order: created.orderNumber } : {}),
            ...(created.supplierInvoiceNumber
              ? { supplierBill: created.supplierInvoiceNumber }
              : {}),
            ...summariseLines(this.describeLines(input.lines, variants)),
            total: this.money(created.totalMinor)
          }
        })
      }
      if (input.post) this.postInTransaction(actor, id, input.updateCosts === true)
      return id
    })
    return this.requireReceipt(goodsReceiptId)
  }

  /** M15-03: post a saved draft receipt, adding its goods to stock. */
  postReceipt(actor: Actor, input: GoodsReceiptPostInput): GoodsReceiptDetail {
    assertCan(actor, 'purchase.manage')
    this.deps.db.transaction(() =>
      this.postInTransaction(actor, input.goodsReceiptId, input.updateCosts === true)
    )
    return this.requireReceipt(input.goodsReceiptId)
  }

  deleteReceipt(actor: Actor, { goodsReceiptId }: { goodsReceiptId: number }): void {
    assertCan(actor, 'purchase.manage')
    const { db, purchases, audit } = this.deps
    db.transaction(() => {
      const receipt = this.requireReceipt(goodsReceiptId)
      if (receipt.status !== 'draft') {
        throw new AppError(
          'CONFLICT',
          `Receipt ${receipt.receiptNumber} has been posted and can't be deleted. Record a stock adjustment to correct it.`
        )
      }
      purchases.deleteReceipt(goodsReceiptId)
      audit.change({
        action: 'goods_receipt.deleted',
        actor,
        entity: { type: 'goods_receipt', id: goodsReceiptId },
        details: { receiptNumber: receipt.receiptNumber, supplier: receipt.supplierName }
      })
    })
  }

  // ---- Internals -----------------------------------------------------------

  private confirmInTransaction(actor: Actor, purchaseOrderId: number): void {
    const { purchases, audit } = this.deps
    const order = this.requireOrder(purchaseOrderId)
    if (order.status !== 'draft') {
      throw new AppError('CONFLICT', `Order ${order.orderNumber} is already ${order.status}.`)
    }
    if (order.lines.length === 0) {
      throw invalid('lines', 'Add at least one item before confirming the order')
    }
    this.requireActiveSupplier(order.supplierId)
    this.checkLines(order.lines)
    purchases.confirmOrder(purchaseOrderId)
    audit.change({
      action: 'purchase_order.confirmed',
      actor,
      entity: { type: 'purchase_order', id: purchaseOrderId },
      details: {
        orderNumber: order.orderNumber,
        supplier: order.supplierName,
        total: this.money(order.totalMinor)
      }
    })
  }

  private postInTransaction(actor: Actor, goodsReceiptId: number, updateCosts: boolean): void {
    const { purchases, audit } = this.deps
    const receipt = this.requireReceipt(goodsReceiptId)
    if (receipt.status !== 'draft') {
      throw new AppError('CONFLICT', `Receipt ${receipt.receiptNumber} was already posted.`)
    }
    if (receipt.lines.length === 0) throw invalid('lines', 'Add at least one item before posting')
    this.requireActiveSupplier(receipt.supplierId, 'Restore the supplier before receiving goods')
    const lines = receipt.lines.map((line) => ({
      variantId: line.variantId,
      quantityMilli: line.quantityMilli,
      unitCostMinor: line.unitCostMinor
    }))
    const variants = this.checkLines(lines)
    if (receipt.purchaseOrderId !== null) {
      this.checkAgainstOrder(receipt.purchaseOrderId, receipt.supplierId, lines, variants)
    }

    const costUpdates: { item: string; from: string | null; to: string }[] = []
    if (updateCosts) {
      assertCan(actor, 'product.manage')
      for (const line of lines) {
        const variant = variants.get(line.variantId)
        if (variant && variant.costPriceMinor !== line.unitCostMinor) {
          costUpdates.push({
            item: variant.name,
            from: variant.costPriceMinor === null ? null : this.money(variant.costPriceMinor),
            to: this.money(line.unitCostMinor)
          })
          purchases.setVariantCost(line.variantId, line.unitCostMinor)
        }
      }
    }

    purchases.postReceipt(goodsReceiptId, actor.userId)

    let orderClosed = false
    if (
      receipt.purchaseOrderId !== null &&
      purchases.isOrderFullyReceived(receipt.purchaseOrderId)
    ) {
      purchases.closeOrder(receipt.purchaseOrderId)
      orderClosed = true
      audit.change({
        action: 'purchase_order.closed',
        actor,
        entity: { type: 'purchase_order', id: receipt.purchaseOrderId },
        details: {
          orderNumber: receipt.orderNumber,
          supplier: receipt.supplierName,
          reason: `fully received on ${receipt.receiptNumber}`
        }
      })
    }

    audit.change({
      action: 'goods_receipt.posted',
      actor,
      entity: { type: 'goods_receipt', id: goodsReceiptId },
      details: {
        receiptNumber: receipt.receiptNumber,
        supplier: receipt.supplierName,
        ...(receipt.orderNumber ? { order: receipt.orderNumber } : {}),
        ...(receipt.supplierInvoiceNumber ? { supplierBill: receipt.supplierInvoiceNumber } : {}),
        ...summariseLines(this.describeLines(lines, variants)),
        total: this.money(receipt.totalMinor),
        ...(costUpdates.length > 0
          ? {
              costPricesUpdated: costUpdates.slice(0, MAX_LISTED_LINES),
              ...(costUpdates.length > MAX_LISTED_LINES
                ? { costPricesUpdatedCount: costUpdates.length }
                : {})
            }
          : {}),
        ...(orderClosed ? { orderClosed: true } : {})
      }
    })
  }

  /**
   * Every line must be an active, stock-tracked item, in whole numbers where
   * its unit needs them. Returns the items by id.
   */
  private checkLines(lines: readonly PurchaseLineInput[]): Map<number, PurchaseVariant> {
    const variants = new Map<number, PurchaseVariant>()
    lines.forEach((line, index) => {
      const variant = this.deps.purchases.findVariant(line.variantId)
      if (!variant) throw invalid(`lines.${index}.variantId`, 'Choose an item')
      if (!variant.active) {
        throw new AppError(
          'CONFLICT',
          `${variant.name} is archived. Restore it before buying more.`
        )
      }
      if (!variant.tracksInventory) {
        throw new AppError(
          'CONFLICT',
          `Stock is not tracked for ${variant.name}, so it can't be on a purchase.`
        )
      }
      if (!variant.allowsFraction && line.quantityMilli % QUANTITY_SCALE !== 0) {
        throw invalid(`lines.${index}.quantityMilli`, 'This item is counted in whole numbers')
      }
      variants.set(variant.variantId, variant)
    })
    return variants
  }

  /** A receipt against an order: the order must be open, from this supplier, and list each item. */
  private checkAgainstOrder(
    purchaseOrderId: number,
    supplierId: number,
    lines: readonly PurchaseLineInput[],
    variants: ReadonlyMap<number, PurchaseVariant>
  ): void {
    const order = this.requireOrder(purchaseOrderId)
    if (order.supplierId !== supplierId) {
      throw invalid('purchaseOrderId', `Order ${order.orderNumber} is for a different supplier`)
    }
    if (order.status !== 'confirmed') {
      throw new AppError(
        'CONFLICT',
        order.status === 'draft'
          ? `Order ${order.orderNumber} is still a draft. Confirm it before receiving goods.`
          : `Order ${order.orderNumber} is ${order.status}, so goods can't be received against it.`
      )
    }
    const onOrder = new Set(order.lines.map((line) => line.variantId))
    lines.forEach((line, index) => {
      if (!onOrder.has(line.variantId)) {
        throw invalid(
          `lines.${index}.variantId`,
          `${variants.get(line.variantId)?.name ?? 'This item'} is not on order ${order.orderNumber}. Record it as a direct purchase instead.`
        )
      }
    })
  }

  private assertOpen(orderNumber: string, status: string): void {
    if (status !== 'confirmed') {
      throw new AppError('CONFLICT', `Order ${orderNumber} is already ${status}.`)
    }
  }

  private assertNoDraftReceipts(orderNumber: string, drafts: number): void {
    if (drafts > 0) {
      throw new AppError(
        'CONFLICT',
        `Order ${orderNumber} has ${drafts === 1 ? 'a draft goods receipt' : `${drafts} draft goods receipts`}. Post or delete ${drafts === 1 ? 'it' : 'them'} first.`
      )
    }
  }

  private describeLines(
    lines: readonly PurchaseLineInput[],
    variants: ReadonlyMap<number, PurchaseVariant>
  ): { item: string; quantity: string; unitCost: string; total: string }[] {
    return lines.map((line) => {
      const variant = variants.get(line.variantId)
      return {
        item: variant?.name ?? `Item ${line.variantId}`,
        quantity: `${formatQuantity(line.quantityMilli)} ${variant?.unitCode ?? ''}`.trim(),
        unitCost: this.money(line.unitCostMinor),
        total: this.money(multiplyByQuantity(line.unitCostMinor, line.quantityMilli))
      }
    })
  }

  private money(minor: number): string {
    return formatMoney(minor, this.deps.currency())
  }

  private requireActiveSupplier(
    supplierId: number,
    archivedMessage = 'Restore the supplier before using them on a new document'
  ): { supplierId: number; name: string } {
    const supplier = this.deps.suppliers.find(supplierId)
    if (!supplier) throw invalid('supplierId', 'Choose a supplier')
    if (!supplier.active) {
      throw new AppError('CONFLICT', `${supplier.name} is archived. ${archivedMessage}.`)
    }
    return supplier
  }

  private requireOrder(purchaseOrderId: number): PurchaseOrderDetail {
    const found = this.deps.purchases.getOrder(purchaseOrderId)
    if (!found) throw new AppError('NOT_FOUND', 'That purchase order no longer exists.')
    return found
  }

  private requireReceipt(goodsReceiptId: number): GoodsReceiptDetail {
    const found = this.deps.purchases.getReceipt(goodsReceiptId)
    if (!found) throw new AppError('NOT_FOUND', 'That goods receipt no longer exists.')
    return found
  }
}
