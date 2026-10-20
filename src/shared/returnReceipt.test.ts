import { describe, expect, it } from 'vitest'
import { TEST_STORE } from './test/stores'
import { encodeEscPosReceipt } from './escpos'
import type { ReturnDetail, StoreProfile } from './ipc/contract'
import { buildReturnReceiptDocument } from './returnReceipt'

const STORE = {
  ...TEST_STORE,
  currency: { currencyCode: 'INR', name: 'Indian rupee', symbol: '₹', minorUnits: 2 },
  businessTypeName: 'Grocery / retail',
  enabledModules: ['grocery'],
  setUpAt: 0,
  updatedAt: 0
} as unknown as StoreProfile

const RETURN: ReturnDetail = {
  saleReturnId: 3,
  returnNumber: 'CN000003',
  saleId: 9,
  invoiceNumber: 'INV000009',
  returnedAt: Date.UTC(2026, 9, 20, 6, 0),
  processedByName: 'Ravi Kumar',
  reason: 'Damaged in transit, customer sent a photo',
  customerName: 'Meena Sundar',
  pricesIncludeTax: false,
  lines: [
    {
      saleReturnItemId: 1,
      saleItemId: 4,
      lineNumber: 1,
      description: 'Ponni Rice 5 kg with a very long product description',
      sku: 'RICE',
      unitCode: 'pcs',
      disposition: 'restock',
      quantityMilli: 1000,
      unitPriceMinor: 32_000,
      creditMinor: 32_000,
      taxMinor: 1600
    }
  ],
  creditMinor: 32_000,
  taxMinor: 1600,
  taxSummary: [
    { code: 'CGST', rateBp: 250, amountMinor: 800 },
    { code: 'SGST', rateBp: 250, amountMinor: 800 }
  ],
  refundDueMinor: 33_600,
  refundedMinor: 33_600,
  refunds: [
    {
      returnRefundId: 1,
      saleReturnId: 3,
      returnNumber: 'CN000003',
      saleId: 9,
      returnedAt: Date.UTC(2026, 9, 20, 6, 0),
      paymentMethodId: 2,
      methodCode: 'upi',
      methodName: 'UPI',
      kind: 'upi',
      amountMinor: 33_600,
      reference: 'UTR-77'
    }
  ]
}

describe('return receipt (M16-05)', () => {
  it('fits both paper widths, wrapping long lines', () => {
    for (const [paperWidthMm, columns] of [
      [58, 32],
      [80, 48]
    ] as const) {
      const doc = buildReturnReceiptDocument(STORE, RETURN, { paperWidthMm })
      expect(doc.columns).toBe(columns)
      for (const line of doc.lines) expect(line.length).toBeLessThanOrEqual(columns)
      expect(doc.invoiceNumber).toBe('CN000003')
    }
  })

  it('shows tax on top of the goods when prices exclude tax, and the refund method', () => {
    const text = buildReturnReceiptDocument(STORE, RETURN, { paperWidthMm: 80 }).lines.join('\n')
    expect(text).toContain('RETURN / CREDIT NOTE')
    expect(text).toMatch(/Goods value\s+₹320\.00/)
    expect(text).not.toContain('incl. tax')
    expect(text).toMatch(/CGST 2\.50%\s+₹8\.00/)
    expect(text).toMatch(/TOTAL REFUND\s+₹336\.00/)
    expect(text).toContain('Refunded: UPI (UTR-77)')
    expect(text).toContain('Recorded (not verified)')
    expect(text).toContain('Reason: Damaged in transit')
  })

  it('says tax is included when prices include it', () => {
    const text = buildReturnReceiptDocument(
      STORE,
      { ...RETURN, pricesIncludeTax: true },
      { paperWidthMm: 80 }
    ).lines.join('\n')
    expect(text).toContain('Goods value (incl. tax)')
    expect(text).toContain('CGST 2.50% (incl.)')
  })

  it('marks a reprint, and encodes for a thermal printer with the totals in bold', () => {
    const doc = buildReturnReceiptDocument(STORE, RETURN, { paperWidthMm: 80, isReprint: true })
    expect(doc.lines.join('\n')).toContain('*** DUPLICATE / REPRINT ***')
    const bytes = encodeEscPosReceipt(doc, { cutPaper: true })
    const ESC_E_ON = [0x1b, 0x45, 0x01]
    const bolds = [...bytes].reduce(
      (count, _, i) => (ESC_E_ON.every((b, k) => bytes[i + k] === b) ? count + 1 : count),
      0
    )
    // Store name, the duplicate banner, the credit-note title and the refund total.
    expect(bolds).toBeGreaterThanOrEqual(4)
    expect(bytes.at(-1)).toBe(0x03)
  })
})
