/* eslint-disable @typescript-eslint/no-invalid-void-type -- `void` marks channels without input or output. */

/**
 * The typed IPC contract between the renderer and the main process.
 *
 * Every renderer → main call is declared here once. The preload bridge only
 * forwards channels listed in `IPC_CHANNELS`, and the main process must
 * register a handler (with an input schema) for every channel, which the
 * compiler enforces through `HandlerMap` in `src/main/ipc/serviceHost.ts`.
 *
 * This file must stay free of runtime dependencies: it is bundled into the
 * sandboxed preload script.
 */

import type { ModuleCode } from '../modules'
import type { PaymentKind } from '../payments'
import type { Discount, TaxAmount, TaxRegime, TaxSummaryRow } from '../pricing'
import type { PermissionCode } from '../permissions'
import type { IpcResult } from './errors'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  isPackaged: boolean
  versions: {
    electron: string
    chrome: string
    node: string
  }
}

export interface StartupStatus {
  /** True when the previous session did not shut down cleanly (crash, power loss, forced kill). */
  recoveredFromUncleanShutdown: boolean
  /** ISO timestamp of when the previous, uncleanly ended session started. */
  previousSessionStartedAt: string | null
}

export interface RendererLogEntry {
  level: LogLevel
  message: string
  context?: Record<string, unknown> | undefined
}

export type RoleCode = 'administrator' | 'manager' | 'cashier' | 'inventory_operator'

/** The signed-in user, as the renderer sees them. Never includes the password hash. */
export interface SessionUser {
  userId: number
  username: string
  displayName: string
  roleCode: RoleCode
  roleName: string
  /** Set after an administrator reset the password: the user must choose a new one. */
  mustChangePassword: boolean
  /** What the user's role allows, in catalogue order. Shapes the UI only; the main process enforces. */
  permissions: PermissionCode[]
}

export type AuthState =
  /** First run: the store and its first administrator must be set up. */
  | { status: 'setup-required' }
  | { status: 'signed-out' }
  | { status: 'locked'; user: SessionUser }
  | { status: 'signed-in'; user: SessionUser }

export interface Credentials {
  username: string
  password: string
}

export interface NewAdministrator {
  username: string
  displayName: string
  password: string
}

export interface PasswordChange {
  currentPassword: string
  newPassword: string
}

export interface UserSummary {
  userId: number
  username: string
  displayName: string
  roleCode: RoleCode
  roleName: string
  active: boolean
  mustChangePassword: boolean
  lastSignInAt: number | null
  createdAt: number
}

export interface RoleSummary {
  roleCode: RoleCode
  name: string
  permissions: PermissionCode[]
}

/** Another user's credentials, approving one restricted request (M06-05). */
export interface OverrideRequest {
  permission: PermissionCode
  username: string
  password: string
}

export interface OverrideApproval {
  /** Pass as `overrideId` with the request it approves. Single use. */
  overrideId: string
  approvedBy: string
  expiresAt: number
}

export interface NewUser {
  username: string
  displayName: string
  roleCode: RoleCode
  password: string
}

export interface UserUpdate {
  userId: number
  displayName: string
  roleCode: RoleCode
}

/** The store's details as entered in setup or Settings (M03). */
export interface StoreProfileInput {
  name: string
  addressLine1: string
  addressLine2: string | null
  city: string
  /** ISO 3166-2 subdivision code for India ("TN"); free text elsewhere. */
  regionCode: string | null
  postalCode: string | null
  countryCode: string
  phone: string
  email: string | null
  /** GSTIN in India. Null when the store isn't registered for tax. */
  taxRegistrationNumber: string | null
  currencyCode: string
  /** IANA time zone, e.g. "Asia/Kolkata". */
  timeZone: string
  businessTypeCode: string
  pricesIncludeTax: boolean
  allowNegativeStock: boolean
  receiptHeader: string | null
  receiptFooter: string | null
  invoicePrefix: string
}

export interface CurrencyInfo {
  currencyCode: string
  name: string
  symbol: string
  minorUnits: number
}

