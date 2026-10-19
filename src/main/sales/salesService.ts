import type {
  CheckoutInput,
  HeldBillDetail,
  HeldBillSummary,
  HoldBillInput,
  SaleDetail,
  SaleListFilter,
  SaleListPage,
  VoidSaleInput
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { DEFAULT_CURRENCY, formatMoney } from '@shared/money'
import { calculateBill, PricingError, type BillInput } from '@shared/pricing'
import type { AuditLog } from '../audit/auditLog'
import { assertCan, forbidden, type Actor } from '../auth/access'
import { invalid } from '../catalog/catalogService'
import type { Database } from '../db/database'
import type { InventoryService } from '../inventory/inventoryService'
import type { PaymentService } from '../payments/paymentService'
import type { PricingService } from '../pricing/pricingService'
import type { StoreRepository } from '../store/storeRepository'
import type { CheckoutVariantSnapshot, SalesRepository } from './salesRepository'

export interface SalesServiceDeps {
  db: Database
  sales: SalesRepository
  payments: PaymentService
  pricing: PricingService
  inventory: InventoryService
  store: StoreRepository
  audit: AuditLog
}

/**
 * Point of sale checkout, idempotency, held bills, sale voids and invoice
 * history (M11, M12, M13-01).
 */
export class SalesService {
  constructor(private readonly deps: SalesServiceDeps) {}

  /**
   * Complete a sale atomically (M11-07, M11-08, M13-01):
   *
   *  - Idempotent on `checkoutKey`: repeating the same key returns the already
   *    completed sale without deducting stock or issuing a second invoice.
   *  - Snapshots item descriptions, HSN codes, units, prices, discounts, costs
   *    and tax components onto `sale_items` and `sale_item_taxes`.
   *  - Enforces discount limits and price-override permissions (`M10-05`).
   *  - Enforces negative-stock policy (`M14-01`, `M14-03`).
   */
  checkout(actor: Actor, input: CheckoutInput): SaleDetail {
    assertCan(actor, 'sale.create')
    const { db, sales, payments, pricing, inventory, store, audit } = this.deps

    const existingId = sales.findSaleIdByCheckoutKey(input.checkoutKey)
    if (existingId !== null) return this.requireSale(existingId)

    const saleId = db.transaction(() => {
      const alreadySaved = sales.findSaleIdByCheckoutKey(input.checkoutKey)
      if (alreadySaved !== null) return alreadySaved

      const customerId = input.customerId ?? null
      if (customerId !== null) {
        const customer = sales.findCustomer(customerId)
        if (!customer || !customer.active) {
          throw invalid('customerId', 'Choose an active customer')
        }
      }

      const resolvedLines: Array<{
        reqLine: CheckoutInput['lines'][number]
        snapshot: CheckoutVariantSnapshot
      }> = input.lines.map((line, index) => {
        const variant = sales.findVariantForCheckout(line.variantId)
        if (!variant) {
          throw invalid(`lines.${index}.variantId`, 'One of the items on the bill no longer exists')
        }
        if (!variant.active) {
          throw invalid(
            `lines.${index}.variantId`,
            `“${variant.name}” has been archived and cannot be sold`
          )
        }
        if (!variant.allowsFraction && line.quantityMilli % 1000 !== 0) {
          throw invalid(
            `lines.${index}.quantityMilli`,
            `“${variant.name}” is sold in whole ${variant.unitCode} only`
          )
        }
        if (variant.mrpMinor !== null && line.unitPriceMinor > variant.mrpMinor) {
          throw invalid(
            `lines.${index}.unitPriceMinor`,
            `Price for “${variant.name}” cannot exceed its MRP`
          )
        }
        return { reqLine: line, snapshot: variant }
      })

      const rules = pricing.rules()
      const billInput: BillInput = {
        lines: resolvedLines.map(({ reqLine, snapshot }) => ({
          quantityMilli: reqLine.quantityMilli,
          unitPriceMinor: reqLine.unitPriceMinor,
          discount: reqLine.discount ?? null,
          tax: {
            rateBp: snapshot.rateBp,
            cessRateBp: snapshot.cessRateBp
          }
        })),
        billDiscount: input.billDiscount ?? null
      }

      let calculated
      try {
        calculated = calculateBill(billInput, rules)
      } catch (error) {
        if (error instanceof PricingError) {
          const path = error.line === null ? 'billDiscount' : `lines.${error.line}.discount`
          throw invalid(path, error.message)
        }
        throw error
      }

      pricing.authorizeBill(
        actor,
        resolvedLines.map(({ reqLine, snapshot }) => ({
          unitPriceMinor: reqLine.unitPriceMinor,
          catalogPriceMinor: snapshot.sellingPriceMinor
        })),
        calculated
      )

      const validatedPayments = payments.validateSalePayments(
        calculated.payableMinor,
        input.payments
      )

      inventory.assertOutflowAllowed(
        input.lines.map((line) => ({
          variantId: line.variantId,
          quantityMilli: line.quantityMilli
        }))
      )

      const createdId = sales.createSale({
        checkoutKey: input.checkoutKey,
        cashierUserId: actor.userId,
        customerId,
        pricesIncludeTax: rules.pricesIncludeTax,
        roundOffMinor: calculated.roundOffMinor,
        lines: calculated.lines.map((calcLine, index) => {
          const pair = resolvedLines[index]
          if (!pair) {
            throw new Error(`Missing resolved line at index ${index}`)
          }
          const { reqLine, snapshot } = pair
          return {
            variantId: snapshot.variantId,
            description: snapshot.name,
            hsnCode: snapshot.hsnCode,
            unitCode: snapshot.unitCode,
            quantityMilli: reqLine.quantityMilli,
            unitPriceMinor: reqLine.unitPriceMinor,
            discountMinor: calcLine.discountMinor,
            unitCostMinor: snapshot.costPriceMinor,
            taxes: calcLine.taxes
          }
        }),
        payments: validatedPayments,
        heldBillId: input.heldBillId ?? null
      })

      const saved = this.requireSale(createdId)
      const currency = store.get()?.currency ?? DEFAULT_CURRENCY
      audit.change({
        action: 'sale.created',
        actor,
        entity: { type: 'sale', id: createdId },
        details: {
          invoiceNumber: saved.invoiceNumber,
          items: saved.lines.length,
          total: formatMoney(saved.grandTotalMinor, currency),
          ...(saved.discountMinor > 0
            ? { discount: formatMoney(saved.discountMinor, currency) }
            : {})
        }
      })

      return createdId
    })

    return this.requireSale(saleId)
  }

  list(actor: Actor, filter: SaleListFilter): SaleListPage {
    assertCan(actor, 'sale.view')
    return this.deps.sales.list(filter)
  }

  get(actor: Actor, saleId: number): SaleDetail {
    assertCan(actor, 'sale.view')
    return this.requireSale(saleId)
  }

  findByInvoice(actor: Actor, invoiceNumber: string): SaleDetail | null {
    assertCan(actor, 'sale.view')
    return this.deps.sales.findByInvoice(invoiceNumber)
  }

  /**
   * Void a completed sale (M11-10). Never deletes the sale: inserts a
   * `sale_voids` reversal record, which restores stock via `v_inventory_movements`
   * and records an audit entry.
   */
  voidSale(actor: Actor, input: VoidSaleInput): SaleDetail {
    if (!actor.permissions.has('sale.void')) throw forbidden('sale.void', true)
    const { db, sales, store, audit } = this.deps

    db.transaction(() => {
      const before = this.requireSale(input.saleId)
      if (before.voidInfo !== null) {
        throw new AppError('CONFLICT', `Invoice ${before.invoiceNumber} has already been voided.`)
      }
      if (sales.hasReturns(input.saleId)) {
        throw new AppError(
          'CONFLICT',
          `Invoice ${before.invoiceNumber} has returns and cannot be voided.`
        )
      }

      sales.voidSale({
        saleId: input.saleId,
        voidedByUserId: actor.userId,
        approvedByUserId: actor.override?.approvedBy.userId ?? null,
        reason: input.reason
      })

      const currency = store.get()?.currency ?? DEFAULT_CURRENCY
      audit.change({
        action: 'sale.voided',
        actor,
        entity: { type: 'sale', id: input.saleId },
        details: {
          invoiceNumber: before.invoiceNumber,
          total: formatMoney(before.grandTotalMinor, currency),
          reason: input.reason
        }
      })
    })

    return this.requireSale(input.saleId)
  }

  holdBill(actor: Actor, input: HoldBillInput): HeldBillSummary {
    assertCan(actor, 'sale.create')
    const { db, sales } = this.deps
    return db.transaction(() => {
      const customerId = input.customerId ?? null
      if (customerId !== null) {
        const customer = sales.findCustomer(customerId)
        if (!customer || !customer.active) {
          throw invalid('customerId', 'Choose an active customer')
        }
      }
      input.items.forEach((line, index) => {
        const variant = sales.findVariantForCheckout(line.variantId)
        if (!variant || !variant.active) {
          throw invalid(`items.${index}.variantId`, 'Choose an active product')
        }
        if (!variant.allowsFraction && line.quantityMilli % 1000 !== 0) {
          throw invalid(
            `items.${index}.quantityMilli`,
            `“${variant.name}” is sold in whole ${variant.unitCode} only`
          )
        }
      })
      return sales.holdBill({
        label: input.label,
        customerId,
        heldByUserId: actor.userId,
        items: input.items
      })
    })
  }

  listHeldBills(actor: Actor): HeldBillSummary[] {
    assertCan(actor, 'sale.create')
    return this.deps.sales.listHeldBills()
  }

  resumeHeldBill(actor: Actor, heldBillId: number): HeldBillDetail {
    assertCan(actor, 'sale.create')
    const { db, sales } = this.deps
    return db.transaction(() => {
      const held = sales.getHeldBill(heldBillId)
      if (!held) throw new AppError('NOT_FOUND', 'That held bill was not found.')
      sales.deleteHeldBill(heldBillId)
      return held
    })
  }

  discardHeldBill(actor: Actor, heldBillId: number): void {
    assertCan(actor, 'sale.create')
    if (!this.deps.sales.deleteHeldBill(heldBillId)) {
      throw new AppError('NOT_FOUND', 'That held bill was not found.')
    }
  }

  private requireSale(saleId: number): SaleDetail {
    const sale = this.deps.sales.get(saleId)
    if (!sale) throw new AppError('NOT_FOUND', 'That sale was not found.')
    return sale
  }
}
