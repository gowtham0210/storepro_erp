import { describe, expect, it } from 'vitest'
import { encodeEscPosReceipt } from './escpos'
import type { SaleDetail, StoreProfile } from './ipc/contract'
import { buildPriceLabel, renderCode128Svg } from './label'
import { buildReceiptDocument, RECEIPT_WIDTH_COLS, renderReceiptHtml } from './receipt'

const STORE: StoreProfile = {
  name: 'Annapoorna Super Mart',
  addressLine1: '42 Gandhi Bazaar Main Road',
  addressLine2: 'Basavanagudi',
  city: 'Bengaluru',
  regionCode: 'KA',
  postalCode: '560004',
  countryCode: 'IN',
  phone: '+91 80 2667 1234',
  email: 'billing@annapoorna.example',
  taxRegistrationNumber: '29AABCU9603R1ZJ',
  currencyCode: 'INR',
  timeZone: 'Asia/Kolkata',
  businessTypeCode: 'grocery',
  pricesIncludeTax: true,
  allowNegativeStock: false,
  receiptHeader: 'Open 7am to 10pm daily',
  receiptFooter: 'Thank you! Visit again.',
  invoicePrefix: 'INV',
  currency: {
    currencyCode: 'INR',
    name: 'Indian Rupee',
    symbol: '₹',
    minorUnits: 2
  },
  businessTypeName: 'Grocery & Supermarkets',
  enabledModules: ['grocery'],
  setUpAt: Date.UTC(2026, 9, 1, 4, 0),
  updatedAt: Date.UTC(2026, 9, 1, 4, 0)
}

const SAMPLE_SALE: SaleDetail = {
  saleId: 1,
  invoiceNumber: 'INV000001',
  checkoutKey: 'chk-1',
  completedAt: Date.UTC(2026, 9, 19, 6, 0),
  cashierUserId: 1,
  cashierName: 'Ravi Kumar',
  customerId: null,
  customerName: 'Lakshmi Rao',
  pricesIncludeTax: true,
  grossMinor: 35_000,
  discountMinor: 1_000,
  taxableMinor: 32_380,
  taxMinor: 1_620,
  roundOffMinor: 0,
  grandTotalMinor: 34_000,
  paidMinor: 34_000,
  tenderedMinor: 50_000,
  changeMinor: 16_000,
  lines: [
    {
      saleItemId: 1,
      lineNumber: 1,
      variantId: 10,
      description: 'Sona Masoori Rice 5 kg',
      sku: 'ITEM-00010',
      hsnCode: '1006',
      unitCode: 'pcs',
      allowsFraction: false,
      quantityMilli: 1000,
      unitPriceMinor: 35_000,
      grossMinor: 35_000,
      discountMinor: 1_000,
      netMinor: 34_000,
      taxableMinor: 32_380,
      taxMinor: 1_620,
      totalMinor: 34_000,
      taxes: [
        { code: 'CGST', rateBp: 250, amountMinor: 810 },
        { code: 'SGST', rateBp: 250, amountMinor: 810 }
      ]
    }
  ],
  taxSummary: [
    { code: 'CGST', rateBp: 250, taxableMinor: 32_380, amountMinor: 810 },
    { code: 'SGST', rateBp: 250, taxableMinor: 32_380, amountMinor: 810 }
  ],
  payments: [
    {
      salePaymentId: 1,
      paymentMethodId: 1,
      methodCode: 'cash',
      methodName: 'Cash',
      kind: 'cash',
      amountMinor: 20_000,
      tenderedMinor: 36_000,
      changeMinor: 16_000,
      reference: null,
      verificationNotice: null
    },
    {
      salePaymentId: 2,
      paymentMethodId: 2,
      methodCode: 'upi',
      methodName: 'UPI',
      kind: 'upi',
      amountMinor: 14_000,
      tenderedMinor: null,
      changeMinor: 0,
      reference: 'UTR9988',
      verificationNotice: 'Recorded (not verified)'
    }
  ],
  refunds: [],
  voidInfo: null
}