export interface StoreProfile extends StoreProfileInput {
  currency: CurrencyInfo
  businessTypeName: string
  /** Modules switched on (M04), which decide the screens and features available. */
  enabledModules: ModuleCode[]
  /** When first-run setup finished. */
  setUpAt: number
  updatedAt: number
}

/** Whether the computer is online (M08). */
export interface ConnectivityStatus {
  online: boolean
  /** When it last went online or offline. */
  changedAt: number
  checkedAt: number
}

/** A module and whether it is switched on (M04). */
export interface ModuleState {
  code: ModuleCode
  name: string
  description: string
  availability: 'available' | 'planned'
  plannedFor: string | null
  enabled: boolean
  enabledAt: number | null
  /** Why it can't be switched on or off right now, or null if it can. */
  locked: string | null
}

/** Reference data the setup wizard offers. */
export interface SetupOptions {
  currencies: CurrencyInfo[]
  /** Only grocery/retail is available in the first release (FR-003). */
  businessTypes: { businessTypeCode: string; name: string; available: boolean }[]
}

/** Which audit entries to show (M07-04). Newest first. */
export interface AuditLogFilter {
  /** Done or approved by this user; 'system' for StorePro itself. */
  person?: number | 'system' | undefined
  action?: string | undefined
  /** Epoch ms, inclusive. */
  from?: number | undefined
  /** Epoch ms, exclusive. */
  to?: number | undefined
  /** Entries about this record, e.g. a user's account history. */
  entity?: { type: string; id: number } | undefined
  /** Continue after the last page: only entries older than this id. */
  before?: number | undefined
  limit?: number | undefined
}

export interface AuditPerson {
  userId: number
  displayName: string
  username: string
}

export interface AuditLogEntry {
  id: number
  occurredAt: number
  action: string
  /** Null when StorePro itself recorded the entry. */
  actor: AuditPerson | null
  /** Who approved it, when a manager approval was used. */
  approvedBy: AuditPerson | null
  entity: { type: string; id: number; label: string | null } | null
  details: Record<string, unknown> | null
}

export interface AuditLogPage {
  entries: AuditLogEntry[]
  /** Pass as `before` for the next page; null when there are no older entries. */
  nextBefore: number | null
}

export interface AuditFilterOptions {
  /** Actions that appear in the log. */
  actions: string[]
  /** People who appear in the log. */
  people: AuditPerson[]
}

/** A product category (M09-01). */
export interface CategorySummary {
  categoryId: number
  name: string
  active: boolean
  /** Products filed under it, archived ones included. */
  productCount: number
}

/** A unit of measure (M09-01). */
export interface UnitInfo {
  unitCode: string
  name: string
  /** Sold and counted in fractions (kg: yes, pcs: no). */
  allowsFraction: boolean
  /** Used by an item, so its code and fraction rule can't change. */
  inUse: boolean
}

/** A tax class: the rate products are taxed at (M09, M10). */
export interface TaxClassSummary {
  taxClassId: number
  name: string
  rateBp: number
  cessRateBp: number
  active: boolean
  productCount: number
}

export type ProductStatusFilter = 'active' | 'archived' | 'all'

export interface ProductListFilter {
  /** Name, SKU or barcode; words match as prefixes. */
  search?: string | undefined
  categoryId?: number | undefined
  status?: ProductStatusFilter | undefined
  offset?: number | undefined
  limit?: number | undefined
}

/** One sellable item (a product's variant) in the product list. */
export interface ProductListItem {
  variantId: number
  productId: number
  productName: string
  /** Pack size or model, e.g. "1 kg"; null for a product with a single variant. */
  variantName: string | null
  sku: string
  barcodes: string[]
  unitCode: string
  categoryName: string | null
  sellingPriceMinor: number
  mrpMinor: number | null
  tracksInventory: boolean
  /** Null when the product doesn't track stock. */
  onHandMilli: number | null
  /** The item and its product are both active. */
  active: boolean
}

