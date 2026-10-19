import type {
  PricingPolicy,
  PricingSettings,
  TaxClassInput,
  TaxClassSummary
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { formatMoney, type CurrencyFormat } from '@shared/money'
import {
  discountExceedsLimit,
  taxRegimeOf,
  type BillCalculation,
  type PricingRules
} from '@shared/pricing'
import { formatRate } from '@shared/tax'
import { changesBetween, type AuditLog } from '../audit/auditLog'
import { assertCan, forbidden, type Actor } from '../auth/access'
import { conflict, invalid } from '../catalog/catalogService'
import type { TaxClassRepository } from '../catalog/taxClassRepository'
import type { Database } from '../db/database'
import type { StoreRepository } from '../store/storeRepository'

export interface PricingServiceDeps {
  db: Database
  /** Owns the `businesses` row, where the policy is kept. */
  store: StoreRepository
  taxClasses: TaxClassRepository
  audit: AuditLog
}

interface StoreRow {
  country_code: string
  tax_registration_number: string | null
  prices_include_tax: number
  bill_rounding_minor: number
  max_discount_bp: number
  currency_code: string
  minor_units: number
}

/** A bill line as checkout sees it: the price charged and the catalogue price. */
export interface PricedLine {
  unitPriceMinor: number
  catalogPriceMinor: number
}

/**
 * Pricing, discounts and tax (M10): the store's pricing policy, its tax
 * classes, and the permission rules for discounts and price overrides that
 * checkout (M11) applies. The arithmetic itself is the pure engine in
 * src/shared/pricing.ts.
 */
export class PricingService {
  constructor(private readonly deps: PricingServiceDeps) {}

  /** Billing needs these to price a bill, so anyone signed in may read them. */
  getSettings(): PricingSettings {
    const store = this.store()
    return {
      roundingMinor: store.bill_rounding_minor,
      maxDiscountBp: store.max_discount_bp,
      regime: taxRegimeOf({
        countryCode: store.country_code,
        taxRegistrationNumber: store.tax_registration_number
      }),
      pricesIncludeTax: store.prices_include_tax === 1
    }
  }

  /** The engine's rules for this store as it is now. */
  rules(): PricingRules {
    const { pricesIncludeTax, regime, roundingMinor } = this.getSettings()
    return { pricesIncludeTax, regime, roundingMinor }
  }

  updatePolicy(actor: Actor, policy: PricingPolicy): PricingSettings {
    assertCan(actor, 'settings.edit')
    const { db, audit } = this.deps
    db.transaction(() => {
      const before = this.getSettings()
      const changes = changesBetween(this.readablePolicy(before), this.readablePolicy(policy))
      if (!changes) return
      this.deps.store.setPricingPolicy(policy)
      audit.change({ action: 'pricing.updated', actor, details: { changes } })
    })
    return this.getSettings()
  }

  createTaxClass(actor: Actor, input: TaxClassInput): TaxClassSummary {
    assertCan(actor, 'settings.edit')
    const { db, taxClasses, audit } = this.deps
    const id = db.transaction(() => {
      this.checkTaxClass(input, null)
      const taxClassId = taxClasses.create(input)
      audit.change({
        action: 'tax_class.created',
        actor,
        entity: { type: 'tax_class', id: taxClassId },
        details: this.readableTaxClass(input)
      })
      return taxClassId
    })
    return this.requireTaxClass(id)
  }

  /**
   * A new rate applies to the next bill for every product in the class.
   * Bills already made keep the tax they charged (sale_item_taxes is a snapshot).
   */
  updateTaxClass(
    actor: Actor,
    { taxClassId, ...input }: TaxClassInput & { taxClassId: number }
  ): TaxClassSummary {
    assertCan(actor, 'settings.edit')
    const { db, taxClasses, audit } = this.deps
    db.transaction(() => {
      const before = this.requireTaxClass(taxClassId)
      this.checkTaxClass(input, taxClassId)
      const changes = changesBetween(this.readableTaxClass(before), this.readableTaxClass(input))
      if (!changes) return
      taxClasses.updateClass(taxClassId, input)
      audit.change({
        action: 'tax_class.updated',
        actor,
        entity: { type: 'tax_class', id: taxClassId },
        details: { name: input.name, changes }
      })
    })
    return this.requireTaxClass(taxClassId)
  }

  setTaxClassActive(
    actor: Actor,
    { taxClassId, active }: { taxClassId: number; active: boolean }
  ): TaxClassSummary {
    assertCan(actor, 'settings.edit')
    const { db, taxClasses, audit } = this.deps
    db.transaction(() => {
      const before = this.requireTaxClass(taxClassId)
      if (before.active === active) return
      if (!active && taxClasses.list().filter((t) => t.active).length === 1) {
        throw new AppError('CONFLICT', 'Products need at least one tax rate to choose from.')
      }
      taxClasses.setActive(taxClassId, active)
      audit.change({
        action: active ? 'tax_class.restored' : 'tax_class.archived',
        actor,
        entity: { type: 'tax_class', id: taxClassId },
        details: { name: before.name }
      })
    })
    return this.requireTaxClass(taxClassId)
  }

  /**
   * Who may give these prices and discounts (M10-05). Any discount needs
   * `discount.apply`; discounts above the store limit need
   * `discount.override`; a price other than the catalogue's needs
   * `price.override`. The last two can be approved by a manager (M06-05):
   * the error says so.
   */
  authorizeBill(
    actor: Actor,
    lines: readonly PricedLine[],
    bill: Pick<BillCalculation, 'grossMinor' | 'discountMinor'>
  ): void {
    if (lines.some((line) => line.unitPriceMinor !== line.catalogPriceMinor)) {
      if (!actor.permissions.has('price.override')) throw forbidden('price.override', true)
    }
    if (bill.discountMinor > 0) {
      assertCan(actor, 'discount.apply')
      const { maxDiscountBp } = this.getSettings()
      if (
        discountExceedsLimit(bill, maxDiscountBp) &&
        !actor.permissions.has('discount.override')
      ) {
        throw forbidden('discount.override', true)
      }
    }
  }

  private checkTaxClass(input: TaxClassInput, taxClassId: number | null): void {
    const other = this.deps.taxClasses.findByName(input.name)
    if (other && other.taxClassId !== taxClassId) {
      throw conflict('name', `There is already a tax rate called “${other.name}”`)
    }
    if (this.store().country_code === 'IN' && input.rateBp % 2 !== 0) {
      // CGST and SGST are each half the rate, and must come out equal.
      throw invalid('rateBp', 'GST rates must split equally into CGST and SGST, e.g. 5 or 18')
    }
  }

  private readablePolicy(policy: PricingPolicy): Record<string, unknown> {
    const currency = this.currency()
    return {
      rounding:
        policy.roundingMinor === 1
          ? 'not rounded'
          : `nearest ${formatMoney(policy.roundingMinor, currency)}`,
      discountLimit: formatRate(policy.maxDiscountBp)
    }
  }

  private readableTaxClass(input: TaxClassInput): Record<string, unknown> {
    return { name: input.name, rate: formatRate(input.rateBp), cess: formatRate(input.cessRateBp) }
  }

  private currency(): CurrencyFormat {
    const store = this.store()
    return { currencyCode: store.currency_code, minorUnits: store.minor_units }
  }

  private store(): StoreRow {
    const row = this.deps.db.get<StoreRow>(
      `SELECT b.country_code, b.tax_registration_number, b.prices_include_tax, b.bill_rounding_minor,
              b.max_discount_bp, b.currency_code, c.minor_units
       FROM businesses b JOIN currencies c ON c.currency_code = b.currency_code
       WHERE b.business_id = 1`
    )
    if (!row) throw new AppError('SETUP_REQUIRED', 'Finish setting up the store first.')
    return row
  }

  private requireTaxClass(taxClassId: number): TaxClassSummary {
    const found = this.deps.taxClasses.find(taxClassId)
    if (!found) throw new AppError('NOT_FOUND', 'That tax rate no longer exists.')
    return found
  }
}