describe('Receipt template engine (M13-02, M13-03, M13-05)', () => {
  it('formats 58 mm (32-col) and 80 mm (48-col) receipts within column limits', () => {
    for (const width of [58, 80] as const) {
      const doc = buildReceiptDocument(STORE, SAMPLE_SALE, { paperWidthMm: width })
      const maxCols = RECEIPT_WIDTH_COLS[width]
      expect(doc.columns).toBe(maxCols)
      expect(doc.isReprint).toBe(false)

      for (const line of doc.lines) {
        expect(line.length).toBeLessThanOrEqual(maxCols)
      }

      const fullText = doc.lines.join('\n')
      expect(fullText).toContain('ANNAPOORNA SUPER MART')
      expect(fullText).toContain('GSTIN: 29AABCU9603R1ZJ')
      expect(fullText).toContain('Open 7am to 10pm daily')
      expect(fullText).toContain('INV000001')
      expect(fullText).toContain('Cashier: Ravi Kumar')
      expect(fullText).toContain('Customer: Lakshmi Rao')
      expect(fullText).toContain('Sona Masoori Rice 5 kg')
      expect(fullText).toContain('[HSN:1006]')
      expect(fullText).toContain('CGST 2.50% (incl.)')
      expect(fullText).toContain('SGST 2.50% (incl.)')
      expect(fullText).toContain('TOTAL PAYABLE')
      expect(fullText).toContain('Paid: UPI (UTR9988)')
      expect(fullText).toContain('Recorded (not verified)')
      expect(fullText).toContain('Change returned')
      expect(fullText).toContain('Thank you! Visit again.')
      expect(fullText).not.toContain('DUPLICATE / REPRINT')

      const html = renderReceiptHtml(doc)
      expect(html).toContain(`size: ${width}mm auto`)
      expect(html).toContain('INV000001')
    }
  })

  it('marks reprinted receipts with DUPLICATE / REPRINT and voided sales with VOIDED INVOICE (M13-05)', () => {
    const voidedSale: SaleDetail = {
      ...SAMPLE_SALE,
      voidInfo: {
        voidedAt: Date.UTC(2026, 9, 19, 7, 0),
        voidedByUserId: 1,
        voidedByName: 'Ravi Kumar',
        approvedByUserId: null,
        approvedByName: null,
        reason: 'Wrong item'
      }
    }
    const doc = buildReceiptDocument(STORE, voidedSale, {
      paperWidthMm: 80,
      isReprint: true
    })
    expect(doc.isReprint).toBe(true)
    expect(doc.isVoided).toBe(true)
    const fullText = doc.lines.join('\n')
    expect(fullText).toContain('*** DUPLICATE / REPRINT ***')
    expect(fullText).toContain('*** VOIDED INVOICE ***')
  })
})

describe('ESC/POS raw byte-stream encoder (M21-04)', () => {
  it('encodes initialization, optional cash-drawer kick, ASCII text, and paper cut', () => {
    const doc = buildReceiptDocument(STORE, SAMPLE_SALE, { paperWidthMm: 80 })
    const withDrawer = encodeEscPosReceipt(doc, { openCashDrawer: true, cutPaper: true })

    // Starts with ESC @ (0x1b, 0x40) followed by drawer kick ESC p 0 25 250 (0x1b, 0x70, 0x00, 0x19, 0xfa)
    expect(Array.from(withDrawer.slice(0, 7))).toEqual([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa])
    // Ends with GS V 66 3 (0x1d, 0x56, 0x42, 0x03)
    expect(Array.from(withDrawer.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x03])

    // Without drawer kick
    const withoutDrawer = encodeEscPosReceipt(doc, { openCashDrawer: false })
    expect(Array.from(withoutDrawer.slice(0, 2))).toEqual([0x1b, 0x40])
    expect(Array.from(withoutDrawer.slice(2, 5))).toEqual([0x1b, 0x61, 0x00])
  })
})

describe('Price & barcode label generator (M24-03)', () => {
  it('builds a printable label with Code-128B SVG barcode, MRP, and copies', () => {
    const svg = renderCode128Svg('8901052001012')
    expect(svg).toContain('<svg')
    expect(svg).toContain('aria-label="Barcode 8901052001012"')

    const label = buildPriceLabel({
      storeName: STORE.name,
      productName: 'Turmeric Powder',
      variantName: '200 g',
      sku: 'ITEM-00005',
      barcode: '8901052001012',
      unitCode: 'pcs',
      sellingPriceMinor: 6500,
      mrpMinor: 7200,
      currency: STORE.currency,
      packedDate: '2026-10-20',
      copies: 3
    })

    expect(label.title).toBe('Turmeric Powder · 200 g')
    expect(label.priceText).toBe('₹65.00')
    expect(label.mrpText).toBe('₹72.00')
    expect(label.copies).toBe(3)
    expect(label.html.match(/class="label"/g)?.length).toBe(3)
    expect(label.html).toContain('Packed: 2026-10-20')
  })
})