export interface ProductListPage {
  items: ProductListItem[]
  /** Items matching the filter, on every page. */
  total: number
}

export interface VariantDetail {
  variantId: number
  variantName: string | null
  sku: string
  unitCode: string
  sellingPriceMinor: number
  mrpMinor: number | null
  costPriceMinor: number | null
  reorderLevelMilli: number | null
  barcodes: string[]
  active: boolean
  onHandMilli: number | null
  /** Sold, bought, counted or adjusted: its unit can no longer change. */
  hasHistory: boolean
}

export interface ProductDetail {
  productId: number
  name: string
  categoryId: number | null
  taxClassId: number
  hsnCode: string | null
  tracksInventory: boolean
  active: boolean
  createdAt: number
  updatedAt: number
  variants: VariantDetail[]
}

/** What applies to every pack size of a product. */
export interface ProductInput {
  name: string
  categoryId: number | null
  taxClassId: number
  /** HSN code for GST invoices: 4 to 8 digits. */
  hsnCode: string | null
  tracksInventory: boolean
}

/** One pack size: what is priced, scanned, sold and counted. */
export interface VariantInput {
  variantName: string | null
  /** Left empty, StorePro assigns one (ITEM-00042). */
  sku: string | null
  unitCode: string
  sellingPriceMinor: number
  mrpMinor: number | null
  costPriceMinor: number | null
  /** Low-stock threshold (M14-05); null for none. */
  reorderLevelMilli: number | null
  barcodes: string[]
}

export interface NewProduct extends ProductInput {
  variants: VariantInput[]
}

export interface ProductUpdate extends ProductInput {
  productId: number
}

export interface VariantUpdate extends VariantInput {
  variantId: number
}

/** An item found by barcode or search, with what billing needs (M09-07). */
export interface ItemLookup {
  variantId: number
  productId: number
  /** Product and pack size together: "Toor Dal 1 kg". */
  name: string
  sku: string
  unitCode: string
  allowsFraction: boolean
  sellingPriceMinor: number
  mrpMinor: number | null
  taxClassId: number
  tracksInventory: boolean
  onHandMilli: number | null
}

/** Store-wide pricing rules an administrator sets (M10-04, M10-05). */
export interface PricingPolicy {
  /** The payable amount is rounded to a multiple of this; 1 = not rounded. */
  roundingMinor: number
  /** The most discount on a bill, as a share of its gross amount, without an override. */
  maxDiscountBp: number
}

/** What billing needs to price a bill: the policy plus how the store charges tax. */
export interface PricingSettings extends PricingPolicy {
  regime: TaxRegime
  pricesIncludeTax: boolean
}

export interface TaxClassInput {
  name: string
  rateBp: number
  cessRateBp: number
}

export type AdjustmentReasonCode =
  'opening_stock' | 'count_correction' | 'damage' | 'expiry' | 'theft_loss' | 'other'

export interface AdjustmentReason {
  adjustmentReasonCode: AdjustmentReasonCode
  name: string
}

export type StockLevelFilter = 'all' | 'low' | 'out'

export interface StockListFilter {
  search?: string | undefined
  categoryId?: number | undefined
  level?: StockLevelFilter | undefined
  offset?: number | undefined
  limit?: number | undefined
}

/** An inventory-tracked item and its current stock (M14-02, M14-05). */
export interface StockListItem {
  variantId: number
  productId: number
  productName: string
  variantName: string | null
  /** Product and pack size together: "Toor Dal 1 kg". */
  name: string
  sku: string
  barcodes: string[]
  categoryName: string | null
  unitCode: string
  allowsFraction: boolean
  sellingPriceMinor: number
  costPriceMinor: number | null
  onHandMilli: number
  reorderLevelMilli: number | null
  isLowStock: boolean
}

export interface StockListPage {
  items: StockListItem[]
  total: number
  /** Active tracked items at or below their low-stock level (or out of stock). */
  lowStockCount: number
  /** Active tracked items with zero or negative stock. */
  outOfStockCount: number
}

