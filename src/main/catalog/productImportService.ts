import {
  buildProductImportTemplate,
  parseCsv,
  resolveCsvColumnMapping
} from '@shared/csv'
import type {
  ProductImportCommitResult,
  ProductImportInput,
  ProductImportPreview,
  ProductImportRowIssue,
  ProductImportRowPreview,
  ProductImportTemplate,
  TaxClassSummary,
  UnitInfo
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { parseMoney, type CurrencyFormat } from '@shared/money'
import { parseQuantity } from '@shared/quantity'
import {
  barcode as barcodeSchema,
  categoryName as categoryNameSchema,
  hsnCode as hsnCodeSchema,
  productName as productNameSchema,
  sku as skuSchema,
  splitBarcodes,
  variantName as variantNameSchema
} from '@shared/schemas/catalog'
import { summariseLines, type AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import type { Database } from '../db/database'
import type { CatalogRepository } from './catalogRepository'
import type { ProductRepository } from './productRepository'
import type { TaxClassRepository } from './taxClassRepository'

export interface ProductImportServiceDeps {
  db: Database
  products: ProductRepository
  catalog: CatalogRepository
  taxClasses: TaxClassRepository
  audit: AuditLog
  currency(): CurrencyFormat
}

interface ValidatedImportRow {
  rowNumber: number
  productName: string
  variantName: string | null
  sku: string | null
  barcodes: string[]
  categoryName: string | null
  existingCategoryId: number | null
  willCreateCategory: boolean
  unitCode: string
  sellingPriceMinor: number
  mrpMinor: number | null
  costPriceMinor: number | null
  taxClassId: number
  taxClassName: string
  hsnCode: string | null
  reorderLevelMilli: number | null
  tracksInventory: boolean
}

/**
 * M22-01 & M22-02 (FR-026): CSV product import with template download,
 * header mapping, row-by-row validation preview with error report, and
 * atomic batch commit that rejects any batch with invalid rows so no rows
 * are ever silently dropped.
 */
export class ProductImportService {
  constructor(private readonly deps: ProductImportServiceDeps) {}

  getTemplate(actor: Actor): ProductImportTemplate {
    assertCan(actor, 'data.import')
    return buildProductImportTemplate()
  }

  preview(actor: Actor, input: ProductImportInput): ProductImportPreview {
    assertCan(actor, 'data.import')
    return this.evaluate(input).preview
  }

  commit(actor: Actor, input: ProductImportInput): ProductImportCommitResult {
    assertCan(actor, 'data.import')
    const { preview, validatedRows } = this.evaluate(input)
    if (preview.totalRows === 0) {
      throw new AppError('VALIDATION_FAILED', 'The CSV file has no product rows to import.')
    }
    if (preview.errorRowCount > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Cannot import: ${preview.errorRowCount} of ${preview.totalRows} row(s) have validation errors. Fix all errors in the preview and try again.`
      )
    }

    const { db, catalog, products, audit } = this.deps
    return db.transaction(() => {
      // 1. Create any new categories referenced by the batch.
      const categoryIdByLower = new Map<string, number>()
      for (const cat of catalog.listCategories()) {
        categoryIdByLower.set(cat.name.toLowerCase(), cat.categoryId)
      }
      let createdCategoryCount = 0
      for (const catName of preview.categoriesToCreate) {
        const key = catName.toLowerCase()
        if (!categoryIdByLower.has(key)) {
          const newId = catalog.createCategory(catName)
          categoryIdByLower.set(key, newId)
          createdCategoryCount++
        }
      }

      // 2. Group validated rows by productName (case-insensitive) preserving first-seen order.
      const groups = new Map<string, ValidatedImportRow[]>()
      for (const row of validatedRows) {
        const key = row.productName.toLowerCase()
        const existing = groups.get(key)
        if (existing) existing.push(row)
        else groups.set(key, [row])
      }

      let createdProductCount = 0
      let createdVariantCount = 0
      const importedItemNames: string[] = []

      for (const groupRows of groups.values()) {
        const first = groupRows[0]
        if (!first) continue
        const categoryId =
          first.categoryName === null
            ? null
            : (categoryIdByLower.get(first.categoryName.toLowerCase()) ?? null)

        const productId = products.createProduct({
          name: first.productName,
          categoryId,
          taxClassId: first.taxClassId,
          hsnCode: first.hsnCode,
          tracksInventory: first.tracksInventory
        })
        createdProductCount++

        for (const variantRow of groupRows) {
          const resolvedSku = variantRow.sku ?? products.nextSku()
          products.createVariant(productId, {
            variantName: variantRow.variantName,
            sku: resolvedSku,
            unitCode: variantRow.unitCode,
            sellingPriceMinor: variantRow.sellingPriceMinor,
            mrpMinor: variantRow.mrpMinor,
            costPriceMinor: variantRow.costPriceMinor,
            reorderLevelMilli: variantRow.reorderLevelMilli,
            barcodes: variantRow.barcodes
          })
          createdVariantCount++
          importedItemNames.push(
            variantRow.variantName
              ? `${variantRow.productName} ${variantRow.variantName} (${resolvedSku})`
              : `${variantRow.productName} (${resolvedSku})`
          )
        }
      }

      audit.change({
        action: 'data.products_imported',
        actor,
        details: {
          productsCreated: createdProductCount,
          variantsCreated: createdVariantCount,
          categoriesCreated: createdCategoryCount,
          ...summariseLines(importedItemNames)
        }
      })

      return {
        importedRowCount: validatedRows.length,
        createdProductCount,
        createdVariantCount,
        createdCategoryCount
      }
    })
  }

  private evaluate(input: ProductImportInput): {
    preview: ProductImportPreview
    validatedRows: ValidatedImportRow[]
  } {
    let parsed
    try {
      parsed = parseCsv(input.csvText)
    } catch (error) {
      throw new AppError(
        'VALIDATION_FAILED',
        error instanceof Error ? error.message : 'Could not parse CSV text'
      )
    }

    const resolvedMapping = resolveCsvColumnMapping(parsed.headers, input.mapping)
    const minorUnits = this.deps.currency().minorUnits

    const unitsByCode = new Map<string, UnitInfo>()
    const unitsByName = new Map<string, UnitInfo>()
    for (const u of this.deps.catalog.listUnits()) {
      unitsByCode.set(u.unitCode.toLowerCase(), u)
      unitsByName.set(u.name.toLowerCase(), u)
    }

    const categoriesByName = new Map<string, { categoryId: number; name: string; active: boolean }>()
    for (const c of this.deps.catalog.listCategories()) {
      categoriesByName.set(c.name.toLowerCase(), c)
    }

    const activeTaxClasses = this.deps.taxClasses.list().filter((t) => t.active)
    const defaultTaxClass = activeTaxClasses[0] ?? null

    // Track intra-batch duplicates and consistency across variants of the same product
    const seenSkusInBatch = new Map<string, number>()
    const seenBarcodesInBatch = new Map<string, number>()
    const seenProductVariantNames = new Map<string, Set<string>>()
    const productHeaderSnapshot = new Map<
      string,
      {
        rowNumber: number
        categoryKey: string | null
        taxClassId: number | null
        hsnCode: string | null
        tracksInventory: boolean
      }
    >()

    const previewRows: ProductImportRowPreview[] = []
    const validatedRows: ValidatedImportRow[] = []
    const newCategoriesMap = new Map<string, string>()

    for (const rawRow of parsed.rows) {
      const issues: ProductImportRowIssue[] = []
      const getVal = (field: keyof typeof resolvedMapping): string => {
        const colName = resolvedMapping[field]
        return colName ? (rawRow.values[colName] ?? '').trim() : ''
      }

      // 1. Product Name
      const rawProductName = getVal('productName')
      const parsedProductName = productNameSchema.safeParse(rawProductName)
      const productName = parsedProductName.success ? parsedProductName.data : rawProductName
      if (!parsedProductName.success) {
        issues.push({
          field: 'productName',
          message: parsedProductName.error.issues[0]?.message ?? 'Enter the product name'
        })
      }

      // 2. Variant Name
      const rawVariantName = getVal('variantName')
      const parsedVariantName = variantNameSchema.safeParse(rawVariantName)
      const variantName = parsedVariantName.success ? parsedVariantName.data : null
      if (!parsedVariantName.success) {
        issues.push({
          field: 'variantName',
          message: parsedVariantName.error.issues[0]?.message ?? 'Invalid pack size name'
        })
      }

      // 3. SKU
      const rawSku = getVal('sku')
      const parsedSku = skuSchema.safeParse(rawSku)
      const sku = parsedSku.success ? parsedSku.data : null
      if (!parsedSku.success) {
        issues.push({
          field: 'sku',
          message: parsedSku.error.issues[0]?.message ?? 'Invalid SKU'
        })
      } else if (sku !== null) {
        const skuKey = sku.toLowerCase()
        const existingOwner = this.deps.products.skuOwner(sku)
        if (existingOwner) {
          issues.push({
            field: 'sku',
            message: `The SKU ${sku} is already used by ${existingOwner.name}`
          })
        } else if (seenSkusInBatch.has(skuKey)) {
          issues.push({
            field: 'sku',
            message: `The SKU ${sku} is duplicated in this CSV (also on row ${seenSkusInBatch.get(skuKey)})`
          })
        } else {
          seenSkusInBatch.set(skuKey, rawRow.rowNumber)
        }
      }

      // 4. Barcodes (supports space, comma, or semicolon separated codes in the barcode cell)
      const rawBarcodesText = getVal('barcode').replace(/;/g, ' ')
      const barcodes = splitBarcodes(rawBarcodesText)
      for (const code of barcodes) {
        const checkCode = barcodeSchema.safeParse(code)
        if (!checkCode.success) {
          issues.push({
            field: 'barcode',
            message: `Barcode "${code}": ${checkCode.error.issues[0]?.message ?? 'Invalid barcode'}`
          })
          continue
        }
        const existingBarcodeOwner = this.deps.products.barcodeOwner(code)
        if (existingBarcodeOwner) {
          issues.push({
            field: 'barcode',
            message: `The barcode ${code} is already used by ${existingBarcodeOwner.name}`
          })
        } else if (seenBarcodesInBatch.has(code)) {
          issues.push({
            field: 'barcode',
            message: `The barcode ${code} is duplicated in this CSV (also on row ${seenBarcodesInBatch.get(code)})`
          })
        } else {
          seenBarcodesInBatch.set(code, rawRow.rowNumber)
        }
      }

      // 5. Category
      const rawCategory = getVal('category')
      let categoryName: string | null = null
      let existingCategoryId: number | null = null
      let willCreateCategory = false
      if (rawCategory !== '') {
        const parsedCat = categoryNameSchema.safeParse(rawCategory)
        if (!parsedCat.success) {
          issues.push({
            field: 'category',
            message: parsedCat.error.issues[0]?.message ?? 'Invalid category name'
          })
        } else {
          const foundCat = categoriesByName.get(parsedCat.data.toLowerCase())
          if (foundCat) {
            if (!foundCat.active) {
              issues.push({
                field: 'category',
                message: `The category "${foundCat.name}" is archived`
              })
            } else {
              categoryName = foundCat.name
              existingCategoryId = foundCat.categoryId
            }
          } else {
            categoryName = parsedCat.data
            willCreateCategory = true
          }
        }
      }

      // 6. Unit
      const rawUnit = getVal('unitCode')
      const resolvedUnit =
        unitsByCode.get(rawUnit.toLowerCase()) ?? unitsByName.get(rawUnit.toLowerCase()) ?? null
      const unitCode = resolvedUnit ? resolvedUnit.unitCode : rawUnit
      if (!resolvedUnit) {
        issues.push({
          field: 'unitCode',
          message:
            rawUnit === ''
              ? 'Enter a unit code (e.g. pcs, kg, g, l, ml)'
              : `Unknown unit "${rawUnit}". Use an existing unit code such as pcs, kg, g, l, ml.`
        })
      }

      // 7. Selling price, MRP, Cost price
      const rawSellingPrice = getVal('sellingPrice')
      let sellingPriceMinor: number | null = null
      if (rawSellingPrice === '') {
        issues.push({ field: 'sellingPrice', message: 'Enter the selling price' })
      } else {
        try {
          const parsedMoney = parseMoney(rawSellingPrice, minorUnits)
          if (parsedMoney < 0 || parsedMoney > 1_000_000_000) {
            issues.push({
              field: 'sellingPrice',
              message: 'Selling price must be between 0 and 10,000,000'
            })
          } else {
            sellingPriceMinor = parsedMoney
          }
        } catch {
          issues.push({
            field: 'sellingPrice',
            message: `Invalid selling price "${rawSellingPrice}"`
          })
        }
      }

      const rawMrp = getVal('mrp')
      let mrpMinor: number | null = null
      if (rawMrp !== '') {
        try {
          const parsedMrp = parseMoney(rawMrp, minorUnits)
          if (parsedMrp < 0 || parsedMrp > 1_000_000_000) {
            issues.push({ field: 'mrp', message: 'MRP must be between 0 and 10,000,000' })
          } else {
            mrpMinor = parsedMrp
          }
        } catch {
          issues.push({ field: 'mrp', message: `Invalid MRP "${rawMrp}"` })
        }
      }

      if (sellingPriceMinor !== null && mrpMinor !== null && sellingPriceMinor > mrpMinor) {
        issues.push({
          field: 'sellingPrice',
          message: "The selling price can't be more than the MRP"
        })
      }

      const rawCost = getVal('costPrice')
      let costPriceMinor: number | null = null
      if (rawCost !== '') {
        try {
          const parsedCost = parseMoney(rawCost, minorUnits)
          if (parsedCost < 0 || parsedCost > 1_000_000_000) {
            issues.push({
              field: 'costPrice',
              message: 'Cost price must be between 0 and 10,000,000'
            })
          } else {
            costPriceMinor = parsedCost
          }
        } catch {
          issues.push({ field: 'costPrice', message: `Invalid cost price "${rawCost}"` })
        }
      }

      // 8. Tax class
      const rawTax = getVal('taxClass')
      let resolvedTax: TaxClassSummary | null
      if (rawTax === '') {
        resolvedTax = defaultTaxClass
        if (!resolvedTax) {
          issues.push({ field: 'taxClass', message: 'No active tax rate exists in the store' })
        }
      } else {
        resolvedTax = matchTaxClass(rawTax, activeTaxClasses)
        if (!resolvedTax) {
          issues.push({
            field: 'taxClass',
            message: `Unknown tax rate "${rawTax}". Choose one of: ${activeTaxClasses.map((t) => t.name).join(', ')}`
          })
        }
      }

      // 9. HSN code
      const rawHsn = getVal('hsnCode')
      const parsedHsn = hsnCodeSchema.safeParse(rawHsn)
      const hsnCode = parsedHsn.success ? parsedHsn.data : null
      if (!parsedHsn.success) {
        issues.push({
          field: 'hsnCode',
          message: parsedHsn.error.issues[0]?.message ?? 'HSN codes have 4, 6 or 8 digits'
        })
      }

      // 10. Reorder level
      const rawReorder = getVal('reorderLevel')
      let reorderLevelMilli: number | null = null
      if (rawReorder !== '') {
        const allowsFraction = resolvedUnit?.allowsFraction ?? true
        if (rawReorder === '0') {
          reorderLevelMilli = 0
        } else {
          try {
            reorderLevelMilli = parseQuantity(rawReorder, { allowsFraction })
          } catch (error) {
            issues.push({
              field: 'reorderLevel',
              message:
                error instanceof RangeError
                  ? error.message
                  : `Invalid reorder level "${rawReorder}"`
            })
          }
        }
      }

      // 11. Tracks inventory
      const rawTracks = getVal('tracksInventory').toLowerCase()
      let tracksInventory = true
      if (rawTracks !== '') {
        if (['yes', 'true', '1', 'y'].includes(rawTracks)) {
          tracksInventory = true
        } else if (['no', 'false', '0', 'n'].includes(rawTracks)) {
          tracksInventory = false
        } else {
          issues.push({
            field: 'tracksInventory',
            message: 'Use "yes" or "no" for tracks_inventory'
          })
        }
      }

      // 12. Product-level variant grouping & consistency rules
      if (parsedProductName.success) {
        const prodKey = productName.toLowerCase()
        const variantKey = variantName === null ? '__default__' : variantName.toLowerCase()
        const variantSet = seenProductVariantNames.get(prodKey) ?? new Set<string>()
        if (variantSet.has(variantKey)) {
          issues.push({
            field: 'variantName',
            message:
              variantName === null
                ? `Product "${productName}" has multiple unnamed pack sizes in this CSV. Give each pack size a name (e.g. "1 kg").`
                : `Product "${productName}" already has pack size "${variantName}" in this CSV.`
          })
        } else {
          variantSet.add(variantKey)
          seenProductVariantNames.set(prodKey, variantSet)
        }

        const prevSnap = productHeaderSnapshot.get(prodKey)
        const catKey = categoryName ? categoryName.toLowerCase() : null
        const taxId = resolvedTax?.taxClassId ?? null
        if (!prevSnap) {
          productHeaderSnapshot.set(prodKey, {
            rowNumber: rawRow.rowNumber,
            categoryKey: catKey,
            taxClassId: taxId,
            hsnCode,
            tracksInventory
          })
        } else {
          if (prevSnap.categoryKey !== catKey) {
            issues.push({
              field: 'category',
              message: `All pack sizes of "${productName}" must share the same category (differs from row ${prevSnap.rowNumber})`
            })
          }
          if (prevSnap.taxClassId !== taxId) {
            issues.push({
              field: 'taxClass',
              message: `All pack sizes of "${productName}" must share the same tax rate (differs from row ${prevSnap.rowNumber})`
            })
          }
          if (prevSnap.hsnCode !== hsnCode) {
            issues.push({
              field: 'hsnCode',
              message: `All pack sizes of "${productName}" must share the same HSN code (differs from row ${prevSnap.rowNumber})`
            })
          }
        }
      }

      const valid = issues.length === 0
      previewRows.push({
        rowNumber: rawRow.rowNumber,
        valid,
        productName,
        variantName,
        sku,
        barcodes,
        categoryName,
        willCreateCategory,
        unitCode,
        sellingPriceMinor,
        mrpMinor,
        costPriceMinor,
        taxClassName: resolvedTax?.name ?? (rawTax || null),
        hsnCode,
        reorderLevelMilli,
        tracksInventory,
        issues
      })

      if (valid && sellingPriceMinor !== null && resolvedTax !== null && resolvedUnit !== null) {
        if (willCreateCategory && categoryName !== null) {
          const catLower = categoryName.toLowerCase()
          if (!newCategoriesMap.has(catLower)) {
            newCategoriesMap.set(catLower, categoryName)
          }
        }
        validatedRows.push({
          rowNumber: rawRow.rowNumber,
          productName,
          variantName,
          sku,
          barcodes,
          categoryName,
          existingCategoryId,
          willCreateCategory,
          unitCode: resolvedUnit.unitCode,
          sellingPriceMinor,
          mrpMinor,
          costPriceMinor,
          taxClassId: resolvedTax.taxClassId,
          taxClassName: resolvedTax.name,
          hsnCode,
          reorderLevelMilli,
          tracksInventory
        })
      }
    }

    // Second pass: if a product has multiple variants in the CSV and one of them has variantName === null,
    // ProductService requires every variant to be named when there are > 1 variants, OR at most one unnamed.
    // Wait: ProductService.checkVariantSet allows at most 1 unnamed variant (`names.filter(n => n === null).length > 1`).
    // So 1 unnamed + 1 named is actually allowed by ProductService! And multiple unnamed was already caught above.

    const validProductNames = new Set(validatedRows.map((r) => r.productName.toLowerCase()))
    const errorRowCount = previewRows.filter((r) => !r.valid).length

    return {
      preview: {
        totalRows: previewRows.length,
        validRowCount: validatedRows.length,
        errorRowCount,
        productCountToCreate: validProductNames.size,
        variantCountToCreate: validatedRows.length,
        categoriesToCreate: [...newCategoriesMap.values()],
        detectedHeaders: parsed.headers,
        resolvedMapping,
        rows: previewRows
      },
      validatedRows
    }
  }
}

function matchTaxClass(
  raw: string,
  activeClasses: readonly TaxClassSummary[]
): TaxClassSummary | null {
  const trimmed = raw.trim().toLowerCase()
  const byName = activeClasses.find((t) => t.name.toLowerCase() === trimmed)
  if (byName) return byName

  // Match percentage strings like "5", "5%", "18%"
  const rateMatch = /^(\d+(?:\.\d+)?)\s*%?$/.exec(trimmed)
  if (rateMatch) {
    const rateBp = Math.round(Number(rateMatch[1]) * 100)
    const byRate = activeClasses.find((t) => t.rateBp === rateBp && t.cessRateBp === 0)
    if (byRate) return byRate
  }
  return null
}
