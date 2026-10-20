import type {
  ItemLookup,
  ProductDetail,
  ProductInput,
  ProductListFilter,
  ProductListPage,
  VariantDetail,
  VariantInput
} from '@shared/ipc/contract'
import type { SQLInputValue } from 'node:sqlite'
import { Repository } from '../db/repository'
import { buildPrefixMatchQuery } from '../db/search'

export const DEFAULT_PAGE_SIZE = 50

interface ProductRow {
  product_id: number
  name: string
  category_id: number | null
  tax_class_id: number
  hsn_code: string | null
  tracks_inventory: number
  archived_at: number | null
  created_at: number
  updated_at: number
}

interface VariantRow {
  variant_id: number
  variant_name: string | null
  sku: string
  unit_code: string
  selling_price_minor: number
  mrp_minor: number | null
  cost_price_minor: number | null
  reorder_level_milli: number | null
  archived_at: number | null
  barcodes: string | null
  on_hand_milli: number | null
  has_history: number
}

interface ListRow {
  variant_id: number
  product_id: number
  product_name: string
  variant_name: string | null
  sku: string
  barcodes: string | null
  unit_code: string
  category_name: string | null
  selling_price_minor: number
  mrp_minor: number | null
  tracks_inventory: number
  on_hand_milli: number | null
  active: number
}

interface LookupRow {
  variant_id: number
  product_id: number
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string
  allows_fraction: number
  selling_price_minor: number
  mrp_minor: number | null
  tax_class_id: number
  tracks_inventory: number
  on_hand_milli: number | null
}

/** A variant's name with its product, as printed on bills: "Toor Dal 1 kg". */
export function itemName(productName: string, variantName: string | null): string {
  return variantName ? `${productName} ${variantName}` : productName
}

function splitList(value: string | null): string[] {
  return value ? value.split('\u001f') : []
}

/** Stock on hand, or null for products that don't track it. */
const ON_HAND = `CASE WHEN p.tracks_inventory = 1
  THEN (SELECT coalesce(sum(m.quantity_delta_milli), 0) FROM v_inventory_movements m
        WHERE m.variant_id = v.variant_id)
  END`

const BARCODES = `(SELECT group_concat(b.barcode, char(31)) FROM
  (SELECT barcode FROM barcodes WHERE variant_id = v.variant_id ORDER BY created_at, barcode) b)`

const LOOKUP = `
  SELECT v.variant_id, p.product_id, p.name AS product_name, v.variant_name, v.sku, v.unit_code,
         u.allows_fraction, v.selling_price_minor, v.mrp_minor, p.tax_class_id, p.tracks_inventory,
         ${ON_HAND} AS on_hand_milli
  FROM product_variants v
  JOIN products p ON p.product_id = v.product_id
  JOIN units u ON u.unit_code = v.unit_code`

function toLookup(row: LookupRow): ItemLookup {
  return {
    variantId: row.variant_id,
    productId: row.product_id,
    name: itemName(row.product_name, row.variant_name),
    sku: row.sku,
    unitCode: row.unit_code,
    allowsFraction: row.allows_fraction === 1,
    sellingPriceMinor: row.selling_price_minor,
    mrpMinor: row.mrp_minor,
    taxClassId: row.tax_class_id,
    tracksInventory: row.tracks_inventory === 1,
    onHandMilli: row.on_hand_milli
  }
}

/** Where a variant has been used: any of these makes its unit permanent. */
const HAS_HISTORY = `(
  EXISTS (SELECT 1 FROM sale_items x WHERE x.variant_id = v.variant_id) OR
  EXISTS (SELECT 1 FROM goods_receipt_items x WHERE x.variant_id = v.variant_id) OR
  EXISTS (SELECT 1 FROM purchase_order_items x WHERE x.variant_id = v.variant_id) OR
  EXISTS (SELECT 1 FROM stock_adjustment_items x WHERE x.variant_id = v.variant_id) OR
  EXISTS (SELECT 1 FROM held_bill_items x WHERE x.variant_id = v.variant_id))`