export type MovementType = 'sale' | 'sale_void' | 'sale_return' | 'goods_receipt' | 'adjustment'

export interface MovementListFilter {
  variantId: number
  movementType?: MovementType | undefined
  offset?: number | undefined
  limit?: number | undefined
}

/** One entry in an item's stock ledger (M14-07). */
export interface InventoryMovement {
  movementType: MovementType
  occurredAt: number
  variantId: number
  quantityDeltaMilli: number
  balanceAfterMilli: number
  sourceTable: string
  sourceId: number
  documentNumber: string
  reasonCode: AdjustmentReasonCode | null
  reasonName: string | null
  actorName: string | null
  notes: string | null
}

export interface MovementListPage {
  variantId: number
  name: string
  sku: string
  unitCode: string
  allowsFraction: boolean
  onHandMilli: number
  reorderLevelMilli: number | null
  items: InventoryMovement[]
  total: number
}

export interface StockAdjustmentLineInput {
  variantId: number
  quantityDeltaMilli: number
}

export interface StockAdjustmentInput {
  reasonCode: AdjustmentReasonCode
  notes: string | null
  items: StockAdjustmentLineInput[]
}

export interface StockAdjustmentLineDetail {
  variantId: number
  name: string
  sku: string
  unitCode: string
  quantityDeltaMilli: number
  onHandAfterMilli: number
}

export interface StockAdjustmentDetail {
  stockAdjustmentId: number
  adjustmentNumber: string
  reasonCode: AdjustmentReasonCode
  reasonName: string
  adjustedAt: number
  adjustedByName: string
  notes: string | null
  items: StockAdjustmentLineDetail[]
}

export interface StockCountLineInput {
  variantId: number
  countedMilli: number
}

export interface StockCountInput {
  notes: string | null
  items: StockCountLineInput[]
}

export interface AdjustmentListFilter {
  reasonCode?: AdjustmentReasonCode | undefined
  offset?: number | undefined
  limit?: number | undefined
}

export interface AdjustmentListPage {
  items: StockAdjustmentDetail[]
  total: number
}

/** A payment method configured for the store (M12-01). */
export interface PaymentMethodInfo {
  paymentMethodId: number
  methodCode: string
  name: string
  kind: PaymentKind
  sortOrder: number
  active: boolean
  inUse: boolean
}

export interface PaymentMethodCreateInput {
  methodCode: string
  name: string
  kind: PaymentKind
  sortOrder?: number | undefined
}

export interface PaymentMethodUpdateInput {
  paymentMethodId: number
  name: string
  kind: PaymentKind
  sortOrder?: number | undefined
}

export interface CheckoutLineInput {
  variantId: number
  quantityMilli: number
  unitPriceMinor: number
  discount?: Discount | null | undefined
}

export interface CheckoutPaymentInput {
  paymentMethodId: number
  amountMinor: number
  /** Cash handed over (`>= amountMinor`); null for non-cash methods. */
  tenderedMinor?: number | null | undefined
  /** Payer-side reference such as a UPI transaction ID (recorded, not verified). */
  reference?: string | null | undefined
}

export interface CheckoutInput {
  /** Client-generated idempotency key so retries/double-clicks never create duplicate bills (M11-08). */
  checkoutKey: string
  customerId?: number | null | undefined
  lines: CheckoutLineInput[]
  billDiscount?: Discount | null | undefined
  payments: CheckoutPaymentInput[]
  /** When checking out a resumed held bill, deletes the draft atomically if still present. */
  heldBillId?: number | null | undefined
  overrideId?: string | undefined
}

export interface SaleLineDetail {
  saleItemId: number
  lineNumber: number
  variantId: number
  description: string
  sku: string
  hsnCode: string | null
  unitCode: string
  allowsFraction: boolean
  quantityMilli: number
  unitPriceMinor: number
  grossMinor: number
  discountMinor: number
  netMinor: number
  taxableMinor: number
  taxMinor: number
  totalMinor: number
  taxes: TaxAmount[]
}

