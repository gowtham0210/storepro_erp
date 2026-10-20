import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import type { CustomerPurchasePage, CustomerSummary, ItemLookup } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const MEENA: CustomerSummary = {
  customerId: 1,
  name: 'Meena Sundar',
  phone: '+919840012345',
  email: 'meena@example.com',
  address: 'Adyar, Chennai',
  taxRegistrationNumber: null,
  active: true,
  saleCount: 2,
  lastPurchaseAt: Date.UTC(2026, 9, 12, 5, 0)
}

const ARJUN: CustomerSummary = {
  customerId: 2,
  name: 'Arjun Rao',
  phone: null,
  email: null,
  address: null,
  taxRegistrationNumber: '33AAAAA0000A1Z5',
  active: true,
  saleCount: 0,
  lastPurchaseAt: null
}

function serveCustomers(items: CustomerSummary[] = [MEENA, ARJUN]): void {
  fakeBackend.on('customers:list', (filter) => {
    const search = filter.search?.toLowerCase()
    const shown = items.filter((c) => !search || c.name.toLowerCase().includes(search))
    return { items: shown, total: shown.length }
  })
}

describe('Customers screen (M17-01)', () => {
  it('lists customers with how much they have bought', async () => {
    serveCustomers()
    renderApp('/customers')
    expect(await screen.findByText('Meena Sundar')).toBeTruthy()
    expect(screen.getByText('+919840012345')).toBeTruthy()
    expect(screen.getByText('33AAAAA0000A1Z5')).toBeTruthy()
    expect(screen.getByText('Adyar, Chennai')).toBeTruthy()
  })

  it('adds a customer, checking the phone number and storing it without spaces', async () => {
    const user = userEvent.setup()
    serveCustomers()
    fakeBackend.on('customers:create', (input) => ({
      ...ARJUN,
      customerId: 3,
      ...input,
      saleCount: 0,
      lastPurchaseAt: null
    }))
    renderApp('/customers')
    await screen.findByText('Meena Sundar')

    await user.click(screen.getByRole('button', { name: 'Add customer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add customer' })

    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }))
    expect(await within(dialog).findAllByText('Enter the customer name')).not.toHaveLength(0)

    await user.type(within(dialog).getByLabelText(/Customer name/), 'Kavitha')
    await user.type(within(dialog).getByLabelText('Phone'), '12345')
    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }))
    expect(await within(dialog).findByText('Enter a phone number with 7 to 15 digits')).toBeTruthy()
    expect(fakeBackend.callsTo('customers:create')).toHaveLength(0)

    await user.clear(within(dialog).getByLabelText('Phone'))
    await user.type(within(dialog).getByLabelText('Phone'), '98765 43210')
    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('customers:create')).toEqual([
        {
          name: 'Kavitha',
          phone: '9876543210',
          email: null,
          address: null,
          taxRegistrationNumber: null
        }
      ])
    )
  })

  it('shows who already has a phone number on that field', async () => {
    const user = userEvent.setup()
    serveCustomers()
    fakeBackend.on('customers:create', () => {
      throw new AppError('CONFLICT', 'Meena Sundar already has this phone number', [
        { path: 'phone', message: 'Meena Sundar already has this phone number' }
      ])
    })
    renderApp('/customers')
    await screen.findByText('Meena Sundar')

    await user.click(screen.getByRole('button', { name: 'Add customer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add customer' })
    await user.type(within(dialog).getByLabelText(/Customer name/), 'Someone Else')
    await user.type(within(dialog).getByLabelText('Phone'), '9840012345')
    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }))
    expect(
      await within(dialog).findByText('Meena Sundar already has this phone number')
    ).toBeTruthy()
  })

  it('shows purchase history with what they spent', async () => {
    const user = userEvent.setup()
    serveCustomers()
    const history: CustomerPurchasePage = {
      customerId: 1,
      customerName: 'Meena Sundar',
      total: 2,
      totalSpentMinor: 10_000,
      items: [
        {
          saleId: 2,
          invoiceNumber: 'INV000002',
          completedAt: Date.UTC(2026, 9, 12, 5, 0),
          lineCount: 1,
          grandTotalMinor: 5000,
          returnedMinor: 0,
          isVoided: false
        },
        {
          saleId: 1,
          invoiceNumber: 'INV000001',
          completedAt: Date.UTC(2026, 9, 10, 5, 0),
          lineCount: 2,
          grandTotalMinor: 10_000,
          returnedMinor: 5000,
          isVoided: false
        }
      ]
    }
    fakeBackend.on('customers:purchases', () => history)
    renderApp('/customers')
    await screen.findByText('Meena Sundar')

    await user.click(screen.getByRole('button', { name: 'Purchases by Meena Sundar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Meena Sundar: purchases' })
    expect(await within(dialog).findByText('INV000001')).toBeTruthy()
    expect(within(dialog).getByText('INV000002')).toBeTruthy()
    expect(within(dialog).getByText('₹100.00', { selector: 'span.font-semibold' })).toBeTruthy()
  })

  it('asks before archiving', async () => {
    const user = userEvent.setup()
    serveCustomers()
    fakeBackend.on('customers:set-active', ({ customerId, active }) => ({
      ...MEENA,
      customerId,
      active
    }))
    renderApp('/customers')
    await screen.findByText('Meena Sundar')

    await user.click(screen.getByRole('button', { name: 'Archive Meena Sundar' }))
    const confirm = await screen.findByRole('dialog', { name: 'Archive Meena Sundar?' })
    await user.click(within(confirm).getByRole('button', { name: 'Archive customer' }))
    await waitFor(() =>
      expect(fakeBackend.callsTo('customers:set-active')).toEqual([
        { customerId: 1, active: false }
      ])
    )
  })

  it('is read-only without the manage permission, and hides history without sales access', async () => {
    serveCustomers()
    fakeBackend.authState = {
      status: 'signed-in',
      user: userWithRole('cashier', { permissions: ['customer.view'] })
    }
    renderApp('/customers')
    await screen.findByText('Meena Sundar')
    expect(screen.queryByRole('button', { name: 'Add customer' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Purchases by / })).toBeNull()
  })

  it('has no axe violations, with or without the form open', async () => {
    const user = userEvent.setup()
    serveCustomers()
    renderApp('/customers')
    await screen.findByText('Meena Sundar')
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
    await user.click(screen.getByRole('button', { name: 'Add customer' }))
    await screen.findByRole('dialog', { name: 'Add customer' })
    expect(await run()).toEqual([])
  })
})

