import { buildWeighBarcode } from '@shared/scanner'
import { TEST_STORE } from '@shared/test/stores'
import { describe, expect, it } from 'vitest'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { useMigratedDb } from '../db/test/testDb'
import { createRealIpc } from '../ipc/test/realHandlers'

describe('PrintingService, variable-weight barcodes & label printing (M13, M21, M24)', () => {
  const getDb = useMigratedDb()

  async function setupStore() {
    const bed = createTestbed(getDb())
    const ipc = createRealIpc(bed)
    await ipc.invoke('setup:complete', { store: TEST_STORE, administrator: OWNER })

    const gst5 = bed.taxClasses.list().find((t) => t.rateBp === 500)!
    const rice = await ipc.invoke('products:create', {
      name: 'Ponni Rice Loose',
      categoryId: null,
      taxClassId: gst5.taxClassId,
      hsnCode: '1006',
      tracksInventory: true,
      variants: [
        {
          variantName: 'Loose',
          sku: 'ITEM-00007',
          unitCode: 'kg',
          sellingPriceMinor: 8000, // ₹80.00 / kg
          mrpMinor: 9000,
          costPriceMinor: 6500,
          reorderLevelMilli: 5000,
          barcodes: ['8901234000078']
        }
      ]
    })

    await ipc.invoke('inventory:adjust', {
      reasonCode: 'opening_stock',
      notes: null,
      items: [{ variantId: rice.variants[0]!.variantId, quantityDeltaMilli: 50_000 }]
    })

    const cashMethod = (await ipc.invoke('payments:list-methods')).find((m) => m.kind === 'cash')!
    const sale = await ipc.invoke('sales:checkout', {
      checkoutKey: 'print-test-sale-1',
      lines: [
        {
          variantId: rice.variants[0]!.variantId,
          quantityMilli: 1500,
          unitPriceMinor: 8000
        }
      ],
      payments: [
        {
          paymentMethodId: cashMethod.paymentMethodId,
          amountMinor: 12000,
          tenderedMinor: 15000
        }
      ]
    })

    return { bed, ipc, rice, variant: rice.variants[0]!, sale }
  }

  it('lists printers, updates printer configuration with audit log, and runs test print (M21-02, M21-03)', async () => {
    const { bed, ipc } = await setupStore()

    const printers = await ipc.invoke('printers:list')
    expect(printers).toEqual([
      { name: 'System Default Printer', displayName: 'System Default Printer', isDefault: true }
    ])

    const initialConfig = await ipc.invoke('printers:get-config')
    expect(initialConfig).toEqual({
      printerName: null,
      paperWidthMm: 80,
      printMode: 'driver',
      autoPrintReceipt: false,
      openCashDrawer: false
    })

    const updated = await ipc.invoke('printers:set-config', {
      printerName: 'System Default Printer',
      paperWidthMm: 58,
      printMode: 'escpos',
      autoPrintReceipt: true,
      openCashDrawer: true
    })
    expect(updated.paperWidthMm).toBe(58)
    expect(updated.printMode).toBe('escpos')
    expect(updated.autoPrintReceipt).toBe(true)

    const auditEntries = bed.audit().filter((e) => e.action === 'printer.updated')
    expect(auditEntries).toHaveLength(1)

    const testResult = await ipc.invoke('printers:test-print')
    expect(testResult.printed).toBe(true)
    expect(testResult.paperWidthMm).toBe(58)
    expect(testResult.printMode).toBe('escpos')
    expect(testResult.escPosByteLength).toBeGreaterThan(50)
  })

  it('renders 80 mm and 58 mm receipt previews and prints ESC/POS with cash drawer kick (M13-02, M13-03, M13-04, M21-04)', async () => {
    const { ipc, sale } = await setupStore()

    const preview80 = await ipc.invoke('receipts:preview', { saleId: sale.saleId })
    expect(preview80.paperWidthMm).toBe(80)
    expect(preview80.columns).toBe(48)
    expect(preview80.isReprint).toBe(false)
    expect(preview80.lines.join('\n')).toContain(sale.invoiceNumber)
    expect(preview80.lines.join('\n')).toContain('Ponni Rice Loose')

    await ipc.invoke('printers:set-config', {
      printerName: 'System Default Printer',
      paperWidthMm: 58,
      printMode: 'escpos',
      autoPrintReceipt: true,
      openCashDrawer: true
    })

    const preview58 = await ipc.invoke('receipts:preview', { saleId: sale.saleId })
    expect(preview58.paperWidthMm).toBe(58)
    expect(preview58.columns).toBe(32)
    for (const line of preview58.lines) {
      expect(line.length).toBeLessThanOrEqual(32)
    }

    const printRes = await ipc.invoke('receipts:print', { saleId: sale.saleId })
    expect(printRes.printed).toBe(true)
    expect(printRes.printMode).toBe('escpos')
    expect(printRes.escPosByteLength).toBeGreaterThan(80)
  })

  it('keeps the saved sale intact when printing fails and allows retry once printer is fixed (M13-04)', async () => {
    const { ipc, sale } = await setupStore()

    await ipc.invoke('printers:set-config', {
      printerName: 'Unplugged Thermal USB Printer',
      paperWidthMm: 80,
      printMode: 'driver',
      autoPrintReceipt: true,
      openCashDrawer: false
    })

    const failedPrint = await ipc.send('receipts:print', { saleId: sale.saleId })
    expect(failedPrint).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' }
    })

    // Saved sale is completely unaffected
    const savedSale = await ipc.invoke('sales:get', { saleId: sale.saleId })
    expect(savedSale.invoiceNumber).toBe(sale.invoiceNumber)
    expect(savedSale.grandTotalMinor).toBe(12000)

    // Switch back to available printer and retry
    await ipc.invoke('printers:set-config', {
      printerName: 'System Default Printer',
      paperWidthMm: 80,
      printMode: 'driver',
      autoPrintReceipt: true,
      openCashDrawer: false
    })
    const retryRes = await ipc.invoke('receipts:print', { saleId: sale.saleId })
    expect(retryRes.printed).toBe(true)
  })

  it('enforces sale.reprint permission on reprint, supports manager override, adds DUPLICATE banner, and logs sale.reprinted (M13-05)', async () => {
    const { bed, ipc, sale } = await setupStore()

    await ipc.invoke('users:create', {
      username: 'cashier1',
      displayName: 'Meena Cashier',
      roleCode: 'cashier',
      password: 'till-password-11'
    })
    await ipc.invoke('auth:sign-out')
    await ipc.invoke('auth:sign-in', { username: 'cashier1', password: 'till-password-11' })

    // Initial print right after checkout is allowed for a cashier without override
    const firstPrint = await ipc.invoke('receipts:print', { saleId: sale.saleId, isReprint: false })
    expect(firstPrint.printed).toBe(true)

    // Reprint without permission or override is refused with overridable FORBIDDEN
    const refusedReprint = await ipc.send('receipts:print', {
      saleId: sale.saleId,
      isReprint: true
    })
    expect(refusedReprint).toMatchObject({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        details: { permission: 'sale.reprint', overridable: true }
      }
    })

    // Reprint preview includes *** DUPLICATE / REPRINT *** banner
    const reprintPreview = await ipc.invoke('receipts:preview', {
      saleId: sale.saleId,
      isReprint: true
    })
    expect(reprintPreview.isReprint).toBe(true)
    expect(reprintPreview.lines.join('\n')).toContain('*** DUPLICATE / REPRINT ***')

    // Manager approves override for sale.reprint
    const approval = await ipc.invoke('auth:approve-override', {
      permission: 'sale.reprint',
      username: OWNER.username,
      password: OWNER.password
    })

    const approvedReprint = await ipc.invoke('receipts:print', {
      saleId: sale.saleId,
      isReprint: true,
      overrideId: approval.overrideId
    })
    expect(approvedReprint.printed).toBe(true)

    const reprintAudit = bed.audit().find((e) => e.action === 'sale.reprinted')
    expect(reprintAudit).toBeDefined()
    expect(reprintAudit!.approved_by_user_id).toBe(1)
    expect(JSON.parse(reprintAudit!.details!)).toEqual({
      invoiceNumber: sale.invoiceNumber
    })
  })

  it('resolves variable-weight and embedded-price EAN-13 scale barcodes during POS lookup (M24-02)', async () => {
    const { ipc, variant } = await setupStore()

    // Weight barcode: prefix 20, item code 00007 (matches SKU ITEM-00007), weight 1250 g (1.25 kg)
    const weightBarcode = buildWeighBarcode('20', '00007', 1250)
    const lookedUpWeight = await ipc.invoke('products:find-by-barcode', { barcode: weightBarcode })
    expect(lookedUpWeight).not.toBeNull()
    expect(lookedUpWeight!.variantId).toBe(variant.variantId)
    expect(lookedUpWeight!.scannedQuantityMilli).toBe(1250)

    // Embedded-price barcode: prefix 21, item code 00007, embedded price ₹120.00 (12000 paise)
    // At ₹80.00/kg (8000 paise), ₹120.00 = 1.500 kg (1500 milli)
    const priceBarcode = buildWeighBarcode('21', '00007', 12000)
    const lookedUpPrice = await ipc.invoke('products:find-by-barcode', { barcode: priceBarcode })
    expect(lookedUpPrice).not.toBeNull()
    expect(lookedUpPrice!.variantId).toBe(variant.variantId)
    expect(lookedUpPrice!.scannedQuantityMilli).toBe(1500)

    // Customizing prefix settings in Grocery settings
    const savedWeigh = await ipc.invoke('grocery:set-weigh-barcode', {
      enabled: true,
      weightPrefix: '28',
      pricePrefix: '29'
    })
    expect(savedWeigh.weightPrefix).toBe('28')

    const customBarcode = buildWeighBarcode('28', '00007', 650)
    const lookedUpCustom = await ipc.invoke('products:find-by-barcode', { barcode: customBarcode })
    expect(lookedUpCustom?.scannedQuantityMilli).toBe(650)
  })

  it('generates and prints shelf/pack price labels with Code-128 SVG barcode when grocery module is enabled (M24-03)', async () => {
    const { ipc, variant } = await setupStore()

    const preview = await ipc.invoke('labels:preview', {
      variantId: variant.variantId,
      copies: 2,
      packedDate: '20 Oct 2026'
    })
    expect(preview.variantId).toBe(variant.variantId)
    expect(preview.title).toContain('Ponni Rice Loose')
    expect(preview.codeText).toBe('8901234000078')
    expect(preview.priceText).toBe('₹80.00')
    expect(preview.mrpText).toBe('₹90.00')
    expect(preview.svgBarcode).toContain('<svg')
    expect(preview.copies).toBe(2)

    const printed = await ipc.invoke('labels:print', {
      variantId: variant.variantId,
      copies: 2
    })
    expect(printed.printed).toBe(true)

    // Disabling the grocery module row blocks label printing with MODULE_DISABLED
    getDb().run("DELETE FROM enabled_modules WHERE module_code = 'grocery'")
    const blocked = await ipc.send('labels:print', { variantId: variant.variantId })
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: 'MODULE_DISABLED' }
    })
  })
})
