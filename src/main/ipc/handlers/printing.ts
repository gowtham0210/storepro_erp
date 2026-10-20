import { z } from 'zod'
import {
  previewReceiptSchema,
  printerConfigSchema,
  printLabelSchema,
  printReceiptSchema,
  weighBarcodeSettingsSchema
} from '@shared/schemas/printing'
import type { PrintingService } from '../../printing/printingService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'printers:list'
  | 'printers:get-config'
  | 'printers:set-config'
  | 'printers:test-print'
  | 'receipts:preview'
  | 'receipts:print'
  | 'labels:preview'
  | 'labels:print'
  | 'grocery:get-weigh-barcode'
  | 'grocery:set-weigh-barcode'

export function createPrintingHandlers(
  printing: PrintingService
): { [C in Channel]: HandlerDefinition<C> } {
  return {
    'printers:list': {
      access: 'settings.view',
      input: z.void(),
      handle: (_, { actor }) => printing.listPrinters(actor)
    },
    'printers:get-config': {
      access: 'signed-in',
      input: z.void(),
      handle: (_, { actor }) => printing.getPrinterConfig(actor)
    },
    'printers:set-config': {
      access: 'settings.edit',
      input: printerConfigSchema,
      handle: (input, { actor }) => printing.setPrinterConfig(actor, input)
    },
    'printers:test-print': {
      access: 'settings.edit',
      input: z.void(),
      handle: (_, { actor }) => printing.testPrint(actor)
    },
    'receipts:preview': {
      access: 'sale.view',
      input: previewReceiptSchema,
      handle: (input, { actor }) => printing.previewReceipt(actor, input)
    },
    'receipts:print': {
      access: 'sale.view',
      overridable: true,
      input: printReceiptSchema,
      handle: (input, { actor }) => printing.printReceipt(actor, input)
    },
    'labels:preview': {
      access: 'product.view',
      module: 'grocery',
      input: printLabelSchema,
      handle: (input, { actor }) => printing.previewLabel(actor, input)
    },
    'labels:print': {
      access: 'product.view',
      module: 'grocery',
      input: printLabelSchema,
      handle: (input, { actor }) => printing.printLabel(actor, input)
    },
    'grocery:get-weigh-barcode': {
      access: 'product.view',
      input: z.void(),
      handle: (_, { actor }) => printing.getWeighBarcodeSettings(actor)
    },
    'grocery:set-weigh-barcode': {
      access: 'settings.edit',
      module: 'grocery',
      input: weighBarcodeSettingsSchema,
      handle: (input, { actor }) => printing.setWeighBarcodeSettings(actor, input)
    }
  }
}