export interface SalePaymentDetail {
  salePaymentId: number
  paymentMethodId: number
  methodCode: string
  methodName: string
  kind: PaymentKind
  amountMinor: number
  tenderedMinor: number | null
  changeMinor: number
  reference: string | null
  /** Present for UPI payments ("Recorded (not verified)", M12-03). */
  verificationNotice: string | null
}

/** A refund payment record linked to a return on a sale (M12-04). */
export interface ReturnRefundDetail {
  returnRefundId: number
  saleReturnId: number
  returnNumber: string
  saleId: number
  returnedAt: number
  paymentMethodId: number
  methodCode: string
  methodName: string
  kind: PaymentKind
  amountMinor: number
  reference: string | null
}

export interface SaleVoidInfo {
  voidedAt: number
  voidedByUserId: number
  voidedByName: string
  approvedByUserId: number | null
  approvedByName: string | null
  reason: string
}

export interface SaleDetail {
  saleId: number
  invoiceNumber: string
  checkoutKey: string
  completedAt: number
  cashierUserId: number
  cashierName: string
  customerId: number | null
  customerName: string | null
  pricesIncludeTax: boolean
  grossMinor: number
  discountMinor: number
  taxableMinor: number
  taxMinor: number
  roundOffMinor: number
  grandTotalMinor: number
  paidMinor: number
  tenderedMinor: number
  changeMinor: number
  lines: SaleLineDetail[]
  taxSummary: TaxSummaryRow[]
  payments: SalePaymentDetail[]
  refunds: ReturnRefundDetail[]
  voidInfo: SaleVoidInfo | null
}

export type SaleStatusFilter = 'all' | 'completed' | 'voided'

export interface SaleListFilter {
  search?: string | undefined
  status?: SaleStatusFilter | undefined
  from?: number | undefined
  to?: number | undefined
  offset?: number | undefined
  limit?: number | undefined
}

export interface SaleListItem {
  saleId: number
  invoiceNumber: string
  completedAt: number
  cashierName: string
  customerName: string | null
  lineCount: number
  grandTotalMinor: number
  paymentSummary: string
  isVoided: boolean
}

export interface SaleListPage {
  items: SaleListItem[]
  total: number
}

export interface VoidSaleInput {
  saleId: number
  reason: string
  overrideId?: string | undefined
}

export interface HeldBillLineInput {
  variantId: number
  quantityMilli: number
  unitPriceOverrideMinor?: number | null | undefined
  discountMinor?: number | undefined
}

export interface HoldBillInput {
  label: string | null
  customerId?: number | null | undefined
  items: HeldBillLineInput[]
}

export interface HeldBillSummary {
  heldBillId: number
  label: string | null
  customerId: number | null
  customerName: string | null
  heldByUserId: number
  heldByName: string
  heldAt: number
  lineCount: number
  itemSummary: string
}

export interface HeldBillLineDetail {
  lineNumber: number
  item: ItemLookup
  quantityMilli: number
  unitPriceOverrideMinor: number | null
  discountMinor: number
}

export interface HeldBillDetail {
  heldBillId: number
  label: string | null
  customerId: number | null
  customerName: string | null
  heldByName: string
  heldAt: number
  items: HeldBillLineDetail[]
}

