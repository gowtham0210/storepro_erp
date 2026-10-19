import { z } from 'zod'
import type { ProductDetail, UnitInfo, VariantDetail } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { toDecimalString } from '@shared/money'
import { formatQuantity, QUANTITY_SCALE } from '@shared/quantity'
import {
  barcodeList,
  hsnCode,
  productName,
  sku,
  splitBarcodes,
  variantName
} from '@shared/schemas/catalog'
import { money, optionalMoney, optionalQuantity } from '@shared/validation'

/**
 * Product and pack-size forms: every field a string, as form controls hold
 * them. Field names match the IPC input, so the main process's field errors
 * land on the right control. The rules are the shared ones the handlers apply
 * again.
 */
export interface ProductFormValues {
  name: string
  categoryId: string
  taxClassId: string
  hsnCode: string
  tracksInventory: 'yes' | 'no'
}

export interface VariantFormValues {
  variantName: string
  sku: string
  unitCode: string
  sellingPriceMinor: string
  mrpMinor: string
  costPriceMinor: string
  reorderLevelMilli: string
  barcodes: string
}

export const productFormSchema = z.object({
  name: productName,
  categoryId: z.string().transform((value) => (value === '' ? null : Number(value))),
  taxClassId: z.string().min(1, 'Choose a tax rate').transform(Number),
  hsnCode,
  tracksInventory: z.enum(['yes', 'no']).transform((value) => value === 'yes')
})

export function variantFormSchema(minorUnits: number, units: readonly UnitInfo[]) {
  return z
    .object({
      variantName,
      sku: sku.transform((value) => value ?? null),
      unitCode: z.string().min(1, 'Choose a unit'),
      sellingPriceMinor: money('the selling price', { minorUnits }),
      mrpMinor: optionalMoney('the MRP', { minorUnits }),
      costPriceMinor: optionalMoney('the cost price', { minorUnits }),
      reorderLevelMilli: optionalQuantity('the low-stock level', { allowsFraction: true }),
      barcodes: z.string().transform(splitBarcodes).pipe(barcodeList)
    })
    .superRefine((value, ctx) => {
      if (value.mrpMinor !== null && value.sellingPriceMinor > value.mrpMinor) {
        ctx.addIssue({
          code: 'custom',
          path: ['sellingPriceMinor'],
          message: "The selling price can't be more than the MRP"
        })
      }
      const unit = units.find((u) => u.unitCode === value.unitCode)
      if (
        unit &&
        !unit.allowsFraction &&
        value.reorderLevelMilli !== null &&
        value.reorderLevelMilli % QUANTITY_SCALE !== 0
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['reorderLevelMilli'],
          message: `${unit.name} are counted in whole numbers`
        })
      }
    })
}

export function emptyProductForm(defaultTaxClassId: number | undefined): ProductFormValues {
  return {
    name: '',
    categoryId: '',
    taxClassId: defaultTaxClassId === undefined ? '' : String(defaultTaxClassId),
    hsnCode: '',
    tracksInventory: 'yes'
  }
}

export function emptyVariantForm(): VariantFormValues {
  return {
    variantName: '',
    sku: '',
    unitCode: 'pcs',
    sellingPriceMinor: '',
    mrpMinor: '',
    costPriceMinor: '',
    reorderLevelMilli: '',
    barcodes: ''
  }
}

export function productFormFrom(product: ProductDetail): ProductFormValues {
  return {
    name: product.name,
    categoryId: product.categoryId === null ? '' : String(product.categoryId),
    taxClassId: String(product.taxClassId),
    hsnCode: product.hsnCode ?? '',
    tracksInventory: product.tracksInventory ? 'yes' : 'no'
  }
}

export function variantFormFrom(variant: VariantDetail, minorUnits: number): VariantFormValues {
  const amount = (minor: number | null): string =>
    minor === null ? '' : toDecimalString(minor, minorUnits)
  return {
    variantName: variant.variantName ?? '',
    sku: variant.sku,
    unitCode: variant.unitCode,
    sellingPriceMinor: amount(variant.sellingPriceMinor),
    mrpMinor: amount(variant.mrpMinor),
    costPriceMinor: amount(variant.costPriceMinor),
    reorderLevelMilli:
      variant.reorderLevelMilli === null ? '' : formatQuantity(variant.reorderLevelMilli),
    barcodes: variant.barcodes.join(', ')
  }
}

/**
 * The main process names a new product's pack-size fields `variants.0.â€¦`;
 * the form shows that pack size's fields without the prefix.
 */
export function withoutVariantPrefix(error: unknown): unknown {
  if (!(error instanceof AppError) || !Array.isArray(error.details)) return error
  return new AppError(
    error.code,
    error.message,
    (error.details as { path?: unknown; message?: unknown }[]).map((issue) => ({
      ...issue,
      path: typeof issue.path === 'string' ? issue.path.replace(/^variants\.\d+\./, '') : issue.path
    }))
  )
}
