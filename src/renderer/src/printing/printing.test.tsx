import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type {
  CheckoutInput,
  ItemLookup,
  ProductDetail,
  SaleDetail,
  SaleListItem
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { buildWeighBarcode } from '@shared/scanner'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const LOOSE_RICE: ItemLookup = {
  variantId: 7,
  productId: 1,
  name: 'Ponni Rice Loose',
  sku: 'ITEM-00007',
  unitCode: 'kg',
  allowsFraction: true,
  sellingPriceMinor: 8_000,
  mrpMinor: 9_000,
  taxClassId: 2,
  tracksInventory: true,
  onHandMilli: 40_000
}

const SAMPLE_SALE: SaleDetail = {
  saleId: 101,
  invoiceNumber: 'INV000001',
  checkoutKey: 'chk-101',
  completedAt: Date.UTC(2026, 9, 20, 6, 0),
  cashierUserId: 1,
  cashierName: 'Ravi Kumar',
  customerId: null,
  customerName: null,
  pricesIncludeTax: true,
  grossMinor: 10_000,
  discountMinor: 0,
  taxableMinor: 9_524,
  taxMinor: 476,
  roundOffMinor: 0,
  grandTotalMinor: 10_000,
  paidMinor: 10_000,
  tenderedMinor: 10_000,
  changeMinor: 0,
  lines: [
    {
      saleItemId: 1,
      lineNumber: 1,
      variantId: 7,
      description: 'Ponni Rice Loose',
      sku: 'ITEM-00007',
      hsnCode: '1006',
      unitCode: 'kg',
      allowsFraction: true,
      quantityMilli: 1250,
      unitPriceMinor: 8_000,
      grossMinor: 10_000,
      discountMinor: 0,
      netMinor: 10_000,
      taxableMinor: 9_524,
      taxMinor: 476,
      totalMinor: 10_000,
      taxes: [
        { code: 'CGST', rateBp: 250, amountMinor: 238 },
        { code: 'SGST', rateBp: 250, amountMinor: 238 }
      ]
    }
  ],
  taxSummary: [
    { code: 'CGST', rateBp: 250, taxableMinor: 9_524, amountMinor: 238 },
    { code: 'SGST', rateBp: 250, taxableMinor: 9_524, amountMinor: 238 }
  ],
  payments: [
    {
      salePaymentId: 1,
      paymentMethodId: 1,
      methodCode: 'cash',
      methodName: 'Cash',
      kind: 'cash',
      amountMinor: 10_000,
      tenderedMinor: 10_000,
      changeMinor: 0,
      reference: null,
      verificationNotice: null
    }
  ],
  refunds: [],
  voidInfo: null
}

describe('Printing, hardware & grocery UI workflows (M13, M21, M24)', () => {
  it('configures receipt printer and scale barcode settings on SettingsPage (M21-03, M24-02)', async () => {
    fakeBackend.on('printers:list', () => [
      { name: 'EPSON-TM-T82', displayName: 'Epson TM-T82 Thermal', isDefault: true }
    ])
    fakeBackend.on('printers:set-config', (input) => input)
    fakeBackend.on('grocery:set-weigh-barcode', (input) => input)

    renderApp('/settings')

    expect(await screen.findByRole('heading', { name: 'Receipt printer' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Scale barcodes (Grocery)' })).toBeTruthy()

    await userEvent.selectOptions(
      screen.getByLabelText('Thermal paper width'),
      '58'
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Print mode'),
      'escpos'
    )
    await userEvent.click(
      screen.getByLabelText(/Automatically print receipt after checkout/i)
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save printer settings' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('printers:set-config').at(-1)).toEqual({
        printerName: null,
        paperWidthMm: 58,
        printMode: 'escpos',
        autoPrintReceipt: true,
        openCashDrawer: false
      })
    )

    await userEvent.click(screen.getByRole('button', { name: 'Test print' }))
    await waitFor(() => expect(fakeBackend.callsTo('printers:test-print')).toHaveLength(1))

    // Update scale barcode prefix
    const weightPrefixInput = screen.getByLabelText('Weight barcode prefix (2 digits)')
    await userEvent.clear(weightPrefixInput)
    await userEvent.type(weightPrefixInput, '28')
    await userEvent.click(screen.getByRole('button', { name: 'Save scale barcode settings' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('grocery:set-weigh-barcode').at(-1)).toEqual({
        enabled: true,
        weightPrefix: '28',
        pricePrefix: '21'
      })
    )
  })

  it('adds variable-weight barcode quantity and captures global scanner bursts on BillingPage (M21-01, M24-02)', async () => {
    const scaleCode = buildWeighBarcode('20', '00007', 1250)
    fakeBackend.on('products:find-by-barcode', ({ barcode }) => {
      if (barcode === scaleCode) {
        return { ...LOOSE_RICE, scannedQuantityMilli: 1250 }
      }
      return null
    })

    renderApp('/billing')
    await screen.findByRole('heading', { name: 'Billing' })

    // Move focus away from the barcode input to a button, then fire a rapid scanner burst
    const findItemBtn = screen.getAllByRole('button', { name: /Find item/i })[0]!
    findItemBtn.focus()

    let t = 500
    for (const ch of scaleCode) {
      const ev = new KeyboardEvent('keydown', { key: ch, bubbles: true })
      Object.defineProperty(ev, 'timeStamp', { value: t })
      window.dispatchEvent(ev)
      t += 8
    }
    const enterEv = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(enterEv, 'timeStamp', { value: t })
    window.dispatchEvent(enterEv)

    const table = await screen.findByRole('table', { name: 'Current bill items' })
    expect(within(table).getByText('Ponni Rice Loose')).toBeTruthy()
    const qtyInput = within(table).getByLabelText('Quantity of Ponni Rice Loose') as HTMLInputElement
    expect(qtyInput.value).toBe('1.25')
  })

  it('keeps the sale when receipt printing fails after checkout and allows retrying print (M13-04)', async () => {
    let shouldFailPrint = true
    fakeBackend.on('products:find-by-barcode', () => ({ ...LOOSE_RICE, scannedQuantityMilli: 1250 }))
    fakeBackend.on('printers:get-config', () => ({
      printerName: 'Offline-USB-Printer',
      paperWidthMm: 80,
      printMode: 'driver',
      autoPrintReceipt: true,
      openCashDrawer: false
    }))
    fakeBackend.on('sales:checkout', (_input: CheckoutInput) => SAMPLE_SALE)
    fakeBackend.on('receipts:print', () => {
      if (shouldFailPrint) {
        throw new AppError('NOT_FOUND', 'Printer “Offline-USB-Printer” is not available')
      }
      return {
        printed: true,
        printerName: 'Offline-USB-Printer',
        printMode: 'driver',
        paperWidthMm: 80,
        escPosByteLength: null
      }
    })

    renderApp('/billing')
    const scanInput = await screen.findByLabelText('Scan barcode or enter SKU')
    await userEvent.type(scanInput, 'ITEM-00007{Enter}')
    await screen.findByRole('table', { name: 'Current bill items' })

    await userEvent.click(screen.getByRole('button', { name: /Pay/i }))
    const dialog = await screen.findByRole('dialog', { name: /Take payment/i })
    await userEvent.click(within(dialog).getByRole('button', { name: /Complete sale/i }))

    const completedDialog = await screen.findByRole('dialog', { name: /Sale completed · INV000001/i })
    expect(
      await within(completedDialog).findByText('Sale is saved, but receipt printing failed')
    ).toBeTruthy()
    expect(
      within(completedDialog).getByText(/Printer “Offline-USB-Printer” is not available/i)
    ).toBeTruthy()

    // Fix printer and click Retry print
    shouldFailPrint = false
    await userEvent.click(within(completedDialog).getByRole('button', { name: /Retry print/i }))

    await waitFor(() =>
      expect(
        within(completedDialog).queryByText('Sale is saved, but receipt printing failed')
      ).toBeNull()
    )
    expect(fakeBackend.callsTo('receipts:print')).toHaveLength(2)
  })

  it('reprints a past sale from SalesPage with manager override and shows DUPLICATE / REPRINT preview (M13-05)', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('cashier') }

    const saleItem: SaleListItem = {
      saleId: SAMPLE_SALE.saleId,
      invoiceNumber: SAMPLE_SALE.invoiceNumber,
      completedAt: SAMPLE_SALE.completedAt,
      cashierName: SAMPLE_SALE.cashierName,
      customerName: null,
      lineCount: 1,
      grandTotalMinor: SAMPLE_SALE.grandTotalMinor,
      paymentSummary: 'Cash',
      isVoided: false
    }
    fakeBackend.on('sales:list', () => ({ items: [saleItem], total: 1 }))
    fakeBackend.on('sales:get', () => SAMPLE_SALE)
    fakeBackend.on('receipts:preview', ({ isReprint }) => ({
      saleId: SAMPLE_SALE.saleId,
      invoiceNumber: SAMPLE_SALE.invoiceNumber,
      paperWidthMm: 80,
      columns: 48,
      isReprint: Boolean(isReprint),
      isVoided: false,
      lines: [
        'LAKSHMI STORES',
        ...(isReprint ? ['*** DUPLICATE / REPRINT ***'] : []),
        'Bill: INV000001'
      ],
      html: '<pre>*** DUPLICATE / REPRINT ***</pre>'
    }))
    fakeBackend.on('receipts:print', (input) => {
      if (input.isReprint && !input.overrideId) {
        throw new AppError('FORBIDDEN', 'Manager approval required', {
          permission: 'sale.reprint',
          overridable: true
        })
      }
      return {
        printed: true,
        printerName: null,
        printMode: 'driver',
        paperWidthMm: 80,
        escPosByteLength: null
      }
    })
    fakeBackend.on('auth:approve-override', () => ({
      overrideId: 'ovr-reprint-1',
      approvedBy: 'Ravi Kumar',
      expiresAt: Date.now() + 60_000
    }))

    renderApp('/sales')
    await userEvent.click(await screen.findByRole('button', { name: 'View invoice INV000001' }))

    const detailDialog = await screen.findByRole('dialog', { name: /Invoice INV000001/i })
    await userEvent.click(within(detailDialog).getByRole('button', { name: /Reprint receipt/i }))

    // Cashier is prompted for manager approval
    const approvalDialog = await screen.findByRole('dialog', { name: /Manager approval needed/i })
    await userEvent.type(within(approvalDialog).getByLabelText("Approver's username"), 'owner')
    await userEvent.type(within(approvalDialog).getByLabelText("Approver's password"), 'secret-pass')
    await userEvent.click(within(approvalDialog).getByRole('button', { name: 'Approve' }))

    const previewPre = await screen.findByLabelText('Duplicate receipt preview')
    expect(previewPre.textContent).toContain('*** DUPLICATE / REPRINT ***')
    expect(fakeBackend.callsTo('receipts:print').at(-1)).toEqual({
      saleId: 101,
      isReprint: true,
      overrideId: 'ovr-reprint-1'
    })
  })

  it('previews and prints shelf/pack price labels from ProductDialog (M24-03)', async () => {
    const product: ProductDetail = {
      productId: 1,
      name: 'Ponni Rice',
      categoryId: null,
      taxClassId: 2,
      hsnCode: '1006',
      tracksInventory: true,
      active: true,
      createdAt: 0,
      updatedAt: 0,
      variants: [
        {
          variantId: 7,
          variantName: '5 kg',
          sku: 'ITEM-00007',
          unitCode: 'pcs',
          sellingPriceMinor: 35_000,
          mrpMinor: 38_000,
          costPriceMinor: 30_000,
          reorderLevelMilli: 5_000,
          barcodes: ['8901234000078'],
          active: true,
          onHandMilli: 20_000,
          hasHistory: false
        }
      ]
    }
    fakeBackend.on('products:list', () => ({
      items: [
        {
          variantId: 7,
          productId: 1,
          productName: 'Ponni Rice',
          variantName: '5 kg',
          sku: 'ITEM-00007',
          barcodes: ['8901234000078'],
          categoryId: null,
          categoryName: null,
          taxClassId: 2,
          taxClassName: 'GST 5%',
          unitCode: 'pcs',
          sellingPriceMinor: 35_000,
          mrpMinor: 38_000,
          tracksInventory: true,
          onHandMilli: 20_000,
          reorderLevelMilli: 5_000,
          active: true
        }
      ],
      total: 1
    }))
    fakeBackend.on('products:get', () => product)

    renderApp('/products')
    const row = await screen.findByText('Ponni Rice')
    await userEvent.click(row)

    const printLabelBtn = await screen.findByRole('button', { name: 'Print label for 5 kg' })
    await userEvent.click(printLabelBtn)

    const labelDialog = await screen.findByRole('dialog', { name: /Print price label · Ponni Rice · 5 kg/i })
    expect(await within(labelDialog).findByLabelText('Price label preview')).toBeTruthy()

    const copiesInput = within(labelDialog).getByLabelText('Number of copies (1–50)')
    await userEvent.clear(copiesInput)
    await userEvent.type(copiesInput, '3')

    await userEvent.click(within(labelDialog).getByRole('button', { name: /Print 3 labels/i }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('labels:print').at(-1)).toEqual({
        variantId: 7,
        copies: 3,
        packedDate: null
      })
    )
  })
})