export interface IpcContract {
  'app:get-info': { input: void; output: AppInfo }
  'app:get-startup-status': { input: void; output: StartupStatus }
  'log:write': { input: RendererLogEntry; output: void }
  'auth:get-state': { input: void; output: AuthState }
  'auth:sign-in': { input: Credentials; output: SessionUser }
  'auth:sign-out': { input: void; output: void }
  'auth:lock': { input: void; output: void }
  'auth:unlock': { input: { password: string }; output: SessionUser }
  'auth:change-password': { input: PasswordChange; output: SessionUser }
  'auth:approve-override': { input: OverrideRequest; output: OverrideApproval }
  'users:list': { input: void; output: UserSummary[] }
  'users:list-roles': { input: void; output: RoleSummary[] }
  'users:create': { input: NewUser; output: UserSummary }
  'users:update': { input: UserUpdate; output: UserSummary }
  'users:set-active': { input: { userId: number; active: boolean }; output: UserSummary }
  'users:reset-password': { input: { userId: number; newPassword: string }; output: UserSummary }
  'setup:get-options': { input: void; output: SetupOptions }
  'setup:complete': {
    input: { store: StoreProfileInput; administrator: NewAdministrator }
    output: SessionUser
  }
  'setup:complete-store': { input: StoreProfileInput; output: StoreProfile }
  'store:get-profile': { input: void; output: StoreProfile | null }
  'store:update': { input: StoreProfileInput; output: StoreProfile }
  'connectivity:get-status': { input: void; output: ConnectivityStatus }
  'modules:list': { input: void; output: ModuleState[] }
  'modules:set-enabled': { input: { code: ModuleCode; enabled: boolean }; output: ModuleState[] }
  'audit:list': { input: AuditLogFilter; output: AuditLogPage }
  'audit:filter-options': { input: void; output: AuditFilterOptions }
  'catalog:list-categories': { input: void; output: CategorySummary[] }
  'catalog:create-category': { input: { name: string }; output: CategorySummary }
  'catalog:rename-category': {
    input: { categoryId: number; name: string }
    output: CategorySummary
  }
  'catalog:set-category-active': {
    input: { categoryId: number; active: boolean }
    output: CategorySummary
  }
  'catalog:list-units': { input: void; output: UnitInfo[] }
  'catalog:create-unit': {
    input: { unitCode: string; name: string; allowsFraction: boolean }
    output: UnitInfo
  }
  'catalog:rename-unit': { input: { unitCode: string; name: string }; output: UnitInfo }
  'tax:list-classes': { input: void; output: TaxClassSummary[] }
  'tax:create-class': { input: TaxClassInput; output: TaxClassSummary }
  'tax:update-class': { input: TaxClassInput & { taxClassId: number }; output: TaxClassSummary }
  'tax:set-class-active': {
    input: { taxClassId: number; active: boolean }
    output: TaxClassSummary
  }
  'pricing:get-settings': { input: void; output: PricingSettings }
  'pricing:update-policy': { input: PricingPolicy; output: PricingSettings }
  'products:list': { input: ProductListFilter; output: ProductListPage }
  'products:get': { input: { productId: number }; output: ProductDetail }
  'products:create': { input: NewProduct; output: ProductDetail }
  'products:update': { input: ProductUpdate; output: ProductDetail }
  'products:add-variant': { input: VariantInput & { productId: number }; output: ProductDetail }
  'products:update-variant': { input: VariantUpdate; output: ProductDetail }
  'products:set-active': { input: { productId: number; active: boolean }; output: ProductDetail }
  'products:set-variant-active': {
    input: { variantId: number; active: boolean }
    output: ProductDetail
  }
  'products:find-by-barcode': { input: { barcode: string }; output: ItemLookup | null }
  'products:search': { input: { query: string; limit?: number | undefined }; output: ItemLookup[] }
  'inventory:list-reasons': { input: void; output: AdjustmentReason[] }
  'inventory:list': { input: StockListFilter; output: StockListPage }
  'inventory:movements': { input: MovementListFilter; output: MovementListPage }
  'inventory:adjust': { input: StockAdjustmentInput; output: StockAdjustmentDetail }
  'inventory:reconcile': { input: StockCountInput; output: StockAdjustmentDetail | null }
  'inventory:list-adjustments': { input: AdjustmentListFilter; output: AdjustmentListPage }
  'payments:list-methods': { input: void; output: PaymentMethodInfo[] }
  'payments:create-method': { input: PaymentMethodCreateInput; output: PaymentMethodInfo }
  'payments:update-method': { input: PaymentMethodUpdateInput; output: PaymentMethodInfo }
  'payments:set-method-active': {
    input: { paymentMethodId: number; active: boolean }
    output: PaymentMethodInfo
  }
  'sales:checkout': { input: CheckoutInput; output: SaleDetail }
  'sales:list': { input: SaleListFilter; output: SaleListPage }
  'sales:get': { input: { saleId: number }; output: SaleDetail }
  'sales:find-by-invoice': { input: { invoiceNumber: string }; output: SaleDetail | null }
  'sales:void': { input: VoidSaleInput; output: SaleDetail }
  'sales:hold': { input: HoldBillInput; output: HeldBillSummary }
  'sales:list-held': { input: void; output: HeldBillSummary[] }
  'sales:resume-held': { input: { heldBillId: number }; output: HeldBillDetail }
  'sales:discard-held': { input: { heldBillId: number }; output: void }
}

