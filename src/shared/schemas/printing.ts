import { z } from 'zod'

export const printerConfigSchema = z.object({
  printerName: z
    .string()
    .trim()
    .max(200, 'Printer name must be 200 characters or fewer')
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  printMode: z.enum(['driver', 'escpos']),
  autoPrintReceipt: z.boolean(),
  openCashDrawer: z.boolean()
})

export const previewReceiptSchema = z.object({
  saleId: z.number().int().positive(),
  isReprint: z.boolean().optional()
})

export const printReceiptSchema = z.object({
  saleId: z.number().int().positive(),
  isReprint: z.boolean().optional(),
  overrideId: z.string().trim().min(1).optional()
})

export const printLabelSchema = z.object({
  variantId: z.number().int().positive(),
  copies: z.number().int().min(1).max(50).optional(),
  packedDate: z
    .string()
    .trim()
    .max(30, 'Packed date must be 30 characters or fewer')
    .nullable()
    .optional()
})

export const PRINTER_FIELD_LABELS: Record<string, string> = {
  printer: 'printer',
  paperWidth: 'paper width',
  mode: 'print mode',
  autoPrint: 'auto-print receipt',
  cashDrawer: 'cash drawer kick',
  enabled: 'scale barcodes enabled',
  weightPrefix: 'weight prefix',
  pricePrefix: 'price prefix'
}

export const weighBarcodeSettingsSchema = z
  .object({
    enabled: z.boolean(),
    weightPrefix: z
      .string()
      .trim()
      .regex(/^\d{2}$/, 'Weight barcode prefix must be 2 digits (e.g. 20)'),
    pricePrefix: z
      .string()
      .trim()
      .regex(/^\d{2}$/, 'Price barcode prefix must be 2 digits (e.g. 21)')
  })
  .refine((val) => val.weightPrefix !== val.pricePrefix, {
    path: ['pricePrefix'],
    message: 'Weight and price prefixes must be different'
  })
