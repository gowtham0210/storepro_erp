import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import type { SalesReport } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const SALES: SalesReport = {
  from: '2026-10-19',
  to: '2026-10-20',
  summary: {
    billCount: 3,
    grossMinor: 150_000,
    discountMinor: 5000,
    taxMinor: 6900,
    roundOffMinor: -100,
    billedMinor: 144_900,
    averageBillMinor: 48_300,
    refundCount: 1,
    refundsMinor: 20_000,
    refundedTaxMinor: 950,
    netSalesMinor: 124_900,
    voidedCount: 1,
    voidedMinor: 30_000,
    payments: [
      {
        paymentMethodId: 1,
        methodName: 'Cash',
        kind: 'cash',
        collectedMinor: 100_000,
        refundedMinor: 20_000,
        netMinor: 80_000
      },
      {
        paymentMethodId: 2,
        methodName: 'UPI',
        kind: 'upi',
        collectedMinor: 44_900,
        refundedMinor: 0,
        netMinor: 44_900
      }
    ],
    collectedMinor: 144_900,
    paidBackMinor: 20_000,
    netCollectedMinor: 124_900
  },
  days: [
    {
      date: '2026-10-19',
      billCount: 2,
      grossMinor: 100_000,
      discountMinor: 5000,
      taxMinor: 4000,
      billedMinor: 94_900,
      refundsMinor: 0,
      netSalesMinor: 94_900
    },
    {
      date: '2026-10-20',
      billCount: 1,
      grossMinor: 50_000,
      discountMinor: 0,
      taxMinor: 2900,
      billedMinor: 50_000,
      refundsMinor: 20_000,
      netSalesMinor: 30_000
    }
  ]
}

function serveSales(): void {
  fakeBackend.on('reports:sales', ({ from, to }) => ({ ...SALES, from, to }))
}

const salesCalls = () => fakeBackend.callsTo('reports:sales') as { from: string; to: string }[]

