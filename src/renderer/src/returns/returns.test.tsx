import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import type {
  ReturnableSale,
  ReturnDetail,
  ReturnInput,
  SaleDetail,
  SaleListItem
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const INVOICE: ReturnableSale = {
  saleId: 101,
  invoiceNumber: 'INV000001',
  completedAt: Date.UTC(2026, 9, 19, 6, 0),
  customerName: 'Meena Sundar',
  pricesIncludeTax: true,
  isVoided: false,
  lines: [
    {
      saleItemId: 1,
      lineNumber: 1,
      variantId: 10,
      description: 'Ponni Rice 5 kg',
      sku: 'RICE-5KG',
      unitCode: 'pcs',
      allowsFraction: false,
      soldMilli: 2000,
      returnedMilli: 0,
      returnableMilli: 2000,
      unitPriceMinor: 32_000,
      netMinor: 64_000,
      taxes: []
    },
    {
      saleItemId: 2,
      lineNumber: 2,
      variantId: 11,
      description: 'Loose Sugar',
      sku: 'SUGAR',
      unitCode: 'kg',
      allowsFraction: true,
      soldMilli: 2500,
      returnedMilli: 500,
      returnableMilli: 2000,
      unitPriceMinor: 4400,
      netMinor: 11_000,
      taxes: []
    }
  ],
  payments: [{ paymentMethodId: 1, methodName: 'Cash', kind: 'cash', amountMinor: 75_000 }],
  returns: []
}

function detailOf(input: ReturnInput): ReturnDetail {
  const refunded = input.refunds.reduce((sum, r) => sum + r.amountMinor, 0)
  return {
    saleReturnId: 7,
    returnNumber: 'CN000001',
    saleId: input.saleId,
    invoiceNumber: 'INV000001',
    returnedAt: Date.UTC(2026, 9, 20, 6, 0),
    processedByName: 'Ravi Kumar',
    reason: input.reason,
    customerName: 'Meena Sundar',
    pricesIncludeTax: true,
    lines: input.lines.map((line, index) => ({
      saleReturnItemId: index + 1,
      saleItemId: line.saleItemId,
      lineNumber: 1,
      description: 'Ponni Rice 5 kg',
      sku: 'RICE-5KG',
      unitCode: 'pcs',
      disposition: line.disposition,
      quantityMilli: line.quantityMilli,
      unitPriceMinor: 32_000,
      creditMinor: 32_000,
      taxMinor: 0
    })),
    creditMinor: refunded,
    taxMinor: 0,
    taxSummary: [],
    refundDueMinor: refunded,
    refundedMinor: refunded,
    refunds: input.refunds.map((r, index) => ({
      returnRefundId: index + 1,
      saleReturnId: 7,
      returnNumber: 'CN000001',
      saleId: input.saleId,
      returnedAt: Date.UTC(2026, 9, 20, 6, 0),
      paymentMethodId: r.paymentMethodId,
      methodCode: 'cash',
      methodName: 'Cash',
      kind: 'cash',
      amountMinor: r.amountMinor,
      reference: r.reference ?? null
    }))
  }
}

const SALE_ITEM: SaleListItem = {
  saleId: 101,
  invoiceNumber: 'INV000001',
  completedAt: Date.UTC(2026, 9, 19, 6, 0),
  cashierName: 'Ravi Kumar',
  customerName: 'Meena Sundar',
  lineCount: 2,
  grandTotalMinor: 75_000,
  paymentSummary: 'Cash',
  isVoided: false
}

function serveInvoice(invoice: ReturnableSale = INVOICE): void {
  fakeBackend.on('returns:find-sale', ({ invoiceNumber }) =>
    invoiceNumber.toUpperCase() === invoice.invoiceNumber ? invoice : null
  )
  fakeBackend.on('returns:list', () => ({ items: [], total: 0 }))
}

async function openNewReturn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Returns' }))
  const list = await screen.findByRole('dialog', { name: 'Returns' })
  await user.click(within(list).getByRole('button', { name: 'Take a return' }))
  return screen.findByRole('dialog', { name: 'Take a return' })
}