/**
 * The product aggregate (M09-02): a product with its variants and their
 * barcodes. The only code that writes `products`, `product_variants` and
 * `barcodes`; the FTS search index follows them through triggers.
 */
export class ProductRepository extends Repository {
  get(productId: number): ProductDetail | null {
    const product = this.db.get<ProductRow>('SELECT * FROM products WHERE product_id = ?', [
      productId
    ])
    if (!product) return null
    const variants = this.db
      .all<VariantRow>(
        `SELECT v.variant_id, v.variant_name, v.sku, v.unit_code, v.selling_price_minor, v.mrp_minor,
                v.cost_price_minor, v.reorder_level_milli, v.archived_at,
                ${BARCODES} AS barcodes, ${ON_HAND} AS on_hand_milli, ${HAS_HISTORY} AS has_history
         FROM product_variants v JOIN products p ON p.product_id = v.product_id
         WHERE v.product_id = ?
         ORDER BY v.archived_at IS NOT NULL, v.variant_id`,
        [productId]
      )
      .map((row): VariantDetail => ({
        variantId: row.variant_id,
        variantName: row.variant_name,
        sku: row.sku,
        unitCode: row.unit_code,
        sellingPriceMinor: row.selling_price_minor,
        mrpMinor: row.mrp_minor,
        costPriceMinor: row.cost_price_minor,
        reorderLevelMilli: row.reorder_level_milli,
        barcodes: splitList(row.barcodes),
        active: row.archived_at === null,
        onHandMilli: row.on_hand_milli,
        hasHistory: row.has_history === 1
      }))
    return {
      productId: product.product_id,
      name: product.name,
      categoryId: product.category_id,
      taxClassId: product.tax_class_id,
      hsnCode: product.hsn_code,
      tracksInventory: product.tracks_inventory === 1,
      active: product.archived_at === null,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
      variants
    }
  }

  productIdOf(variantId: number): number | null {
    return (
      this.db.get<{ product_id: number }>(
        'SELECT product_id FROM product_variants WHERE variant_id = ?',
        [variantId]
      )?.product_id ?? null
    )
  }

  /** Items (variants) matching the filter, by product name (M09-05). */
  list(filter: ProductListFilter): ProductListPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    const match = filter.search ? buildPrefixMatchQuery(filter.search) : null
    if (filter.search && match === null) return { items: [], total: 0 }
    if (match !== null) {
      where.push('v.variant_id IN (SELECT rowid FROM variant_search WHERE variant_search MATCH ?)')
      params.push(match)
    }
    if (filter.categoryId !== undefined) {
      where.push('p.category_id = ?')
      params.push(filter.categoryId)
    }
    const status = filter.status ?? 'active'
    if (status === 'active') where.push('v.archived_at IS NULL AND p.archived_at IS NULL')
    if (status === 'archived')
      where.push('(v.archived_at IS NOT NULL OR p.archived_at IS NOT NULL)')
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const from = 'FROM product_variants v JOIN products p ON p.product_id = v.product_id'

