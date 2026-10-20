import { z } from 'zod'

export const MAX_CSV_BYTES = 5 * 1024 * 1024 // 5 MB

export const productCsvColumnMappingSchema = z
  .object({
    productName: z.string().trim().min(1).optional(),
    variantName: z.string().trim().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    barcode: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    unitCode: z.string().trim().min(1).optional(),
    sellingPrice: z.string().trim().min(1).optional(),
    mrp: z.string().trim().min(1).optional(),
    costPrice: z.string().trim().min(1).optional(),
    taxClass: z.string().trim().min(1).optional(),
    hsnCode: z.string().trim().min(1).optional(),
    reorderLevel: z.string().trim().min(1).optional(),
    tracksInventory: z.string().trim().min(1).optional()
  })
  .optional()

export const productImportInputSchema = z.object({
  csvText: z
    .string()
    .min(1, 'Paste or choose a CSV file to import')
    .max(MAX_CSV_BYTES, 'CSV file is too large (maximum 5 MB)'),
  mapping: productCsvColumnMappingSchema
})
