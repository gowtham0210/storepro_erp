import { encodeEscPosReceipt } from '@shared/escpos'
import type {
  LabelPreview,
  PreviewReceiptInput,
  PrinterConfig,
  PrinterDeviceInfo,
  PrintJobResult,
  PrintLabelInput,
  PrintReceiptInput,
  ReceiptPreview,
  WeighBarcodeSettings
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { buildPriceLabel } from '@shared/label'
import { DEFAULT_CURRENCY } from '@shared/money'
import {
  buildReceiptDocument,
  centerText,
  leftRight,
  RECEIPT_WIDTH_COLS,
  renderReceiptHtml,
  type ReceiptDocument
} from '@shared/receipt'
import { formatStoreTime } from '@shared/storeTime'
import { changesBetween, type AuditLog } from '../audit/auditLog'
import { assertCan, forbidden, type Actor } from '../auth/access'
import type { ProductRepository } from '../catalog/productRepository'
import type { Database } from '../db/database'
import type { ModuleService } from '../modules/moduleService'
import type { SalesRepository } from '../sales/salesRepository'
import type { StoreRepository } from '../store/storeRepository'
import type { PrinterRepository } from './printerRepository'

export interface PrinterAdapter {
  listPrinters(): Promise<PrinterDeviceInfo[]>
  printHtml(html: string, options: { printerName: string | null }): Promise<void>
  printEscPos(
    bytes: Uint8Array,
    options: { printerName: string | null; fallbackHtml: string }
  ): Promise<void>
}

/** Default in-memory/no-op adapter used when no OS window is attached (e.g. unit tests). */
export function createNoopPrinterAdapter(
  devices: PrinterDeviceInfo[] = [
    { name: 'System Default Printer', displayName: 'System Default Printer', isDefault: true }
  ]
): PrinterAdapter {
  return {
    async listPrinters() {
      return devices
    },
    async printHtml(_html, { printerName }) {
      if (printerName !== null && !devices.some((d) => d.name === printerName)) {
        throw new AppError(
          'NOT_FOUND',
          `Printer “${printerName}” is not available on this computer`
        )
      }
    },
    async printEscPos(_bytes, { printerName }) {
      if (printerName !== null && !devices.some((d) => d.name === printerName)) {
        throw new AppError(
          'NOT_FOUND',
          `Printer “${printerName}” is not available on this computer`
        )
      }
    }
  }
}

export interface PrintingServiceDeps {
  db: Database
  printers: PrinterRepository
  sales: SalesRepository
  products: ProductRepository
  store: StoreRepository
  modules: ModuleService
  audit: AuditLog
  adapter?: PrinterAdapter
}

function readablePrinterConfig(config: PrinterConfig): Record<string, string> {
  return {
    printer: config.printerName ?? 'System default',
    paperWidth: `${config.paperWidthMm} mm`,
    mode: config.printMode === 'escpos' ? 'ESC/POS raw' : 'Windows driver',
    autoPrint: config.autoPrintReceipt ? 'yes' : 'no',
    cashDrawer: config.openCashDrawer ? 'yes' : 'no'
  }
}

function readableWeighConfig(config: WeighBarcodeSettings): Record<string, string> {
  return {
    enabled: config.enabled ? 'yes' : 'no',
    weightPrefix: config.weightPrefix,
    pricePrefix: config.pricePrefix
  }
}

/**
 * Receipt printing, label printing, printer configuration, and grocery scale
 * barcode settings (M13-02 to M13-05, M21-02 to M21-04, M24-02, M24-03).
 */
export class PrintingService {
  private readonly adapter: PrinterAdapter

  constructor(private readonly deps: PrintingServiceDeps) {
    this.adapter = deps.adapter ?? createNoopPrinterAdapter()
  }

  async listPrinters(actor: Actor): Promise<PrinterDeviceInfo[]> {
    assertCan(actor, 'settings.view')
    return this.adapter.listPrinters()
  }

  getPrinterConfig(_actor: Actor): PrinterConfig {
    return this.deps.printers.getPrinterConfig()
  }

  setPrinterConfig(actor: Actor, input: PrinterConfig): PrinterConfig {
    assertCan(actor, 'settings.edit')
    const { db, printers, audit } = this.deps
    return db.transaction(() => {
      const before = printers.getPrinterConfig()
      const saved = printers.setPrinterConfig(input)
      const changes = changesBetween(readablePrinterConfig(before), readablePrinterConfig(saved))
      if (changes) {
        audit.change({
          action: 'printer.updated',
          actor,
          entity: { type: 'business', id: 1 },
          details: { changes }
        })
      }
      return saved
    })
  }

  async testPrint(actor: Actor): Promise<PrintJobResult> {
    assertCan(actor, 'settings.edit')
    const config = this.deps.printers.getPrinterConfig()
    const profile = this.deps.store.get()
    const storeName = profile?.name ?? 'StorePro'
    const timeZone = profile?.timeZone ?? 'Asia/Kolkata'
    const cols = RECEIPT_WIDTH_COLS[config.paperWidthMm]
    const rule = '-'.repeat(cols)

    const lines: string[] = [
      ...centerText(storeName.toUpperCase(), cols),
      ...centerText('*** PRINTER TEST RECEIPT ***', cols),
      rule,
      ...leftRight('Paper width', `${config.paperWidthMm} mm (${cols} cols)`, cols),
      ...leftRight(
        'Print mode',
        config.printMode === 'escpos' ? 'ESC/POS raw' : 'Windows driver',
        cols
      ),
      ...leftRight('Printer', config.printerName ?? 'System default', cols),
      ...leftRight('Printed at', formatStoreTime(Date.now(), timeZone), cols),
      rule,
      '1234567890'.repeat(Math.ceil(cols / 10)).slice(0, cols),
      rule,
      ...centerText('Printer is ready for billing.', cols)
    ]

    const doc: ReceiptDocument = {
      paperWidthMm: config.paperWidthMm,
      columns: cols,
      isReprint: false,
      isVoided: false,
      storeName,
      storeAddressLines: [],
      storePhone: profile?.phone ?? '',
      storeEmail: profile?.email ?? null,
      taxRegistrationNumber: profile?.taxRegistrationNumber ?? null,
      receiptHeader: null,
      receiptFooter: null,
      invoiceNumber: 'TEST',
      completedAtText: formatStoreTime(Date.now(), timeZone),
      cashierName: actor.displayName,
      customerName: null,
      lines
    }

    return this.dispatchReceiptPrint(doc, config, false)
  }

  previewReceipt(actor: Actor, input: PreviewReceiptInput): ReceiptPreview {
    if (!actor.permissions.has('sale.view') && !actor.permissions.has('sale.create')) {
      assertCan(actor, 'sale.view')
    }
    const { sale, doc, html } = this.buildSaleReceipt(input.saleId, Boolean(input.isReprint))
    return {
      saleId: sale.saleId,
      invoiceNumber: sale.invoiceNumber,
      paperWidthMm: doc.paperWidthMm,
      columns: doc.columns,
      isReprint: doc.isReprint,
      isVoided: doc.isVoided,
      lines: doc.lines,
      html
    }
  }

  async printReceipt(actor: Actor, input: PrintReceiptInput): Promise<PrintJobResult> {
    const isReprint = Boolean(input.isReprint)
    if (isReprint) {
      if (!actor.permissions.has('sale.reprint')) {
        throw forbidden('sale.reprint', true)
      }
    } else if (!actor.permissions.has('sale.create') && !actor.permissions.has('sale.view')) {
      assertCan(actor, 'sale.create')
    }

    const { sale, config, doc } = this.buildSaleReceipt(input.saleId, isReprint)
    const hasCashPayment = sale.payments.some((p) => p.kind === 'cash')
    const result = await this.dispatchReceiptPrint(
      doc,
      config,
      !isReprint && config.openCashDrawer && hasCashPayment
    )

    if (isReprint) {
      this.deps.db.transaction(() => {
        this.deps.audit.change({
          action: 'sale.reprinted',
          actor,
          entity: { type: 'sale', id: sale.saleId },
          details: {
            invoiceNumber: sale.invoiceNumber
          }
        })
      })
    }

    return result
  }

  previewLabel(actor: Actor, input: PrintLabelInput): LabelPreview {
    assertCan(actor, 'product.view')
    this.deps.modules.assertEnabled('grocery')
    return this.buildVariantLabel(input)
  }

  async printLabel(actor: Actor, input: PrintLabelInput): Promise<PrintJobResult> {
    assertCan(actor, 'product.view')
    this.deps.modules.assertEnabled('grocery')
    const label = this.buildVariantLabel(input)
    const config = this.deps.printers.getPrinterConfig()
    await this.adapter.printHtml(label.html, { printerName: config.printerName })
    return {
      printed: true,
      printerName: config.printerName,
      printMode: 'driver',
      paperWidthMm: config.paperWidthMm,
      escPosByteLength: null
    }
  }

  getWeighBarcodeSettings(actor: Actor): WeighBarcodeSettings {
    assertCan(actor, 'product.view')
    return this.deps.printers.getWeighBarcodeSettings()
  }

  setWeighBarcodeSettings(actor: Actor, input: WeighBarcodeSettings): WeighBarcodeSettings {
    assertCan(actor, 'settings.edit')
    this.deps.modules.assertEnabled('grocery')
    const { db, printers, audit } = this.deps
    return db.transaction(() => {
      const before = printers.getWeighBarcodeSettings()
      const saved = printers.setWeighBarcodeSettings(input)
      const changes = changesBetween(readableWeighConfig(before), readableWeighConfig(saved))
      if (changes) {
        audit.change({
          action: 'weigh_barcode.updated',
          actor,
          entity: { type: 'business', id: 1 },
          details: { changes }
        })
      }
      return saved
    })
  }

  /**
   * Prints any receipt document on the configured printer, and reports the same
   * result as a sale receipt (M16-05: return receipts).
   */
  async printDocument(
    doc: ReceiptDocument,
    options: { openCashDrawer?: boolean } = {}
  ): Promise<PrintJobResult> {
    const config = this.deps.printers.getPrinterConfig()
    return this.dispatchReceiptPrint(doc, config, options.openCashDrawer === true)
  }

  private buildSaleReceipt(saleId: number, isReprint: boolean) {
    const sale = this.deps.sales.get(saleId)
    if (!sale) {
      throw new AppError('NOT_FOUND', 'That sale invoice could not be found')
    }
    const store = this.deps.store.get()
    if (!store) {
      throw new AppError('SETUP_REQUIRED', 'Set up the store before printing receipts')
    }
    const config = this.deps.printers.getPrinterConfig()
    const doc = buildReceiptDocument(store, sale, {
      paperWidthMm: config.paperWidthMm,
      isReprint
    })
    const html = renderReceiptHtml(doc)
    return { sale, config, doc, html }
  }

  private buildVariantLabel(input: PrintLabelInput): LabelPreview {
    const variant = this.deps.products.findVariantForLabel(input.variantId)
    if (!variant) {
      throw new AppError('NOT_FOUND', 'That product pack size could not be found')
    }
    const store = this.deps.store.get()
    const preview = buildPriceLabel({
      storeName: store?.name ?? 'StorePro',
      productName: variant.productName,
      variantName: variant.variantName,
      sku: variant.sku,
      barcode: variant.barcode,
      unitCode: variant.unitCode,
      sellingPriceMinor: variant.sellingPriceMinor,
      mrpMinor: variant.mrpMinor,
      currency: store?.currency ?? DEFAULT_CURRENCY,
      packedDate: input.packedDate ?? null,
      copies: input.copies ?? 1
    })
    return {
      variantId: variant.variantId,
      ...preview
    }
  }

  private async dispatchReceiptPrint(
    doc: ReceiptDocument,
    config: PrinterConfig,
    openCashDrawer: boolean
  ): Promise<PrintJobResult> {
    const html = renderReceiptHtml(doc)
    if (config.printMode === 'escpos') {
      const bytes = encodeEscPosReceipt(doc, { openCashDrawer, cutPaper: true })
      await this.adapter.printEscPos(bytes, {
        printerName: config.printerName,
        fallbackHtml: html
      })
      return {
        printed: true,
        printerName: config.printerName,
        printMode: 'escpos',
        paperWidthMm: config.paperWidthMm,
        escPosByteLength: bytes.byteLength
      }
    }

    await this.adapter.printHtml(html, { printerName: config.printerName })
    return {
      printed: true,
      printerName: config.printerName,
      printMode: 'driver',
      paperWidthMm: config.paperWidthMm,
      escPosByteLength: null
    }
  }
}