    const total = this.db.get<{ n: number }>(`SELECT count(*) AS n ${from} ${whereSql}`, params)?.n
    const rows = this.db.all<ListRow>(
      `SELECT v.variant_id, p.product_id, p.name AS product_name, v.variant_name, v.sku,
              ${BARCODES} AS barcodes, v.unit_code, c.name AS category_name,
              v.selling_price_minor, v.mrp_minor, p.tracks_inventory,
              ${ON_HAND} AS on_hand_milli,
              (v.archived_at IS NULL AND p.archived_at IS NULL) AS active
       ${from}
       LEFT JOIN categories c ON c.category_id = p.category_id
       ${whereSql}
       ORDER BY p.name COLLATE NOCASE, p.product_id, v.variant_name IS NOT NULL, v.variant_name, v.variant_id
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_PAGE_SIZE, filter.offset ?? 0]
    )
    return {
      total: total ?? 0,
      items: rows.map((row) => ({
        variantId: row.variant_id,
        productId: row.product_id,
        productName: row.product_name,
        variantName: row.variant_name,
        sku: row.sku,
        barcodes: splitList(row.barcodes),
        unitCode: row.unit_code,
        categoryName: row.category_name,
        sellingPriceMinor: row.selling_price_minor,
        mrpMinor: row.mrp_minor,
        tracksInventory: row.tracks_inventory === 1,
        onHandMilli: row.on_hand_milli,
        active: row.active === 1
      }))
    }
  }

  /**
   * The active item with this barcode, or failing that this SKU, as a scanner
   * would type either (M09-07). Exact match on the primary key: well under 100 ms.
   */
  findByCode(code: string): ItemLookup | null {
    const active = 'v.archived_at IS NULL AND p.archived_at IS NULL'
    const byBarcode = this.db.get<LookupRow>(
      `${LOOKUP} JOIN barcodes b ON b.variant_id = v.variant_id WHERE b.barcode = ? AND ${active}`,
      [code]
    )
    if (byBarcode) return toLookup(byBarcode)
    const bySku = this.db.get<LookupRow>(`${LOOKUP} WHERE v.sku = ? COLLATE NOCASE AND ${active}`, [
      code
    ])
    return bySku ? toLookup(bySku) : null
  }

  /**
   * Resolves a 5-digit variable-weight barcode item code (e.g. "00007") to an
   * active fractional-unit variant by 5-digit barcode, `ITEM-00007` SKU, or
   * `variant_id` (M24-02).
   */
  findForWeighItemCode(itemCode: string): ItemLookup | null {
    const activeFraction =
      'v.archived_at IS NULL AND p.archived_at IS NULL AND u.allows_fraction = 1'
    const byBarcode = this.db.get<LookupRow>(
      `${LOOKUP} JOIN barcodes b ON b.variant_id = v.variant_id
       WHERE b.barcode = ? AND ${activeFraction}`,
      [itemCode]
    )
    if (byBarcode) return toLookup(byBarcode)

    const skuCandidate = `ITEM-${itemCode}`
    const bySku = this.db.get<LookupRow>(
      `${LOOKUP} WHERE (v.sku = ? COLLATE NOCASE OR v.sku = ? COLLATE NOCASE) AND ${activeFraction}`,
      [skuCandidate, itemCode]
    )
    if (bySku) return toLookup(bySku)

    const numericId = Number(itemCode)
    if (Number.isInteger(numericId) && numericId > 0) {
      const byId = this.db.get<LookupRow>(
        `${LOOKUP} WHERE v.variant_id = ? AND ${activeFraction}`,
        [numericId]
      )
      if (byId) return toLookup(byId)
    }
    return null
  }

  /** Variant details needed for printing shelf/pack price labels (M24-03). */
  findVariantForLabel(variantId: number): {
    variantId: number
    productName: string
    variantName: string | null
    sku: string
    barcode: string | null
    unitCode: string
    sellingPriceMinor: number
    mrpMinor: number | null
  } | null {
    const row = this.db.get<{
      variant_id: number
      product_name: string
      variant_name: string | null
      sku: string
      barcodes: string | null
      unit_code: string
      selling_price_minor: number
      mrp_minor: number | null
    }>(
      `SELECT v.variant_id, p.name AS product_name, v.variant_name, v.sku,
              ${BARCODES} AS barcodes, v.unit_code, v.selling_price_minor, v.mrp_minor
       FROM product_variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = ?`,
      [variantId]
    )
    if (!row) return null
    const barcodes = splitList(row.barcodes)
    return {
      variantId: row.variant_id,
      productName: row.product_name,
      variantName: row.variant_name,
      sku: row.sku,
      barcode: barcodes[0] ?? null,
      unitCode: row.unit_code,
      sellingPriceMinor: row.selling_price_minor,
      mrpMinor: row.mrp_minor
    }
  }

  /** Active items whose name, SKU or barcode starts with the typed words, best match first. */
  search(query: string, limit: number): ItemLookup[] {
    const match = buildPrefixMatchQuery(query)
    if (match === null) return []
    return this.db
      .all<LookupRow>(
        `SELECT l.* FROM variant_search s JOIN (${LOOKUP}
           WHERE v.archived_at IS NULL AND p.archived_at IS NULL) l ON l.variant_id = s.rowid
         WHERE variant_search MATCH ?
         ORDER BY s.rank LIMIT ?`,
        [match, limit]
      )
      .map(toLookup)
  }

  /** Which variant, if any, already has this barcode. */
  barcodeOwner(barcode: string): { variantId: number; name: string } | null {
    const row = this.db.get<{ variant_id: number; name: string; variant_name: string | null }>(
      `SELECT v.variant_id, p.name, v.variant_name FROM barcodes b
       JOIN product_variants v ON v.variant_id = b.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE b.barcode = ?`,
      [barcode]
    )
    return row ? { variantId: row.variant_id, name: itemName(row.name, row.variant_name) } : null
  }

  skuOwner(sku: string): { variantId: number; name: string } | null {
    const row = this.db.get<{ variant_id: number; name: string; variant_name: string | null }>(
      `SELECT v.variant_id, p.name, v.variant_name FROM product_variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.sku = ? COLLATE NOCASE`,
      [sku]
    )
    return row ? { variantId: row.variant_id, name: itemName(row.name, row.variant_name) } : null
  }

  /** A free SKU like ITEM-00042, numbered after the variant it is for. */
  nextSku(): string {
    let number =
      this.db.get<{ n: number }>(
        'SELECT coalesce(max(variant_id), 0) + 1 AS n FROM product_variants'
      )?.n ?? 1
    for (;;) {
      const candidate = `ITEM-${String(number).padStart(5, '0')}`
      if (!this.skuOwner(candidate)) return candidate
      number++
    }
  }

  createProduct(input: ProductInput): number {
    return this.insertWithTimestamps('products', {
      name: input.name,
      category_id: input.categoryId,
      tax_class_id: input.taxClassId,
      hsn_code: input.hsnCode,
      tracks_inventory: input.tracksInventory ? 1 : 0
    })
  }

  updateProduct(productId: number, input: ProductInput): void {
    this.update('products', 'product_id', productId, {
      name: input.name,
      category_id: input.categoryId,
      tax_class_id: input.taxClassId,
      hsn_code: input.hsnCode,
      tracks_inventory: input.tracksInventory ? 1 : 0
    })
  }

  setProductActive(productId: number, active: boolean): void {
    if (active) this.update('products', 'product_id', productId, { archived_at: null })
    else this.archive('products', 'product_id', productId)
  }

  /** `sku` must already be resolved (see nextSku). */
  createVariant(productId: number, input: VariantInput & { sku: string }): number {
    const variantId = this.insertWithTimestamps('product_variants', {
      product_id: productId,
      ...variantColumns(input)
    })
    this.replaceBarcodes(variantId, input.barcodes)
    return variantId
  }

  updateVariant(variantId: number, input: VariantInput & { sku: string }): void {
    this.update('product_variants', 'variant_id', variantId, variantColumns(input))
    this.replaceBarcodes(variantId, input.barcodes)
  }

  setVariantActive(variantId: number, active: boolean): void {
    if (active) this.update('product_variants', 'variant_id', variantId, { archived_at: null })
    else this.archive('product_variants', 'variant_id', variantId)
  }

  /** Keeps barcodes that stay (and when they were added); adds and removes the rest. */
  private replaceBarcodes(variantId: number, barcodes: readonly string[]): void {
    const current = new Set(
      this.db
        .all<{ barcode: string }>('SELECT barcode FROM barcodes WHERE variant_id = ?', [variantId])
        .map((row) => row.barcode)
    )
    for (const code of current) {
      if (!barcodes.includes(code)) this.db.run('DELETE FROM barcodes WHERE barcode = ?', [code])
    }
    for (const code of barcodes) {
      if (!current.has(code)) {
        this.insert('barcodes', { barcode: code, variant_id: variantId, created_at: this.now() })
      }
    }
  }
}

function variantColumns(input: VariantInput & { sku: string }) {
  return {
    variant_name: input.variantName,
    sku: input.sku,
    unit_code: input.unitCode,
    selling_price_minor: input.sellingPriceMinor,
    mrp_minor: input.mrpMinor,
    cost_price_minor: input.costPriceMinor,
    reorder_level_milli: input.reorderLevelMilli
  }
}
