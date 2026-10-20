import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import type { ExpenseCategorySummary, ExpenseSummary } from '@shared/ipc/contract'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const CATEGORIES: ExpenseCategorySummary[] = [
  { expenseCategoryId: 1, name: 'Rent', active: true, expenseCount: 1 },
  { expenseCategoryId: 2, name: 'Electricity', active: true, expenseCount: 1 },
  { expenseCategoryId: 3, name: 'Packaging', active: false, expenseCount: 0 }
]

const RENT: ExpenseSummary = {
  expenseId: 11,
  expenseCategoryId: 1,
  categoryName: 'Rent',
  expenseDate: '2026-10-05',
  amountMinor: 1_200_000,
  paymentMethodId: 2,
  paymentMethodName: 'UPI',
  description: 'October shop rent',
  recordedByName: 'Ravi Kumar',
  recordedAt: Date.UTC(2026, 9, 5, 5, 0),
  updatedAt: Date.UTC(2026, 9, 5, 5, 0),
  voided: false
}

const POWER: ExpenseSummary = {
  ...RENT,
  expenseId: 12,
  expenseCategoryId: 2,
  categoryName: 'Electricity',
  expenseDate: '2026-10-10',
  amountMinor: 450_050,
  paymentMethodId: 1,
  paymentMethodName: 'Cash',
  description: null
}

function serveExpenses(items: ExpenseSummary[] = [POWER, RENT]): void {
  fakeBackend.on('expenses:list-categories', () => CATEGORIES)
  fakeBackend.on('expenses:list', (filter) => {
    const shown = items.filter(
      (e) =>
        (filter.from === undefined || e.expenseDate >= filter.from) &&
        (filter.to === undefined || e.expenseDate <= filter.to)
    )
    return {
      items: shown,
      total: shown.length,
      totalMinor: shown.filter((e) => !e.voided).reduce((sum, e) => sum + e.amountMinor, 0)
    }
  })
}

describe('Expenses screen (M18)', () => {
  it('lists expenses with their total, and narrows both by date', async () => {
    serveExpenses()
    renderApp('/expenses')

    expect(await screen.findByText('October shop rent')).toBeTruthy()
    expect(screen.getByText('Electricity', { selector: 'td *, td' })).toBeTruthy()
    // 12,000.00 + 4,500.50
    expect(await screen.findByText('₹16,500.50', { selector: 'p *' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-08' } })
    await waitFor(() =>
      expect(fakeBackend.callsTo('expenses:list')).toContainEqual(
        expect.objectContaining({ from: '2026-10-08' })
      )
    )
    expect(await screen.findByText('₹4,500.50', { selector: 'p *' })).toBeTruthy()
    expect(screen.queryByText('October shop rent')).toBeNull()
  })

  it('refuses an end date before the start date without asking the main process', async () => {
    serveExpenses()
    renderApp('/expenses')
    await screen.findByText('October shop rent')

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } })
    expect(await screen.findByText('The end date is before the start date')).toBeTruthy()
    expect(
      fakeBackend.callsTo('expenses:list').some((call) => {
        const filter = call as { from?: string; to?: string }
        return filter.from === '2026-10-20' && filter.to === '2026-10-01'
      })
    ).toBe(false)
  })

  it('records an expense in minor units, checking the form first', async () => {
    const user = userEvent.setup()
    serveExpenses()
    fakeBackend.on('expenses:create', (input) => ({
      ...RENT,
      expenseId: 13,
      ...input,
      categoryName: 'Rent',
      paymentMethodName: 'Cash'
    }))
    renderApp('/expenses')
    await screen.findByText('October shop rent')

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add expense' })

    await user.click(within(dialog).getByRole('button', { name: 'Add expense' }))
    expect(await within(dialog).findByText('Choose a category')).toBeTruthy()
    expect(within(dialog).getByText('Enter an amount above zero')).toBeTruthy()
    expect(within(dialog).getByText('Choose how it was paid')).toBeTruthy()
    expect(fakeBackend.callsTo('expenses:create')).toHaveLength(0)

    // Archived categories are not offered for a new expense.
    const options = within(within(dialog).getByLabelText(/Category/)).getAllByRole('option')
    expect(options.map((o) => o.textContent)).not.toContain('Packaging (archived)')

    await user.selectOptions(within(dialog).getByLabelText(/Category/), '1')
    fireEvent.change(within(dialog).getByLabelText(/Date/), { target: { value: '2026-10-12' } })
    await user.type(within(dialog).getByLabelText(/Amount/), '1250.5')
    await user.selectOptions(within(dialog).getByLabelText(/Paid by/), '1')
    await user.type(within(dialog).getByLabelText(/Note/), 'Weekly cleaning')
    await user.click(within(dialog).getByRole('button', { name: 'Add expense' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('expenses:create')).toEqual([
        {
          expenseCategoryId: 1,
          expenseDate: '2026-10-12',
          amountMinor: 125_050,
          paymentMethodId: 1,
          description: 'Weekly cleaning'
        }
      ])
    )
    expect(await screen.findByText('The expense was recorded.')).toBeTruthy()
  })

  it('asks before voiding, then voids', async () => {
    const user = userEvent.setup()
    serveExpenses()
    fakeBackend.on('expenses:set-voided', ({ expenseId, voided }) => ({
      ...RENT,
      expenseId,
      voided
    }))
    renderApp('/expenses')
    await screen.findByText('October shop rent')

    await user.click(screen.getByRole('button', { name: 'Void Rent expense of 2026-10-05' }))
    const confirm = await screen.findByRole('dialog', { name: 'Void this expense?' })
    expect(fakeBackend.callsTo('expenses:set-voided')).toHaveLength(0)
    await user.click(within(confirm).getByRole('button', { name: 'Void expense' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('expenses:set-voided')).toEqual([{ expenseId: 11, voided: true }])
    )
  })

  it('adds a category and shows archived ones, for someone who can manage expenses', async () => {
    const user = userEvent.setup()
    serveExpenses()
    fakeBackend.on('expenses:create-category', ({ name }) => ({
      expenseCategoryId: 9,
      name,
      active: true,
      expenseCount: 0
    }))
    renderApp('/expenses')
    await screen.findByText('October shop rent')

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    const dialog = await screen.findByRole('dialog', { name: 'Expense categories' })
    expect(await within(dialog).findByText('Packaging')).toBeTruthy()
    expect(within(dialog).getByText('Archived')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Add category' }))
    expect(await within(dialog).findByText('Enter a category name')).toBeTruthy()

    await user.type(within(dialog).getByLabelText('New category'), 'Insurance')
    await user.click(within(dialog).getByRole('button', { name: 'Add category' }))
    await waitFor(() =>
      expect(fakeBackend.callsTo('expenses:create-category')).toEqual([{ name: 'Insurance' }])
    )
  })

  it('is read-only for someone who can view but not record expenses', async () => {
    serveExpenses()
    fakeBackend.authState = {
      status: 'signed-in',
      user: userWithRole('manager', { permissions: ['expense.view'] })
    }
    renderApp('/expenses')
    await screen.findByText('October shop rent')
    expect(screen.queryByRole('button', { name: 'Add expense' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Void / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
  })

  it('has no axe violations, with or without the form open', async () => {
    const user = userEvent.setup()
    serveExpenses()
    renderApp('/expenses')
    await screen.findByText('October shop rent')

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
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await screen.findByRole('dialog', { name: 'Add expense' })
    expect(await run()).toEqual([])
  })
})
