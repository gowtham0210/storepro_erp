import type {
  CurrencyInfo,
  SetupOptions,
  StoreProfile,
  StoreProfileInput
} from '@shared/ipc/contract'
import { Repository } from '../db/repository'

/** Business types the first release supports (FR-003). */
export const AVAILABLE_BUSINESS_TYPES = ['grocery'] as const

interface Row {
  name: string
  address_line1: string
  address_line2: string | null
  city: string
  region_code: string | null
  postal_code: string | null
  country_code: string
  phone: string
  email: string | null
  tax_registration_number: string | null
  currency_code: string
  currency_name: string
  currency_symbol: string
  minor_units: number
  time_zone: string
  business_type_code: string
  business_type_name: string
  prices_include_tax: number
  allow_negative_stock: number
  receipt_header: string | null
  receipt_footer: string | null
  invoice_prefix: string
  created_at: number
  updated_at: number
}

function toColumns(input: StoreProfileInput) {
  return {
    name: input.name,
    address_line1: input.addressLine1,
    address_line2: input.addressLine2,
    city: input.city,
    region_code: input.regionCode,
    postal_code: input.postalCode,
    country_code: input.countryCode,
    phone: input.phone,
    email: input.email,
    tax_registration_number: input.taxRegistrationNumber,
    currency_code: input.currencyCode,
    time_zone: input.timeZone,
    business_type_code: input.businessTypeCode,
    prices_include_tax: input.pricesIncludeTax ? 1 : 0,
    allow_negative_stock: input.allowNegativeStock ? 1 : 0,
    receipt_header: input.receiptHeader,
    receipt_footer: input.receiptFooter
  }
}

/**
 * The store's profile (M03-01): the single `businesses` row, plus the
 * invoice number prefix from `document_sequences`. Setup is complete exactly
 * when the row exists.
 */
export class StoreRepository extends Repository {
  exists(): boolean {
    return this.db.get('SELECT 1 AS found FROM businesses WHERE business_id = 1') !== undefined
  }

  get(): StoreProfile | null {
    const row = this.db.get<Row>(
      `SELECT b.*, c.name AS currency_name, c.symbol AS currency_symbol, c.minor_units,
              t.name AS business_type_name, s.prefix AS invoice_prefix
       FROM businesses b
       JOIN currencies c ON c.currency_code = b.currency_code
       JOIN business_types t ON t.business_type_code = b.business_type_code
       JOIN document_sequences s ON s.document_type = 'sale_invoice'
       WHERE b.business_id = 1`
    )
    if (!row) return null
    return {
      name: row.name,
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      city: row.city,
      regionCode: row.region_code,
      postalCode: row.postal_code,
      countryCode: row.country_code,
      phone: row.phone,
      email: row.email,
      taxRegistrationNumber: row.tax_registration_number,
      currencyCode: row.currency_code,
      timeZone: row.time_zone,
      businessTypeCode: row.business_type_code,
      pricesIncludeTax: row.prices_include_tax === 1,
      allowNegativeStock: row.allow_negative_stock === 1,
      receiptHeader: row.receipt_header,
      receiptFooter: row.receipt_footer,
      invoicePrefix: row.invoice_prefix,
      currency: {
        currencyCode: row.currency_code,
        name: row.currency_name,
        symbol: row.currency_symbol,
        minorUnits: row.minor_units
      },
      businessTypeName: row.business_type_name,
      setUpAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /** Creates the store and switches on the business type's module (M04 refines this). */
  create(input: StoreProfileInput): void {
    this.insertWithTimestamps('businesses', { business_id: 1, ...toColumns(input) })
    this.setInvoicePrefix(input.invoicePrefix)
    this.db.run(
      `INSERT OR IGNORE INTO enabled_modules (module_code, enabled_at)
       SELECT module_code, ? FROM modules WHERE module_code = ?`,
      [this.now(), input.businessTypeCode]
    )
  }

  updateProfile(input: StoreProfileInput): void {
    this.update('businesses', 'business_id', 1, toColumns(input))
    this.setInvoicePrefix(input.invoicePrefix)
  }

  options(): SetupOptions {
    const currencies = this.db
      .all<{ currency_code: string; name: string; symbol: string; minor_units: number }>(
        'SELECT currency_code, name, symbol, minor_units FROM currencies ORDER BY name'
      )
      .map((row): CurrencyInfo => ({
        currencyCode: row.currency_code,
        name: row.name,
        symbol: row.symbol,
        minorUnits: row.minor_units
      }))
    const businessTypes = this.db
      .all<{ business_type_code: string; name: string }>(
        'SELECT business_type_code, name FROM business_types ORDER BY rowid'
      )
      .map((row) => ({
        businessTypeCode: row.business_type_code,
        name: row.name,
        available: (AVAILABLE_BUSINESS_TYPES as readonly string[]).includes(row.business_type_code)
      }))
    return { currencies, businessTypes }
  }

  hasSales(): boolean {
    return this.db.get('SELECT 1 AS found FROM sales LIMIT 1') !== undefined
  }

  private setInvoicePrefix(prefix: string): void {
    this.db.run("UPDATE document_sequences SET prefix = ? WHERE document_type = 'sale_invoice'", [
      prefix
    ])
  }
}