describe('Customer on the bill (M17-02)', () => {
  const RICE: ItemLookup = {
    variantId: 10,
    productId: 1,
    name: 'Ponni Rice 5 kg',
    sku: 'RICE-5KG',
    unitCode: 'pcs',
    allowsFraction: false,
    sellingPriceMinor: 32_000,
    mrpMinor: null,
    taxClassId: 2,
    tracksInventory: true,
    onHandMilli: 20_000
  }

  it('chooses a customer, shows them on the bill, and sends them with checkout', async () => {
    const user = userEvent.setup()
    serveCustomers()
    fakeBackend.on('products:find-by-barcode', () => RICE)
    fakeBackend.on('sales:checkout', (input) => {
      throw new AppError('INTERNAL', 'stop here', input)
    })
    renderApp('/billing')
    expect(await screen.findByText('Walk-in customer')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Add customer' }))
    const picker = await screen.findByRole('dialog', { name: 'Choose a customer' })
    await user.type(within(picker).getByLabelText('Search customers'), 'meena')
    await user.click(await within(picker).findByRole('button', { name: /Meena Sundar/ }))

    expect(await screen.findByText('Meena Sundar')).toBeTruthy()
    expect(screen.queryByText('Walk-in customer')).toBeNull()

    await user.type(screen.getByLabelText('Scan barcode or enter SKU'), '8901234000011{Enter}')
    await screen.findByRole('table', { name: 'Current bill items' })
    fireEvent.keyDown(window, { key: 'F12', code: 'F12' })
    const pay = await screen.findByRole('dialog', { name: 'Take payment' })
    await user.click(within(pay).getByRole('button', { name: 'Complete sale' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('sales:checkout')).toEqual([
        expect.objectContaining({ customerId: 1 })
      ])
    )
  })

  it('removes the customer again, and adds a new one without leaving the bill', async () => {
    const user = userEvent.setup()
    serveCustomers()
    fakeBackend.on('customers:create', (input) => ({
      ...ARJUN,
      customerId: 7,
      ...input,
      saleCount: 0,
      lastPurchaseAt: null
    }))
    renderApp('/billing')
    await screen.findByText('Walk-in customer')

    await user.click(screen.getByRole('button', { name: 'Add customer' }))
    const picker = await screen.findByRole('dialog', { name: 'Choose a customer' })
    await user.click(within(picker).getByRole('button', { name: 'Add new customer' }))
    const form = await screen.findByRole('dialog', { name: 'Add customer' })
    await user.type(within(form).getByLabelText(/Customer name/), 'Kavitha')
    await user.click(within(form).getByRole('button', { name: 'Add customer' }))

    expect(await screen.findByText('Kavitha')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Remove Kavitha from this bill' }))
    expect(await screen.findByText('Walk-in customer')).toBeTruthy()
  })
})
