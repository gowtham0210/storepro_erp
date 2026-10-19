import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { fakeBackend, TAX_CLASSES, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

describe('tax rates and pricing policy in Settings (M10-01, M10-04, M10-05)', () => {
  it('lists tax rates and adds or edits one, sending rates in basis points', async () => {
    const user = userEvent.setup()
    let classes = [...TAX_CLASSES]
    fakeBackend.on('tax:list-classes', () => classes)
    fakeBackend.on('tax:create-class', (input) => {
      const created = { taxClassId: 4, ...input, active: true, productCount: 0 }
      classes = [...classes, created]
      return created
    })
    fakeBackend.on('tax:update-class', ({ taxClassId, ...input }) => {
      classes = classes.map((t) => (t.taxClassId === taxClassId ? { ...t, ...input } : t))
      return classes.find((t) => t.taxClassId === taxClassId)!
    })

    renderApp('/settings')
    const section = await screen.findByRole('region', { name: 'Tax rates' }, { timeout: 5000 })
    expect(await within(section).findByText(/CGST and SGST/)).toBeTruthy()
    expect(within(section).getByText('GST 18%')).toBeTruthy()

    await user.click(within(section).getByRole('button', { name: 'Add tax rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add tax rate' })
    await user.type(within(dialog).getByLabelText(/^Name/), 'Aerated drinks')
    await user.type(within(dialog).getByLabelText(/^Tax rate/), '28')
    const cess = within(dialog).getByLabelText(/^Cess/)
    await user.clear(cess)
    await user.type(cess, '12')
    await user.click(within(dialog).getByRole('button', { name: 'Save tax rate' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('tax:create-class')).toEqual([
        { name: 'Aerated drinks', rateBp: 2800, cessRateBp: 1200 }
      ])
    )
    expect(await within(section).findByText('Aerated drinks')).toBeTruthy()
    expect(within(section).getByText('12%')).toBeTruthy()

    await user.click(within(section).getByRole('button', { name: 'Edit Aerated drinks' }))
    const editDialog = await screen.findByRole('dialog', { name: 'Edit Aerated drinks' })
    const editCess = within(editDialog).getByLabelText(/^Cess/)
    await user.clear(editCess)
    await user.type(editCess, '14.5')
    await user.click(within(editDialog).getByRole('button', { name: 'Save tax rate' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('tax:update-class')).toEqual([
        { taxClassId: 4, name: 'Aerated drinks', rateBp: 2800, cessRateBp: 1450 }
      ])
    )
  })

  it('shows a main-process error on its field when saving a tax rate', async () => {
    const user = userEvent.setup()
    fakeBackend.on('tax:create-class', () => {
      throw new AppError(
        'VALIDATION_FAILED',
        'GST rates must split equally into CGST and SGST, e.g. 5 or 18',
        [
          {
            path: 'rateBp',
            message: 'GST rates must split equally into CGST and SGST, e.g. 5 or 18'
          }
        ]
      )
    })
    renderApp('/settings')
    const section = await screen.findByRole('region', { name: 'Tax rates' }, { timeout: 5000 })
    await user.click(within(section).getByRole('button', { name: 'Add tax rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add tax rate' })
    await user.type(within(dialog).getByLabelText(/^Name/), 'Odd rate')
    await user.type(within(dialog).getByLabelText(/^Tax rate/), '0.25')
    await user.click(within(dialog).getByRole('button', { name: 'Save tax rate' }))
    expect(
      await within(dialog).findByText(
        'GST rates must split equally into CGST and SGST, e.g. 5 or 18'
      )
    ).toBeTruthy()
  })

  it('saves bill rounding and the cashier discount limit', async () => {
    const user = userEvent.setup()
    fakeBackend.on('pricing:update-policy', (policy) => ({
      ...policy,
      regime: 'gst',
      pricesIncludeTax: true
    }))
    renderApp('/settings')
    const section = await screen.findByRole(
      'region',
      { name: 'Rounding and discounts' },
      { timeout: 5000 }
    )
    const save = await within(section).findByRole('button', { name: 'Save rounding and discounts' })
    expect(save).toHaveProperty('disabled', true)

    await user.selectOptions(within(section).getByLabelText(/^Round bill totals/), '100')
    const limit = within(section).getByLabelText(/^Discount limit/)
    await user.clear(limit)
    await user.type(limit, '5')
    await user.click(save)

    expect(await screen.findByText('Rounding and discounts saved.')).toBeTruthy()
    expect(fakeBackend.callsTo('pricing:update-policy')).toEqual([
      { roundingMinor: 100, maxDiscountBp: 500 }
    ])
  })

  it('is read-only for managers', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('manager') }
    renderApp('/settings')
    const rates = await screen.findByRole('region', { name: 'Tax rates' }, { timeout: 5000 })
    await within(rates).findByText('GST 18%')
    expect(within(rates).queryByRole('button')).toBeNull()

    const policy = screen.getByRole('region', { name: 'Rounding and discounts' })
    await within(policy).findByLabelText(/^Discount limit/)
    expect(
      within(policy)
        .getByLabelText(/^Discount limit/)
        .matches(':disabled')
    ).toBe(true)
    expect(within(policy).queryByRole('button')).toBeNull()
  })
})