export type IpcChannel = keyof IpcContract
export type IpcInput<C extends IpcChannel> = IpcContract[C]['input']
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output']

/** Arguments after the channel name: none for `void` inputs, otherwise exactly one. */
export type IpcArgs<C extends IpcChannel> = IpcInput<C> extends void ? [] : [input: IpcInput<C>]

// A record keyed by IpcChannel makes the compiler reject a missing or extra channel.
const channelRegistry: Record<IpcChannel, true> = {
  'app:get-info': true,
  'app:get-startup-status': true,
  'log:write': true,
  'auth:get-state': true,
  'auth:sign-in': true,
  'auth:sign-out': true,
  'auth:lock': true,
  'auth:unlock': true,
  'auth:change-password': true,
  'auth:approve-override': true,
  'users:list': true,
  'users:list-roles': true,
  'users:create': true,
  'users:update': true,
  'users:set-active': true,
  'users:reset-password': true,
  'setup:get-options': true,
  'setup:complete': true,
  'setup:complete-store': true,
  'store:get-profile': true,
  'store:update': true,
  'connectivity:get-status': true,
  'modules:list': true,
  'modules:set-enabled': true,
  'audit:list': true,
  'audit:filter-options': true,
  'catalog:list-categories': true,
  'catalog:create-category': true,
  'catalog:rename-category': true,
  'catalog:set-category-active': true,
  'catalog:list-units': true,
  'catalog:create-unit': true,
  'catalog:rename-unit': true,
  'tax:list-classes': true,
  'tax:create-class': true,
  'tax:update-class': true,
  'tax:set-class-active': true,
  'pricing:get-settings': true,
  'pricing:update-policy': true,
  'products:list': true,
  'products:get': true,
  'products:create': true,
  'products:update': true,
  'products:add-variant': true,
  'products:update-variant': true,
  'products:set-active': true,
  'products:set-variant-active': true,
  'products:find-by-barcode': true,
  'products:search': true,
  'inventory:list-reasons': true,
  'inventory:list': true,
  'inventory:movements': true,
  'inventory:adjust': true,
  'inventory:reconcile': true,
  'inventory:list-adjustments': true,
  'payments:list-methods': true,
  'payments:create-method': true,
  'payments:update-method': true,
  'payments:set-method-active': true,
  'sales:checkout': true,
  'sales:list': true,
  'sales:get': true,
  'sales:find-by-invoice': true,
  'sales:void': true,
  'sales:hold': true,
  'sales:list-held': true,
  'sales:resume-held': true,
  'sales:discard-held': true
}

export const IPC_CHANNELS = Object.keys(channelRegistry) as IpcChannel[]

/**
 * Events the main process pushes to the renderer (main → renderer). The
 * renderer can only listen to these, never send them.
 */
export interface IpcEvents {
  'connectivity:changed': ConnectivityStatus
}

export type IpcEvent = keyof IpcEvents

const eventRegistry: Record<IpcEvent, true> = {
  'connectivity:changed': true
}

export const IPC_EVENTS = Object.keys(eventRegistry) as IpcEvent[]

/** The API the preload script exposes on `window.storepro`. */
export interface StoreProBridge {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<IpcOutput<C>>>
  /** Listen to an event from the main process. Returns a function that stops listening. */
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
}
