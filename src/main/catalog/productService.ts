import type {
  ItemLookup,
  NewProduct,
  ProductDetail,
  ProductInput,
  ProductListFilter,
  ProductListPage,
  ProductUpdate,
  VariantDetail,
  VariantInput,
  VariantUpdate
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { formatMoney, type CurrencyFormat } from '@shared/money'
import { formatQuantity, QUANTITY_SCALE } from '@shared/quantity'
import {
  DEFAULT_WEIGH_BARCODE_CONFIG,
  parseWeighBarcode,
  type WeighBarcodeConfig
} from '@shared/scanner'
import { changesBetween, type AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import type { Database } from '../db/database'
import type { CatalogRepository } from './catalogRepository'
import { conflict, invalid } from './catalogService'
import { itemName, type ProductRepository } from './productRepository'
import type { TaxClassRepository } from './taxClassRepository'

export interface ProductServiceDeps {
  db: Database
  products: ProductRepository
  catalog: CatalogRepository
  taxClasses: TaxClassRepository
  audit: AuditLog
  /** The store's currency, for amounts in audit entries. */
  currency(): CurrencyFormat
  /** Variable-weight barcode configuration for grocery scales (M24-02). */
  weighBarcodeConfig?: () => WeighBarcodeConfig
}

const SEARCH_LIMIT = 20

/**
 * The product catalogue (M09-02 to M09-09): products, their pack sizes
 * (variants), barcodes and prices. Products and variants are archived, never
 * deleted: past bills refer to them (M09-08). Every change is audited, and
 * price changes get their own entry (M09-09).
 */
export class ProductService {
  constructor(private readonly deps: ProductServiceDeps) {}

  list(actor: Actor, filter: ProductListFilter): ProductListPage {
    assertCan(actor, 'product.view')
    return this.deps.products.list(filter)
  }

  get(actor: Actor, { productId }: { productId: number }): ProductDetail {
    assertCan(actor, 'product.view')
    return this.require(productId)
  }

  /**
   * M09-07 & M24-02: what a scanner typed, as an exact barcode, SKU, or
   * variable-weight/embedded-price grocery scale barcode. Only active items.
   */
  findByBarcode(actor: Actor, { barcode }: { barcode: string }): ItemLookup | null {
    assertCan(actor, 'product.view')
    const code = barcode.trim()
    if (code === '') return null

    const exact = this.deps.products.findByCode(code)
    if (exact) return exact

    const weighConfig =
      this.deps.weighBarcodeConfig?.() ?? DEFAULT_WEIGH_BARCODE_CONFIG
    const parsedWeigh = parseWeighBarcode(code, weighConfig)
    if (!parsedWeigh) return null

    const item = this.deps.products.findForWeighItemCode(parsedWeigh.itemCode)
    if (!item) return null

    if (parsedWeigh.kind === 'weight') {
      return {
        ...item,
        scannedQuantityMilli: parsedWeigh.quantityMilli
      }
    }

    if (item.sellingPriceMinor <= 0) return null
    const derivedQtyMilli = Math.max(
      1,
      Math.round((parsedWeigh.amountMinor * QUANTITY_SCALE) / item.sellingPriceMinor)
    )
    return {
      ...item,
      scannedQuantityMilli: derivedQtyMilli
    }
  }

  search(
    actor: Actor,
    { query, limit }: { query: string; limit?: number | undefined }
  ): ItemLookup[] {
    assertCan(actor, 'product.view')
    return this.deps.products.search(query, limit ?? SEARCH_LIMIT)
  }

  create(actor: Actor, input: NewProduct): ProductDetail {
    assertCan(actor, 'product.manage')
    const { db, products, audit } = this.deps
    const productId = db.transaction(() => {
      this.checkProduct(input, null)
      this.checkVariantSet(input.variants)
      const id = products.createProduct(input)
      input.variants.forEach((variant, index) => {
        const resolved = this.checkVariant(variant, null, `variants.${index}.`)
        products.createVariant(id, resolved)
      })
      audit.change({
        action: 'product.created',
        actor,
        entity: { type: 'product', id },
        details: {
          name: input.name,
          items: input.variants.map((variant) => this.describeVariant(input.name, variant))
        }
      })
      return id
    })
    return this.require(productId)
  }

  update(actor: Actor, input: ProductUpdate): ProductDetail {
    assertCan(actor, 'product.manage')
    const { db, products, audit } = this.deps
    db.transaction(() => {
      const before = this.require(input.productId)
      this.checkProduct(input, before)
      const changes = changesBetween(this.readableProduct(before), this.readableProduct(input))
      if (!changes) return
      products.updateProduct(input.productId, input)
      audit.change({
        action: 'product.updated',
        actor,
        entity: { type: 'product', id: input.productId },
        details: { name: input.name, changes }
      })
    })
    return this.require(input.productId)
  }

  addVariant(
    actor: Actor,
    { productId, ...variant }: VariantInput & { productId: number }
  ): ProductDetail {
    assertCan(actor, 'product.manage')
    const { db, products, audit } = this.deps
    db.transaction(() => {
      const product = this.require(productId)
      this.checkVariantSet([...product.variants.map(toInput), variant])
      const resolved = this.checkVariant(variant, null, '')
      const variantId = products.createVariant(productId, resolved)
      audit.change({
        action: 'variant.created',
        actor,
        entity: { type: 'product', id: productId },
        details: { item: this.describeVariant(product.name, resolved), variantId }
      })
    })
    return this.require(productId)
  }

  /**
   * Prices are changed here (M09-09). They take effect on the next bill: past
   * bills keep the price they were sold at. A price change is audited on its
   * own, with the amounts before and after.
   */
  updateVariant(actor: Actor, { variantId, ...variant }: VariantUpdate): ProductDetail {
    assertCan(actor, 'product.manage')
    const { db, products, audit } = this.deps
    const productId = this.requireProductOf(variantId)
    db.transaction(() => {
      const product = this.require(productId)
      const before = product.variants.find((v) => v.variantId === variantId)
      if (!before) throw new AppError('NOT_FOUND', 'That pack size no longer exists.')
      this.checkVariantSet(
        product.variants.map((v) => (v.variantId === variantId ? variant : toInput(v)))
      )
      if (before.hasHistory && variant.unitCode !== before.unitCode) {
        throw invalid(
          'unitCode',
          "The unit can't change once the item has been sold, bought or counted. Add a new pack size instead."
        )
      }
      const resolved = this.checkVariant(variant, before, '')
      const item = itemName(product.name, resolved.variantName)
      const prices = changesBetween(
        this.readablePrices(toInput(before)),
        this.readablePrices(resolved)
      )
      const other = changesBetween(
        this.readableVariant(toInput(before)),
        this.readableVariant(resolved)
      )
      if (!prices && !other) return
      products.updateVariant(variantId, resolved)
      const entity = { type: 'product', id: productId }
      if (prices) {
        audit.change({
          action: 'product.price_changed',
          actor,
          entity,
          details: { item, variantId, changes: prices }
        })
      }
      if (other) {
        audit.change({
          action: 'product.updated',
          actor,
          entity,
          details: { item, variantId, changes: other }
        })
      }
    })
    return this.require(productId)
  }

  /** M09-08: archived products can't be sold or bought, but their history stays. */
  setActive(
    actor: Actor,
    { productId, active }: { productId: number; active: boolean }
  ): ProductDetail {
    assertCan(actor, 'product.manage')
    const { db, products, audit } = this.deps
    db.transaction(() => {
      const before = this.require(productId)
      if (before.active === active) return
      products.setProductActive(productId, active)
      audit.change({
        action: active ? 'product.restored' : 'product.archived',
        actor,
        entity: { type: 'product', id: productId },
        details: { name: before.name }
      })
    })
    return this.require(productId)
  }

  setVariantActive(
    actor: Actor,
    { variantId, active }: { variantId: number; active: boolean }
  ): ProductDetail {
    assertCan(actor, 'product.manage')
    const { db, products, audit } = this.deps
    const productId = this.requireProductOf(variantId)
    db.transaction(() => {
      const product = this.require(productId)
      const variant = product.variants.find((v) => v.variantId === variantId)
      if (!variant || variant.active === active) return
      if (!active && product.variants.filter((v) => v.active).length === 1) {
        throw new AppError(
          'CONFLICT',
          'This is the only pack size still on sale. Archive the whole product instead.'
        )
      }
      if (active) this.assertCodesFree(variant.sku, variant.barcodes, variantId, '')
      products.setVariantActive(variantId, active)
      audit.change({
        action: active ? 'variant.restored' : 'variant.archived',
        actor,
        entity: { type: 'product', id: productId },
        details: { item: itemName(product.name, variant.variantName), variantId }
      })
    })
    return this.require(productId)
  }

  // --- checks ---------------------------------------------------------------

  /** References that must exist and be active (archived ones may stay on a product that has them). */
  private checkProduct(input: ProductInput, before: ProductDetail | null): void {
    if (input.categoryId !== null) {
      const category = this.deps.catalog.findCategory(input.categoryId)
      if (!category) throw invalid('categoryId', 'Choose a category')
      if (!category.active && input.categoryId !== before?.categoryId) {
        throw invalid('categoryId', `The category “${category.name}” is archived`)
      }
    }
    const taxClass = this.deps.taxClasses.find(input.taxClassId)
    if (!taxClass) throw invalid('taxClassId', 'Choose a tax rate')
    if (!taxClass.active && input.taxClassId !== before?.taxClassId) {
      throw invalid('taxClassId', `The tax rate “${taxClass.name}” is archived`)
    }
  }

  /** Pack sizes of one product need different names, and only one can be left unnamed. */
  private checkVariantSet(variants: readonly Pick<VariantInput, 'variantName'>[]): void {
    const names = variants.map((v) => v.variantName?.toLowerCase() ?? null)
    if (names.filter((name) => name === null).length > 1) {
      throw invalid(
        'variantName',
        'Only one pack size can be left without a name. Name this one, e.g. “1 kg”.'
      )
    }
    const named = names.filter((name): name is string => name !== null)
    if (new Set(named).size !== named.length) {
      throw invalid('variantName', 'Another pack size of this product already has this name')
    }
  }

  /** Unit, low-stock level and unique codes. Returns the input with its SKU resolved. */
  private checkVariant(
    input: VariantInput,
    before: VariantDetail | null,
    path: string
  ): VariantInput & { sku: string } {
    const unit = this.deps.catalog.findUnit(input.unitCode)
    if (!unit) throw invalid(`${path}unitCode`, 'Choose a unit')
    if (input.mrpMinor !== null && input.sellingPriceMinor > input.mrpMinor) {
      throw invalid(`${path}sellingPriceMinor`, "The selling price can't be more than the MRP")
    }
    if (
      input.reorderLevelMilli !== null &&
      !unit.allowsFraction &&
      input.reorderLevelMilli % QUANTITY_SCALE !== 0
    ) {
      throw invalid(`${path}reorderLevelMilli`, `${unit.name} are counted in whole numbers`)
    }
    const sku = input.sku ?? before?.sku ?? this.deps.products.nextSku()
    this.assertCodesFree(sku, input.barcodes, before?.variantId ?? null, path)
    return { ...input, sku }
  }

  private assertCodesFree(
    sku: string,
    barcodes: readonly string[],
    variantId: number | null,
    path: string
  ): void {
    const skuOwner = this.deps.products.skuOwner(sku)
    if (skuOwner && skuOwner.variantId !== variantId) {
      throw conflict(`${path}sku`, `The SKU ${sku} is already used by ${skuOwner.name}`)
    }
    for (const code of barcodes) {
      const owner = this.deps.products.barcodeOwner(code)
      if (owner && owner.variantId !== variantId) {
        // FR-022: one barcode, one item.
        throw conflict(`${path}barcodes`, `The barcode ${code} is already used by ${owner.name}`)
      }
    }
  }

  // --- audit wording ---------------------------------------------------------

  private money(minor: number | null): string | null {
    return minor === null ? null : formatMoney(minor, this.deps.currency())
  }

  private describeVariant(productName: string, variant: VariantInput): string {
    return `${itemName(productName, variant.variantName)} at ${this.money(variant.sellingPriceMinor) ?? ''}`
  }

  private readableProduct(product: ProductInput): Record<string, unknown> {
    return {
      name: product.name,
      category:
        product.categoryId === null
          ? null
          : (this.deps.catalog.findCategory(product.categoryId)?.name ?? null),
      taxClass: this.deps.taxClasses.find(product.taxClassId)?.name ?? null,
      hsnCode: product.hsnCode,
      tracksInventory: product.tracksInventory ? 'yes' : 'no'
    }
  }

  private readablePrices(variant: VariantInput): Record<string, unknown> {
    return {
      sellingPrice: this.money(variant.sellingPriceMinor),
      mrp: this.money(variant.mrpMinor),
      costPrice: this.money(variant.costPriceMinor)
    }
  }

  private readableVariant(variant: VariantInput): Record<string, unknown> {
    return {
      variantName: variant.variantName,
      sku: variant.sku,
      unit: variant.unitCode,
      reorderLevel:
        variant.reorderLevelMilli === null
          ? null
          : `${formatQuantity(variant.reorderLevelMilli)} ${variant.unitCode}`,
      barcodes: variant.barcodes.length > 0 ? [...variant.barcodes].sort().join(', ') : null
    }
  }

  private require(productId: number): ProductDetail {
    const product = this.deps.products.get(productId)
    if (!product) throw new AppError('NOT_FOUND', 'That product no longer exists.')
    return product
  }

  private requireProductOf(variantId: number): number {
    const productId = this.deps.products.productIdOf(variantId)
    if (productId === null) throw new AppError('NOT_FOUND', 'That pack size no longer exists.')
    return productId
  }
}

function toInput(variant: VariantDetail): VariantInput {
  return {
    variantName: variant.variantName,
    sku: variant.sku,
    unitCode: variant.unitCode,
    sellingPriceMinor: variant.sellingPriceMinor,
    mrpMinor: variant.mrpMinor,
    costPriceMinor: variant.costPriceMinor,
    reorderLevelMilli: variant.reorderLevelMilli,
    barcodes: variant.barcodes
  }
}
