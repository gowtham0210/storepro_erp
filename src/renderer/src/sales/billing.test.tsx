import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type {
  CheckoutInput,
  HeldBillSummary,
  ItemLookup,
  SaleDetail,
  SaleListItem
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { UPI_RECORDED_NOTICE } from '@shared/payments'
import { fakeBackend, TAX_CLASSES, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'
import {
  addItemToCart,
  createEmptyCart,
  priceCart,
  removeLineFromCart,
  setBillDiscount,
  updateLinePriceAndDiscount,
  updateLineQuantity
} from './cart'

const RICE_ITEM: ItemLookup = {
  variantId: 10,
  productId: 1,
  name: 'Ponni Rice 5 kg',
  sku: 'RICE-5KG',
  unitCode: 'pcs',
  allowsFraction: false,
  sellingPriceMinor: 32_000,
  mrpMinor: 35_000,
  taxClassId: 2, // GST 5%
  tracksInventory: true,
  onHandMilli: 20_000
}

const OIL_ITEM: ItemLookup = {
  variantId: 11,
  productId: 2,
  name: 'Gingelly Oil 1 L',
  sku: 'OIL-1L',
  unitCode: 'pcs',
  allowsFraction: false,
  sellingPriceMinor: 25_000,
  mrpMinor: 26_000,
  taxClassId: 3, // GST 18%
  tracksInventory: true,
  onHandMilli: 15_000
}

function makeSaleDetail(input: CheckoutInput): SaleDetail {
  const grossMinor = input.lines.reduce(
    (sum, line) => sum + Math.round((line.unitPriceMinor * line.quantityMilli) / 1000),
    0
  )
  const cashPayment = input.payments.find((p) => p.paymentMethodId === 1)
  const tenderedMinor = input.payments.reduce(
    (sum, p) => sum + (p.tenderedMinor ?? p.amountMinor),
    0
  )
  const paidMinor = input.payments.reduce((sum, p) => sum + p.amountMinor, 0)
  return {
    saleId: 101,
    invoiceNumber: 'INV000001',
    checkoutKey: input.checkoutKey,
    completedAt: Date.UTC(2026, 9, 19, 6, 0),
    cashierUserId: 1,
    cashierName: 'Ravi Kumar',
    customerId: null,
    customerName: null,
    pricesIncludeTax: true,
    grossMinor,
    discountMinor: grossMinor - paidMinor,
    taxableMinor: paidMinor,
    taxMinor: 0,
    roundOffMinor: 0,
    grandTotalMinor: paidMinor,
    paidMinor,
    tenderedMinor,
    changeMinor: cashPayment?.tenderedMinor
      ? cashPayment.tenderedMinor - cashPayment.amountMinor
      : 0,
    lines: input.lines.map((line, index) => ({
      saleItemId: index + 1,
      lineNumber: index + 1,
      variantId: line.variantId,
      description: line.variantId === RICE_ITEM.variantId ? RICE_ITEM.name : OIL_ITEM.name,
      sku: line.variantId === RICE_ITEM.variantId ? RICE_ITEM.sku : OIL_ITEM.sku,
      hsnCode: '1006',
      unitCode: 'pcs',
      allowsFraction: false,
      quantityMilli: line.quantityMilli,
      unitPriceMinor: line.unitPriceMinor,
      grossMinor: line.unitPriceMinor,
      discountMinor: 0,
      netMinor: line.unitPriceMinor,
      taxableMinor: line.unitPriceMinor,
      taxMinor: 0,
      totalMinor: Math.round((line.unitPriceMinor * line.quantityMilli) / 1000),
      taxes: []
    })),
    taxSummary: [],
    payments: input.payments.map((p, idx) => ({
      salePaymentId: idx + 1,
      paymentMethodId: p.paymentMethodId,
      methodCode: p.paymentMethodId === 1 ? 'cash' : 'upi',
      methodName: p.paymentMethodId === 1 ? 'Cash' : 'UPI',
      kind: p.paymentMethodId === 1 ? 'cash' : 'upi',
      amountMinor: p.amountMinor,
      tenderedMinor: p.tenderedMinor ?? null,
      changeMinor: p.tenderedMinor ? p.tenderedMinor - p.amountMinor : 0,
      reference: p.reference ?? null,
      verificationNotice: p.paymentMethodId === 2 ? UPI_RECORDED_NOTICE : null
    })),
    refunds: [],
    voidInfo: null
  }
}

describe('Cart state model (M11-01)', () => {
  it('adds items, increments existing lines, applies discounts, and calculates totals', () => {
    let cart = createEmptyCart()
    expect(cart.checkoutKey).toBeTruthy()

    cart = addItemToCart(cart, RICE_ITEM)
    cart = addItemToCart(cart, RICE_ITEM)
    cart = addItemToCart(cart, OIL_ITEM)
    expect(cart.lines).toHaveLength(2)
    expect(cart.lines[0]!.quantityMilli).toBe(2000)

    cart = updateLineQuantity(cart, RICE_ITEM.variantId, 1000)
    cart = updateLinePriceAndDiscount(cart, RICE_ITEM.variantId, 30_000, {
      kind: 'amount',
      minor: 2000
    })
    cart = setBillDiscount(cart, { kind: 'percent', bp: 1000 }) // 10%

    const priced = priceCart(
      cart,
      { pricesIncludeTax: true, regime: 'gst', roundingMinor: 1 },
      TAX_CLASSES
    )
    // Rice: 300.00 - 20.00 = 280.00; Oil: 250.00 -> after line discounts = 530.00
    // 10% bill discount = 53.00 -> payable = 477.00 (47700 paise)
    expect(priced.payableMinor).toBe(47_700)

    cart = removeLineFromCart(cart, OIL_ITEM.variantId)
    expect(cart.lines).toHaveLength(1)
  })
})

describe('POS Billing screen (M11-02 to M11-11, M12-02, M12-03)', () => {
  it('scans barcodes, increments quantities, and warns on unknown barcodes (M11-03)', async () => {
    const user = userEvent.setup()
    fakeBackend.on('products:find-by-barcode', ({ barcode }) => {
      if (barcode === '8901234000011' || barcode === 'RICE-5KG') return RICE_ITEM
      return null
    })

    renderApp('/billing')
    const scanInput = await screen.findByLabelText('Scan barcode or enter SKU')

    // Unknown barcode shows clear inline feedback
    await user.type(scanInput, '9999999999{Enter}')
    expect(
      await screen.findByText('No product matches barcode or SKU “9999999999”.')
    ).toBeTruthy()

    // Scan valid barcode twice -> 1 line with quantity 2
    await user.clear(scanInput)
    await user.type(scanInput, '8901234000011{Enter}')
    const table = await screen.findByRole('table', { name: 'Current bill items' })
    expect(within(table).getByText('Ponni Rice 5 kg')).toBeTruthy()

    await user.type(scanInput, '8901234000011{Enter}')
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Quantity of Ponni Rice 5 kg') as HTMLInputElement).value
      ).toBe('2')
    )
  })

  it('searches products with F4, applies bill discount with F6, and completes split Cash + UPI checkout with F12 (M11-04, M11-05, M11-06, M11-11)', async () => {
    const user = userEvent.setup()
    fakeBackend.on('products:search', () => [RICE_ITEM, OIL_ITEM])
    fakeBackend.on('sales:checkout', (input) => makeSaleDetail(input))

    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })

    // Press F4 to open product search dialog
    fireEvent.keyDown(window, { key: 'F4', code: 'F4' })
    const searchDialog = await screen.findByRole('dialog', { name: 'Find product' })
    await user.type(within(searchDialog).getByLabelText('Search item'), 'rice')
    await user.click(
      await within(searchDialog).findByRole('button', { name: 'Add Ponni Rice 5 kg to bill' })
    )

    // Rice (₹320.00) is now in the cart
    expect(await screen.findByText('Ponni Rice 5 kg')).toBeTruthy()

    // Press F6 to apply a 5% bill discount (₹320.00 -> ₹304.00)
    fireEvent.keyDown(window, { key: 'F6', code: 'F6' })
    const discountDialog = await screen.findByRole('dialog', { name: 'Bill discount' })
    await user.type(
      within(discountDialog).getByLabelText('Discount percentage (%)'),
      '5'
    )
    await user.click(within(discountDialog).getByRole('button', { name: 'Apply discount' }))

    // Press F12 to open payment dialog (payable = ₹304.00)
    fireEvent.keyDown(window, { key: 'F12', code: 'F12' })
    const payDialog = await screen.findByRole('dialog', { name: 'Take payment' })

    // Add a split payment: ₹104.00 UPI + ₹200.00 Cash (customer tenders ₹500.00 -> ₹300.00 change)
    await user.click(within(payDialog).getByRole('button', { name: 'Add split payment' }))
    const amountInputs = within(payDialog).getAllByLabelText('Amount')
    await user.clear(amountInputs[0]!)
    await user.type(amountInputs[0]!, '200.00')
    const cashTenderInput = within(payDialog).getByLabelText('Cash tendered')
    await user.clear(cashTenderInput)
    await user.type(cashTenderInput, '500.00')

    // Verify live change calculation of ₹300.00
    expect(within(payDialog).getByText('₹300.00')).toBeTruthy()

    await user.clear(amountInputs[1]!)
    await user.type(amountInputs[1]!, '104.00')
    await user.type(
      within(payDialog).getByLabelText('UPI reference (optional)'),
      'UTR-8899'
    )

    await user.click(within(payDialog).getByRole('button', { name: 'Complete sale' }))

    // Completed sale dialog shows INV000001 and change to return
    const completedDialog = await screen.findByRole('dialog', {
      name: 'Sale completed · INV000001'
    })
    expect(within(completedDialog).getByText('Change to return to customer')).toBeTruthy()
    expect(within(completedDialog).getByText(/Recorded \(not verified\)/)).toBeTruthy()

    expect(fakeBackend.callsTo('sales:checkout')).toEqual([
      expect.objectContaining({
        lines: [
          {
            variantId: RICE_ITEM.variantId,
            quantityMilli: 1000,
            unitPriceMinor: 32_000,
            discount: null
          }
        ],
        billDiscount: { kind: 'percent', bp: 500 },
        payments: [
          {
            paymentMethodId: 1,
            amountMinor: 20_000,
            tenderedMinor: 50_000,
            reference: null
          },
          {
            paymentMethodId: 2,
            amountMinor: 10_400,
            tenderedMinor: null,
            reference: 'UTR-8899'
          }
        ]
      })
    ])
  })

  it('holds a bill and resumes it back into the cart (M11-09)', async () => {
    const user = userEvent.setup()
    fakeBackend.on('products:find-by-barcode', () => OIL_ITEM)
    const heldBills: HeldBillSummary[] = []
    fakeBackend.on('sales:hold', (input) => {
      const summary: HeldBillSummary = {
        heldBillId: 7,
        label: input.label,
        customerId: null,
        customerName: null,
        heldByUserId: 1,
        heldByName: 'Ravi Kumar',
        heldAt: Date.UTC(2026, 9, 19, 6, 0),
        lineCount: input.items.length,
        itemSummary: 'Gingelly Oil 1 L'
      }
      heldBills.push(summary)
      return summary
    })
    fakeBackend.on('sales:list-held', () => heldBills)
    // Like the main process: resuming leaves the bill held until checkout or a new hold.
    fakeBackend.on('sales:resume-held', () => {
      return {
        heldBillId: 7,
        label: 'Counter 2',
        customerId: null,
        customerName: null,
        heldByName: 'Ravi Kumar',
        heldAt: Date.UTC(2026, 9, 19, 6, 0),
        items: [
          {
            lineNumber: 1,
            item: OIL_ITEM,
            quantityMilli: 2000,
            unitPriceOverrideMinor: null,
            discountMinor: 0
          }
        ]
      }
    })

    renderApp('/billing')
    const scanInput = await screen.findByLabelText('Scan barcode or enter SKU')
    await user.type(scanInput, 'OIL-1L{Enter}')
    expect(await screen.findByText('Gingelly Oil 1 L')).toBeTruthy()

    // Hold the bill
    await user.click(screen.getByRole('button', { name: /Hold bill/ }))
    const holdDialog = await screen.findByRole('dialog', { name: 'Hold bill' })
    await user.type(
      within(holdDialog).getByLabelText('Note or customer label (optional)'),
      'Counter 2'
    )
    await user.click(within(holdDialog).getByRole('button', { name: 'Hold bill' }))

    // Cart is now empty
    expect(await screen.findByText('No items on this bill yet')).toBeTruthy()

    // Open Held bills and resume Counter 2
    await user.click(screen.getByRole('button', { name: /Held bills/ }))
    const heldDialog = await screen.findByRole('dialog', { name: 'Held bills' })
    await user.click(within(heldDialog).getByRole('button', { name: 'Resume Counter 2' }))

    expect(await screen.findByText('Gingelly Oil 1 L')).toBeTruthy()
    expect(
      (screen.getByLabelText('Quantity of Gingelly Oil 1 L') as HTMLInputElement).value
    ).toBe('2')

    // It is still listed, marked as the bill on the counter, and can't be resumed twice.
    await user.click(screen.getByRole('button', { name: /Held bills/ }))
    const listAgain = await screen.findByRole('dialog', { name: 'Held bills' })
    expect(within(listAgain).getByText('On the counter now')).toBeTruthy()
    expect(
      (within(listAgain).getByRole('button', { name: 'Resume Counter 2' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    await user.click(within(listAgain).getAllByRole('button', { name: 'Close' })[0]!)

    // Holding it again replaces the bill it came from.
    await user.click(screen.getByRole('button', { name: /Hold bill/ }))
    const holdAgain = await screen.findByRole('dialog', { name: 'Hold bill' })
    await user.click(within(holdAgain).getByRole('button', { name: 'Hold bill' }))
    expect(await screen.findByText('No items on this bill yet')).toBeTruthy()
    const holds = fakeBackend.callsTo('sales:hold')
    expect(holds[0]).toMatchObject({ replacesHeldBillId: null })
    expect(holds[1]).toMatchObject({ replacesHeldBillId: 7 })
  })
})

describe('Sales history and Void sale workflow (M11-10, M11-12)', () => {
  const SAMPLE_SALE_ITEM: SaleListItem = {
    saleId: 101,
    invoiceNumber: 'INV000001',
    completedAt: Date.UTC(2026, 9, 19, 6, 0),
    cashierName: 'Meena Sundar',
    customerName: null,
    lineCount: 1,
    grandTotalMinor: 32_000,
    paymentSummary: 'Cash',
    isVoided: false
  }

  it('lists completed sales, shows invoice details, and prompts for manager approval when a cashier voids a sale', async () => {
    const user = userEvent.setup()
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('cashier') }

    let isVoided = false
    fakeBackend.on('sales:list', () => ({
      items: [{ ...SAMPLE_SALE_ITEM, isVoided }],
      total: 1
    }))

    const baseDetail = makeSaleDetail({
      checkoutKey: 'chk-101',
      lines: [{ variantId: RICE_ITEM.variantId, quantityMilli: 1000, unitPriceMinor: 32_000 }],
      payments: [{ paymentMethodId: 1, amountMinor: 32_000, tenderedMinor: 32_000 }]
    })

    fakeBackend.on('sales:get', () => ({
      ...baseDetail,
      voidInfo: isVoided
        ? {
            voidedAt: Date.UTC(2026, 9, 19, 6, 30),
            voidedByUserId: 2,
            voidedByName: 'Meena Sundar',
            approvedByUserId: 1,
            approvedByName: 'Ravi Kumar',
            reason: 'Wrong item scanned'
          }
        : null
    }))

    fakeBackend.on('sales:void', (input) => {
      if (!input.overrideId) {
        throw new AppError('FORBIDDEN', 'Manager approval required', {
          permission: 'sale.void',
          overridable: true
        })
      }
      isVoided = true
      return {
        ...baseDetail,
        voidInfo: {
          voidedAt: Date.UTC(2026, 9, 19, 6, 30),
          voidedByUserId: 2,
          voidedByName: 'Meena Sundar',
          approvedByUserId: 1,
          approvedByName: 'Ravi Kumar',
          reason: input.reason
        }
      }
    })

    fakeBackend.on('auth:approve-override', () => ({
      overrideId: 'ovr-void-1',
      approvedBy: 'Ravi Kumar',
      expiresAt: Date.UTC(2026, 9, 19, 12, 15)
    }))

    renderApp('/sales')
    expect(await screen.findByText('INV000001')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'View invoice INV000001' }))
    const detailDialog = await screen.findByRole('dialog', { name: 'Invoice INV000001' })
    expect(within(detailDialog).getByText('Ponni Rice 5 kg')).toBeTruthy()

    await user.click(within(detailDialog).getByRole('button', { name: 'Void sale' }))
    const voidDialog = await screen.findByRole('dialog', { name: 'Void invoice INV000001' })
    await user.type(
      within(voidDialog).getByLabelText('Reason for voiding'),
      'Wrong item scanned'
    )
    await user.click(within(voidDialog).getByRole('button', { name: 'Confirm void' }))

    // Cashier is prompted for Manager approval
    const approvalDialog = await screen.findByRole('dialog', {
      name: 'Manager approval needed'
    })
    await user.type(within(approvalDialog).getByLabelText("Approver's username"), 'owner')
    await user.type(
      within(approvalDialog).getByLabelText("Approver's password"),
      'counter-top-42'
    )
    await user.click(within(approvalDialog).getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('sales:void').at(-1)).toEqual({
        saleId: 101,
        reason: 'Wrong item scanned',
        overrideId: 'ovr-void-1'
      })
    )
  })
})