describe('Reports screen (M19)', () => {
  it('opens on today with the headline figures and what each one means', async () => {
    serveSales()
    renderApp('/reports')
    expect((await screen.findAllByText('₹1,249.00')).length).toBeGreaterThan(0) // net sales
    const first = salesCalls()[0]!
    expect(first.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(first.to).toBe(first.from)

    // Net sales, bills, average bill and refunds, each with its definition.
    expect(screen.getAllByText('Billed total minus refunds.').length).toBeGreaterThan(0)
    expect(screen.getByText('3', { selector: 'p' })).toBeTruthy()
    expect(screen.getAllByText('₹483.00').length).toBeGreaterThan(0)
    expect(screen.getByText(/1 return\./)).toBeTruthy()

    // Gross sales, discounts, tax, refunds and net sales are separate lines.
    const makeUp = screen.getByRole('region', { name: 'How the figures are made up' })
    for (const label of [
      'Gross sales',
      'Discounts',
      'Tax',
      'Billed total',
      'Refunds',
      'Net sales'
    ]) {
      expect(within(makeUp).getByText(label)).toBeTruthy()
    }
    expect(within(makeUp).getByText('₹1,500.00')).toBeTruthy()
    expect(screen.getByText(/1 voided bill/)).toBeTruthy()

    const methods = screen.getByRole('table', { name: 'Money by payment method' })
    expect(within(methods).getByText('Cash')).toBeTruthy()
    expect(within(methods).getByText('UPI')).toBeTruthy()
    expect(within(methods).getByText('₹800.00')).toBeTruthy()
  })

  it('asks for the dates typed, and refuses a period that ends before it starts', async () => {
    serveSales()
    renderApp('/reports')
    await screen.findAllByText('₹1,249.00')

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-19' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-20' } })
    await waitFor(() =>
      expect(salesCalls()).toContainEqual({ from: '2026-10-19', to: '2026-10-20' })
    )

    const before = salesCalls().length
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-25' } })
    expect(await screen.findByText('The end date is before the start date')).toBeTruthy()
    expect(
      salesCalls().filter((c) => c.from === '2026-10-25' && c.to === '2026-10-20')
    ).toHaveLength(0)
    expect(salesCalls().length).toBe(before)
  })

  it('picks a quick period', async () => {
    const user = userEvent.setup()
    serveSales()
    renderApp('/reports')
    await screen.findAllByText('₹1,249.00')
    const today = salesCalls()[0]!.from
    await user.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await waitFor(() => {
      const last = salesCalls().at(-1)!
      expect(last.to).toBe(today)
      expect(last.from < today).toBe(true)
    })
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveProperty('ariaSelected', null)
  })

  it('shows sales for each day with a total row', async () => {
    const user = userEvent.setup()
    serveSales()
    renderApp('/reports')
    await screen.findAllByText('₹1,249.00')
    await user.click(screen.getByRole('tab', { name: 'Sales' }))
    const table = await screen.findByRole('table', { name: 'Sales by day' })
    expect(within(table).getByText('2026-10-19')).toBeTruthy()
    expect(within(table).getByText('2026-10-20')).toBeTruthy()
    const rows = within(table).getAllByRole('row')
    const total = rows.at(-1)!
    expect(within(total).getByText('Total')).toBeTruthy()
    expect(within(total).getByText('₹1,249.00')).toBeTruthy()
  })

  it('ranks top items by value, or by quantity when asked', async () => {
    const user = userEvent.setup()
    fakeBackend.on('reports:top-products', ({ from, to, rankBy }) => ({
      from,
      to,
      rankBy,
      items: [
        {
          variantId: 10,
          name: 'Ponni Rice 5 kg',
          sku: 'RICE',
          unitCode: 'pcs',
          soldMilli: 6000,
          returnedMilli: 4000,
          netMilli: 2000,
          soldValueMinor: 192_000,
          returnedValueMinor: 128_000,
          netValueMinor: 64_000
        }
      ]
    }))
    renderApp('/reports?tab=products')
    const table = await screen.findByRole('table', { name: 'Top-selling items' })
    expect(within(table).getByText('Ponni Rice 5 kg')).toBeTruthy()
    expect(within(table).getByText('₹640.00')).toBeTruthy()
    expect(fakeBackend.callsTo('reports:top-products')[0]).toMatchObject({ rankBy: 'value' })

    await user.selectOptions(screen.getByLabelText('Rank by'), 'quantity')
    await waitFor(() =>
      expect(fakeBackend.callsTo('reports:top-products')).toContainEqual(
        expect.objectContaining({ rankBy: 'quantity' })
      )
    )
  })

  it('shows stock with its value and warns about items that have no cost price', async () => {
    const user = userEvent.setup()
    fakeBackend.on('reports:stock', (filter) => ({
      totals: {
        itemCount: 2,
        lowCount: 1,
        outCount: 0,
        valueMinor: 1_900_000,
        itemsWithoutCost: 1
      },
      items: [
        {
          variantId: 1,
          name: 'Sona Masoori Rice 1 kg',
          sku: 'RICE-1KG',
          unitCode: 'kg',
          categoryName: 'Staples',
          onHandMilli: 3000,
          reorderLevelMilli: 5000,
          costPriceMinor: 4800,
          valueMinor: filter.level === 'low' ? 14_400 : 14_400,
          isLow: true
        }
      ]
    }))
    renderApp('/reports?tab=stock')
    expect((await screen.findAllByText('₹19,000.00')).length).toBeGreaterThan(0)
    expect(screen.getByText('In stock without a cost price')).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Stock on hand' })
    expect(within(table).getByText('Low stock')).toBeTruthy()
    expect(within(table).getByText('₹144.00')).toBeTruthy()
    // Stock is as of now: there is no period to choose.
    expect(screen.queryByLabelText('From')).toBeNull()

    await user.selectOptions(screen.getByLabelText('Stock level'), 'low')
    await waitFor(() =>
      expect(fakeBackend.callsTo('reports:stock')).toContainEqual(
        expect.objectContaining({ level: 'low' })
      )
    )
  })

  it('shows purchases by supplier and receipt, and expenses by category', async () => {
    const user = userEvent.setup()
    fakeBackend.on('suppliers:list', () => ({ items: [], total: 0 }))
    fakeBackend.on('reports:purchases', ({ from, to }) => ({
      from,
      to,
      receiptCount: 2,
      totalMinor: 52_000,
      bySupplier: [
        { supplierId: 1, supplierName: 'Anand Wholesale', receiptCount: 2, totalMinor: 52_000 }
      ],
      receipts: [
        {
          goodsReceiptId: 5,
          receiptNumber: 'GRN000005',
          supplierId: 1,
          supplierName: 'Anand Wholesale',
          postedAt: Date.UTC(2026, 9, 20, 6, 0),
          supplierInvoiceNumber: 'AW-1',
          orderNumber: null,
          totalMinor: 30_000
        }
      ]
    }))
    fakeBackend.on('reports:expenses', ({ from, to }) => ({
      from,
      to,
      count: 3,
      totalMinor: 1_660_050,
      voidedCount: 1,
      voidedMinor: 70_000,
      byCategory: [{ expenseCategoryId: 1, name: 'Rent', count: 1, totalMinor: 1_200_000 }],
      byMethod: [{ paymentMethodId: 1, methodName: 'Cash', count: 3, totalMinor: 1_660_050 }]
    }))
    renderApp('/reports?tab=purchases')
    const bySupplier = await screen.findByRole('table', { name: 'Purchases by supplier' })
    expect(within(bySupplier).getByText('Anand Wholesale')).toBeTruthy()
    expect(
      within(screen.getByRole('table', { name: 'Goods receipts' })).getByText('GRN000005')
    ).toBeTruthy()
    expect(screen.getAllByText('₹520.00').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: 'Expenses' }))
    const byCategory = await screen.findByRole('table', { name: 'Expenses by category' })
    expect(within(byCategory).getByText('Rent')).toBeTruthy()
    expect(screen.getByText(/1 voided expense/)).toBeTruthy()
  })

  it('is closed to someone without report.view', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('cashier') }
    renderApp('/reports')
    expect(await screen.findByText(/don.t have access/i)).toBeTruthy()
    expect(fakeBackend.callsTo('reports:sales')).toHaveLength(0)
  })

  describe('exporting (M22-03)', () => {
    it('saves the sales report as a CSV with the dates and choices on screen', async () => {
      const user = userEvent.setup()
      serveSales()
      fakeBackend.on('reports:export', () => ({
        status: 'saved',
        fileName: 'sales_2026-10-19_to_2026-10-20.csv',
        rows: 2
      }))
      renderApp('/reports?tab=sales&from=2026-10-19&to=2026-10-20')
      await screen.findByRole('table', { name: 'Sales by day' })
      await user.click(screen.getByRole('button', { name: 'Export CSV' }))
      await waitFor(() =>
        expect(fakeBackend.callsTo('reports:export')).toEqual([
          { report: 'sales', from: '2026-10-19', to: '2026-10-20' }
        ])
      )
      expect(
        await screen.findByText('Saved sales_2026-10-19_to_2026-10-20.csv (2 rows).')
      ).toBeTruthy()
    })

    it('passes the filters of the stock and top-items reports along', async () => {
      const user = userEvent.setup()
      fakeBackend.on('reports:stock', () => ({
        items: [],
        totals: { itemCount: 0, lowCount: 0, outCount: 0, valueMinor: 0, itemsWithoutCost: 0 }
      }))
      fakeBackend.on('reports:export', () => ({ status: 'cancelled' }))
      renderApp('/reports?tab=stock')
      await screen.findByRole('table', { name: 'Stock on hand' })
      await user.selectOptions(screen.getByLabelText('Stock level'), 'low')
      await waitFor(() =>
        expect(fakeBackend.callsTo('reports:stock')).toContainEqual(
          expect.objectContaining({ level: 'low' })
        )
      )
      await user.click(screen.getByRole('button', { name: 'Export CSV' }))
      await waitFor(() =>
        expect(fakeBackend.callsTo('reports:export')).toEqual([{ report: 'stock', level: 'low' }])
      )
    })

    it('says nothing when the save dialog is closed, and reports a failure', async () => {
      const user = userEvent.setup()
      serveSales()
      let attempt = 0
      fakeBackend.on('reports:export', () => {
        attempt += 1
        if (attempt === 1) return { status: 'cancelled' }
        throw new AppError('CONFLICT', 'The file could not be saved.')
      })
      renderApp('/reports?tab=sales')
      await screen.findByRole('table', { name: 'Sales by day' })
      await user.click(screen.getByRole('button', { name: 'Export CSV' }))
      await waitFor(() => expect(attempt).toBe(1))
      expect(screen.queryByText(/^Saved /)).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Export CSV' }))
      expect(await screen.findByText('The file could not be saved.')).toBeTruthy()
    })

    it('is not offered to someone who may view reports but not export data', async () => {
      serveSales()
      fakeBackend.authState = {
        status: 'signed-in',
        user: userWithRole('manager', { permissions: ['report.view'] })
      }
      renderApp('/reports?tab=sales')
      await screen.findByRole('table', { name: 'Sales by day' })
      expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
    })
  })

  it('has no axe violations on the dashboard or the daily table', async () => {
    const user = userEvent.setup()
    serveSales()
    renderApp('/reports')
    await screen.findAllByText('₹1,249.00')
    const run = async (): Promise<string[]> =>
      (
        await axe.run(document.body, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
          },
          rules: { 'color-contrast': { enabled: false } }
        })
      ).violations.map(
        (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`
      )
    expect(await run()).toEqual([])
    await user.click(screen.getByRole('tab', { name: 'Sales' }))
    await screen.findByRole('table', { name: 'Sales by day' })
    expect(await run()).toEqual([])
  })
})