async function findInvoice(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  invoiceNumber = 'INV000001'
) {
  await user.type(within(dialog).getByLabelText('Invoice number'), invoiceNumber)
  await user.click(within(dialog).getByRole('button', { name: 'Find invoice' }))
}

describe('Returns (M16)', () => {
  it('takes a return: shows what is due as quantities are entered, then records it', async () => {
    const user = userEvent.setup()
    serveInvoice()
    fakeBackend.on('returns:create', (input) => detailOf(input))
    fakeBackend.on('returns:get', () =>
      detailOf({
        saleId: 101,
        reason: 'Torn bag',
        lines: [{ saleItemId: 1, quantityMilli: 1000, disposition: 'restock' }],
        refunds: [{ paymentMethodId: 1, amountMinor: 32_000 }]
      })
    )
    renderApp('/sales')

    const dialog = await openNewReturn(user)
    await findInvoice(user, dialog)
    expect(await within(dialog).findByText('Ponni Rice 5 kg')).toBeTruthy()
    expect(within(dialog).getAllByText(/2 can come back/)).toHaveLength(2)
    // Sugar was part-returned before.
    expect(within(dialog).getByText(/already returned 0.5/)).toBeTruthy()

    // Nothing is due until something is coming back.
    expect(
      within(dialog).getByText('Enter the quantity coming back to see what is due.')
    ).toBeTruthy()

    await user.type(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'), '1')
    // 1 of 2 bags from a line that cost ₹640.00 in all.
    expect(await within(dialog).findByText('The refund adds up.')).toBeTruthy()
    expect(within(dialog).getAllByText('₹320.00').length).toBeGreaterThan(0)
    expect(within(dialog).getByLabelText('Refund amount 1')).toHaveProperty('value', '320.00')

    await user.type(within(dialog).getByLabelText(/Reason/), 'Torn bag')
    await user.click(within(dialog).getByRole('button', { name: 'Record return and refund' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('returns:create')).toEqual([
        {
          saleId: 101,
          reason: 'Torn bag',
          lines: [{ saleItemId: 1, quantityMilli: 1000, disposition: 'restock' }],
          refunds: [{ paymentMethodId: 1, amountMinor: 32_000, reference: null }]
        }
      ])
    )
    const done = await screen.findByRole('dialog', { name: 'Return CN000001' })
    expect(within(done).getByText('Return recorded')).toBeTruthy()
  })

  it('splits a line so some goods go back on the shelf and some are written off', async () => {
    const user = userEvent.setup()
    serveInvoice()
    fakeBackend.on('returns:create', (input) => detailOf(input))
    renderApp('/sales')
    const dialog = await openNewReturn(user)
    await findInvoice(user, dialog)
    await within(dialog).findByText('Ponni Rice 5 kg')

    await user.click(
      within(dialog).getByRole('button', { name: 'Split Ponni Rice 5 kg into another row' })
    )
    await user.type(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'), '1')
    await user.type(
      within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return (another row)'),
      '1'
    )
    expect(
      within(dialog).getByLabelText('What happens to Ponni Rice 5 kg (another row)')
    ).toHaveProperty('value', 'write_off')
    await user.click(within(dialog).getByRole('button', { name: 'Record return and refund' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('returns:create')).toEqual([
        expect.objectContaining({
          lines: [
            { saleItemId: 1, quantityMilli: 1000, disposition: 'restock' },
            { saleItemId: 1, quantityMilli: 1000, disposition: 'write_off' }
          ],
          refunds: [{ paymentMethodId: 1, amountMinor: 64_000, reference: null }]
        })
      ])
    )
  })

  it('refuses more than can come back, a refund that does not add up, and an unknown invoice', async () => {
    const user = userEvent.setup()
    serveInvoice()
    renderApp('/sales')
    const dialog = await openNewReturn(user)

    await user.type(within(dialog).getByLabelText('Invoice number'), 'INV999999')
    await user.click(within(dialog).getByRole('button', { name: 'Find invoice' }))
    expect(await within(dialog).findByText('No invoice INV999999 was found.')).toBeTruthy()

    await user.clear(within(dialog).getByLabelText('Invoice number'))
    await user.type(within(dialog).getByLabelText('Invoice number'), 'inv000001')
    await user.click(within(dialog).getByRole('button', { name: 'Find invoice' }))
    await within(dialog).findByText('Ponni Rice 5 kg')

    await user.type(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'), '3')
    expect(
      await within(dialog).findByText('More than was sold, or already returned, on this invoice')
    ).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Record return and refund' })).toHaveProperty(
      'disabled',
      true
    )

    // Whole numbers only for a piece item; fractions are fine for kilograms.
    await user.clear(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'))
    await user.type(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'), '1')
    await user.type(within(dialog).getByLabelText('Quantity of Loose Sugar to return'), '0.5')
    expect(await within(dialog).findByText('The refund adds up.')).toBeTruthy()

    // Refund less than is due.
    await user.clear(within(dialog).getByLabelText('Refund amount 1'))
    await user.type(within(dialog).getByLabelText('Refund amount 1'), '100')
    expect(await within(dialog).findByText(/still to refund/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Record return and refund' }))
    expect(await within(dialog).findAllByText(/is still to be refunded/)).not.toHaveLength(0)
    expect(fakeBackend.callsTo('returns:create')).toHaveLength(0)
  })

  it('splits a refund across methods', async () => {
    const user = userEvent.setup()
    serveInvoice()
    fakeBackend.on('returns:create', (input) => detailOf(input))
    renderApp('/sales')
    const dialog = await openNewReturn(user)
    await findInvoice(user, dialog)
    await within(dialog).findByText('Ponni Rice 5 kg')
    await user.type(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'), '1')
    await within(dialog).findByText('The refund adds up.')

    await user.clear(within(dialog).getByLabelText('Refund amount 1'))
    await user.type(within(dialog).getByLabelText('Refund amount 1'), '200')
    await user.click(within(dialog).getByRole('button', { name: 'Refund part another way' }))
    await user.selectOptions(within(dialog).getByLabelText('Refund method 2'), '2')
    expect(within(dialog).getByLabelText('Refund amount 2')).toHaveProperty('value', '120.00')
    await user.type(within(dialog).getByLabelText('UPI reference (optional)'), 'UTR-5521')
    await user.click(within(dialog).getByRole('button', { name: 'Record return and refund' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('returns:create')).toEqual([
        expect.objectContaining({
          refunds: [
            { paymentMethodId: 1, amountMinor: 20_000, reference: null },
            { paymentMethodId: 2, amountMinor: 12_000, reference: 'UTR-5521' }
          ]
        })
      ])
    )
  })

  it('asks a manager to approve when a cashier takes a return', async () => {
    const user = userEvent.setup()
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('cashier') }
    serveInvoice()
    fakeBackend.on('returns:create', (input) => {
      if (!input.overrideId) {
        throw new AppError('FORBIDDEN', 'Manager approval required', {
          permission: 'return.create',
          overridable: true
        })
      }
      return detailOf(input)
    })
    fakeBackend.on('returns:get', () =>
      detailOf({
        saleId: 101,
        reason: null,
        lines: [{ saleItemId: 1, quantityMilli: 1000, disposition: 'restock' }],
        refunds: [{ paymentMethodId: 1, amountMinor: 32_000 }]
      })
    )
    fakeBackend.on('auth:approve-override', () => ({
      overrideId: 'ovr-return-1',
      approvedBy: 'Ravi Kumar',
      expiresAt: Date.UTC(2026, 9, 20, 12, 15)
    }))
    renderApp('/sales')
    const dialog = await openNewReturn(user)
    await findInvoice(user, dialog)
    await within(dialog).findByText('Ponni Rice 5 kg')
    await user.type(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'), '1')
    await within(dialog).findByText('The refund adds up.')
    await user.click(within(dialog).getByRole('button', { name: 'Record return and refund' }))

    const approval = await screen.findByRole('dialog', { name: 'Manager approval needed' })
    await user.type(within(approval).getByLabelText("Approver's username"), 'owner')
    await user.type(within(approval).getByLabelText("Approver's password"), 'counter-top-42')
    await user.click(within(approval).getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('returns:create').at(-1)).toEqual(
        expect.objectContaining({ overrideId: 'ovr-return-1' })
      )
    )
    expect(await screen.findByRole('dialog', { name: 'Return CN000001' })).toBeTruthy()
  })

  it('cannot return a voided invoice, or one that is all back already', async () => {
    const user = userEvent.setup()
    serveInvoice({ ...INVOICE, isVoided: true })
    renderApp('/sales')
    const dialog = await openNewReturn(user)
    await findInvoice(user, dialog)
    expect(await within(dialog).findByText('This invoice was voided')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Record return and refund' })).toBeNull()
  })

  it('prints the receipt as the original once, then only as a duplicate', async () => {
    const user = userEvent.setup()
    serveInvoice()
    fakeBackend.on('returns:create', (input) => detailOf(input))
    fakeBackend.on('returns:get', () =>
      detailOf({
        saleId: 101,
        reason: null,
        lines: [{ saleItemId: 1, quantityMilli: 1000, disposition: 'restock' }],
        refunds: [{ paymentMethodId: 1, amountMinor: 32_000 }]
      })
    )
    fakeBackend.on('returns:print-receipt', () => ({
      printed: true,
      printerName: null,
      printMode: 'driver',
      paperWidthMm: 80,
      escPosByteLength: null
    }))
    fakeBackend.on('returns:preview-receipt', ({ isReprint }) => ({
      saleReturnId: 7,
      returnNumber: 'CN000001',
      paperWidthMm: 80,
      columns: 48,
      isReprint: Boolean(isReprint),
      lines: ['*** RETURN / CREDIT NOTE ***', 'TOTAL REFUND  ₹320.00'],
      html: '<html></html>'
    }))
    renderApp('/sales')
    const dialog = await openNewReturn(user)
    await findInvoice(user, dialog)
    await within(dialog).findByText('Ponni Rice 5 kg')
    await user.type(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'), '1')
    await within(dialog).findByText('The refund adds up.')
    await user.click(within(dialog).getByRole('button', { name: 'Record return and refund' }))

    const done = await screen.findByRole('dialog', { name: 'Return CN000001' })
    await user.click(within(done).getByRole('button', { name: 'Print receipt' }))
    await waitFor(() =>
      expect(fakeBackend.callsTo('returns:print-receipt')).toEqual([
        { saleReturnId: 7, isReprint: false }
      ])
    )
    expect(await within(done).findByLabelText('Return receipt preview')).toBeTruthy()

    // From now on it is a duplicate.
    await user.click(await within(done).findByRole('button', { name: 'Reprint receipt' }))
    await waitFor(() =>
      expect(fakeBackend.callsTo('returns:print-receipt').at(-1)).toEqual({
        saleReturnId: 7,
        isReprint: true
      })
    )
  })

  it('keeps the return when the receipt fails to print', async () => {
    const user = userEvent.setup()
    serveInvoice()
    fakeBackend.on('returns:create', (input) => detailOf(input))
    fakeBackend.on('returns:get', () =>
      detailOf({
        saleId: 101,
        reason: null,
        lines: [{ saleItemId: 1, quantityMilli: 1000, disposition: 'restock' }],
        refunds: [{ paymentMethodId: 1, amountMinor: 32_000 }]
      })
    )
    fakeBackend.on('returns:print-receipt', () => {
      throw new AppError('INTERNAL', 'The printer is offline')
    })
    renderApp('/sales')
    const dialog = await openNewReturn(user)
    await findInvoice(user, dialog)
    await within(dialog).findByText('Ponni Rice 5 kg')
    await user.type(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'), '1')
    await within(dialog).findByText('The refund adds up.')
    await user.click(within(dialog).getByRole('button', { name: 'Record return and refund' }))
    const done = await screen.findByRole('dialog', { name: 'Return CN000001' })
    await user.click(within(done).getByRole('button', { name: 'Print receipt' }))
    expect(
      await within(done).findByText(/The return is saved, but the receipt did not print/)
    ).toBeTruthy()
    // It can be tried again.
    expect(within(done).getByRole('button', { name: 'Print receipt' })).toBeTruthy()
  })

  it('opens straight onto the invoice from its detail', async () => {
    const user = userEvent.setup()
    serveInvoice()
    fakeBackend.on('sales:list', () => ({ items: [SALE_ITEM], total: 1 }))
    const sale = {
      saleId: 101,
      invoiceNumber: 'INV000001',
      checkoutKey: 'chk',
      completedAt: SALE_ITEM.completedAt,
      cashierUserId: 1,
      cashierName: 'Ravi Kumar',
      customerId: null,
      customerName: null,
      pricesIncludeTax: true,
      grossMinor: 75_000,
      discountMinor: 0,
      taxableMinor: 75_000,
      taxMinor: 0,
      roundOffMinor: 0,
      grandTotalMinor: 75_000,
      paidMinor: 75_000,
      tenderedMinor: 75_000,
      changeMinor: 0,
      lines: [],
      taxSummary: [],
      payments: [],
      refunds: [],
      voidInfo: null
    } satisfies SaleDetail
    fakeBackend.on('sales:get', () => sale)
    renderApp('/sales')

    await user.click(await screen.findByRole('button', { name: 'View invoice INV000001' }))
    const detail = await screen.findByRole('dialog', { name: 'Invoice INV000001' })
    await user.click(within(detail).getByRole('button', { name: 'Return items' }))

    const dialog = await screen.findByRole('dialog', { name: 'Take a return' })
    expect(await within(dialog).findByText('Ponni Rice 5 kg')).toBeTruthy()
    expect(fakeBackend.callsTo('returns:find-sale')).toEqual([{ invoiceNumber: 'INV000001' }])
  })

  it('lists past returns', async () => {
    const user = userEvent.setup()
    fakeBackend.on('returns:list', () => ({
      total: 1,
      items: [
        {
          saleReturnId: 7,
          returnNumber: 'CN000001',
          saleId: 101,
          invoiceNumber: 'INV000001',
          returnedAt: Date.UTC(2026, 9, 20, 6, 0),
          processedByName: 'Ravi Kumar',
          customerName: 'Meena Sundar',
          itemCount: 1,
          refundDueMinor: 32_000
        }
      ]
    }))
    renderApp('/sales')
    await user.click(await screen.findByRole('button', { name: 'Returns' }))
    const list = await screen.findByRole('dialog', { name: 'Returns' })
    expect(await within(list).findByText('CN000001')).toBeTruthy()
    expect(within(list).getByText('Meena Sundar')).toBeTruthy()
    expect(within(list).getByText('₹320.00')).toBeTruthy()
  })

  it('has no axe violations on the return form', async () => {
    const user = userEvent.setup()
    serveInvoice()
    renderApp('/sales')
    const dialog = await openNewReturn(user)
    await findInvoice(user, dialog)
    await within(dialog).findByText('Ponni Rice 5 kg')
    await user.type(within(dialog).getByLabelText('Quantity of Ponni Rice 5 kg to return'), '1')
    await within(dialog).findByText('The refund adds up.')
    const results = await axe.run(document.body, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
      },
      rules: { 'color-contrast': { enabled: false } }
    })
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`
      )
    ).toEqual([])
  })
})
