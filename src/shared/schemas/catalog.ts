/**
 * Validation for the product catalogue (M09), shared by the product screens
 * and the main-process handlers. Rules that need the database (barcodes
 * already in use, a category that exists, the unit's fraction rule) are
 * checked again by CatalogService.
 */
import { z } from 'zod'
import { money, optionalMoney, optionalQuantity, optionalText, requiredText } from '../validation'

const id = z.number().int().positive()

export const BARCODE_MAX_LENGTH = 64

export const categoryName = requiredText('a category name', 60)

export const unitCode = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter a short code, e.g. "tray"')
  .max(12, 'Unit codes have at most 12 characters')
  .regex(/^[a-z][a-z0-9]*$/, 'Use lowercase letters and numbers, starting with a letter')

export const unitName = requiredText('the unit name', 40)

export const productName = requiredText('the product name', 120)

export const hsnCode = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z
      .string()
      .regex(/^\d{4}(\d{2}){0,2}$/, 'HSN codes have 4, 6 or 8 digits')
      .nullable()
  )
  .nullable()

export const variantName = optionalText('the pack size', 40)

export const sku = z
  .string()
  .trim()
  .max(40, 'SKUs have at most 40 characters')
  .regex(/^[^\s]*$/, "SKUs can't contain spaces")
  .transform((value) => (value === '' ? null : value))
  .nullable()

/** One barcode: printable characters without spaces, as a scanner types it. */
export const barcode = z
  .string()
  .trim()
  .min(1, 'Enter the barcode')
  .max(BARCODE_MAX_LENGTH, `Barcodes have at most ${BARCODE_MAX_LENGTH} characters`)
  .regex(/^[\x21-\x7e]+$/, 'Barcodes are letters, digits and symbols without spaces')

/** Barcodes as typed in one field: separated by commas, spaces or new lines. */
export function splitBarcodes(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((code) => code.trim())
        .filter(Boolean)
    )
  ]
}

export const barcodeList = z
  .array(barcode)
  .max(20, 'At most 20 barcodes per item')
  .refine((codes) => new Set(codes).size === codes.length, 'A barcode is listed twice')

/** Prices are entered in the store's currency; `minorUnits` comes from it. */
export function variantFields(minorUnits = 2) {
  return {
    variantName,
    sku,
    unitCode: z.string().min(1, 'Choose a unit'),
    sellingPriceMinor: money('the selling price', { minorUnits }),
    mrpMinor: optionalMoney('the MRP', { minorUnits }),
    costPriceMinor: optionalMoney('the cost price', { minorUnits }),
    reorderLevelMilli: optionalQuantity('the low-stock level', { allowsFraction: true }),
    barcodes: barcodeList
  }
}

function checkPrices(
  value: { sellingPriceMinor: number; mrpMinor: number | null },
  ctx: z.RefinementCtx
): void {
  if (value.mrpMinor !== null && value.sellingPriceMinor > value.mrpMinor) {
    ctx.addIssue({
      code: 'custom',
      path: ['sellingPriceMinor'],
      message: "The selling price can't be more than the MRP"
    })
  }
}

export const variantInputSchema = z.object(variantFields()).superRefine(checkPrices)

export const productFields = {
  name: productName,
  categoryId: id.nullable(),
  taxClassId: id,
  hsnCode,
  tracksInventory: z.boolean()
}

export const newProductSchema = z.object({
  ...productFields,
  variants: z
    .array(variantInputSchema)
    .min(1, 'Add at least one pack size')
    .max(50, 'At most 50 pack sizes per product')
})

export const productUpdateSchema = z.object({ productId: id, ...productFields })

export const newVariantSchema = z
  .object({ productId: id, ...variantFields() })
  .superRefine(checkPrices)

export const variantUpdateSchema = z
  .object({ variantId: id, ...variantFields() })
  .superRefine(checkPrices)

export const productListFilterSchema = z.object({
  search: z.string().max(200).optional(),
  categoryId: id.optional(),
  status: z.enum(['active', 'archived', 'all']).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const productSearchSchema = z.object({
  query: z.string().max(200),
  limit: z.number().int().min(1).max(50).optional()
})

export const idSchemas = {
  product: z.object({ productId: id }),
  productActive: z.object({ productId: id, active: z.boolean() }),
  variantActive: z.object({ variantId: id, active: z.boolean() }),
  category: z.object({ categoryId: id, name: categoryName }),
  categoryActive: z.object({ categoryId: id, active: z.boolean() })
}

/** Field names as people read them: audit log changes. */
export const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name: 'name',
  category: 'category',
  taxClass: 'tax rate',
  hsnCode: 'HSN code',
  tracksInventory: 'tracks stock',
  variantName: 'pack size',
  sku: 'SKU',
  unit: 'unit',
  sellingPrice: 'selling price',
  mrp: 'MRP',
  costPrice: 'cost price',
  reorderLevel: 'low-stock level',
  barcodes: 'barcodes'
}
