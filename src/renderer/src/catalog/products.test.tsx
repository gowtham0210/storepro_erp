import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { NewProduct, ProductDetail, ProductListItem } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const RICE: ProductListItem = {
  variantId: 11,
  productId: 1,
  productName: 'Sona Masoori Rice',
  variantName: '5 kg',
  sku: 'RICE-5',
  barcodes: ['8901000000035', '2000000000017'],
  unitCode: 'pcs',
  categoryName: 'Staples',
  sellingPriceMinor: 32000,
  mrpMinor: 34000,
  tracksInventory: true,
  onHandMilli: 12_000,
  active: true
}

function detailOf(input: NewProduct, productId = 7): ProductDetail {
  return {
    productId,
    name: input.name,
    categoryId: input.categoryId,
    taxClassId: input.taxClassId,
    hsnCode: input.hsnCode,
    tracksInventory: input.tracksInventory,
    active: true,
    createdAt: 0,
    updatedAt: 0,
    variants: input.variants.map((variant, index) => ({
      ...variant,
      variantId: 100 + index,
      sku: variant.sku ?? `ITEM-0010${index}`,
      active: true,
      onHandMilli: 0,
      hasHistory: false
    }))
  }
}

describe('products screen (M09-05, M09-06)', () => {
  it('lists items with their price, barcode and stock', async () => {
    fakeBackend.on('products:list', () => ({ items: [RICE], total: 1 }))
    renderApp('/products')
    // The screen is loaded on first use, which can take a while in tests.
    const table = await screen.findByRole('table', { name: 'Products' }, { timeout: 5000 })
    const row = (await within(table).findByText('Sona Masoori Rice')).closest('tr')!
    expect(within(row).getByText('₹320.00')).toBeTruthy()
    expect(within(row).getByText('+1')).toBeTruthy()
    expect(within(row).getByText('12')).toBeTruthy()
    expect(within(row).getByText('RICE-5')).toBeTruthy()
  })

  it('searches once typing settles, and filters by status', async () => {
    const user = userEvent.setup()
    renderApp('/products')
    await user.type(await screen.findByLabelText(/^Search/), 'toor')
    await waitFor(() =>
      expect(fakeBackend.callsTo('products:list')).toContainEqual(
        expect.objectContaining({ search: 'toor', status: 'active', offset: 0 })
      )
    )
    await user.selectOptions(screen.getByLabelText('Show'), 'archived')
    await waitFor(() =>
      expect(fakeBackend.callsTo('products:list')).toContainEqual(
        expect.objectContaining({ search: 'toor', status: 'archived' })
      )
    )
  })

  it('adds a product with its first pack size, sending amounts in paise', async () => {
    const user = userEvent.setup()
    let created: NewProduct | undefined
    fakeBackend.on('products:create', (input) => {
      created = input
      return detailOf(input)
    })
    fakeBackend.on('products:get', () => detailOf(created!))
    renderApp('/products')
    await user.click(await screen.findByRole('button', { name: 'Add product' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add product' })
    await user.type(within(dialog).getByLabelText(/^Product name/), 'Neem Soap')
    await user.selectOptions(within(dialog).getByLabelText(/^Tax rate/), '3')
    await user.type(within(dialog).getByLabelText(/^Selling price/), '45.5')
    await user.type(within(dialog).getByLabelText(/^MRP/), '50')
    await user.type(
      within(dialog).getByLabelText(/^Barcodes/),
      '8901234567890, 8901234567890 2000000000017'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }))

    await waitFor(() => expect(created).toBeDefined())
    expect(created).toEqual({
      name: 'Neem Soap',
      categoryId: null,
      taxClassId: 3,
      hsnCode: null,
      tracksInventory: true,
      variants: [
        {
          variantName: null,
          sku: null,
          unitCode: 'pcs',
          sellingPriceMinor: 4550,
          mrpMinor: 5000,
          costPriceMinor: null,
          reorderLevelMilli: null,
          barcodes: ['8901234567890', '2000000000017']
        }
      ]
    })
    // The new product opens, ready for more pack sizes.
    expect(await screen.findByRole('dialog', { name: 'Neem Soap' })).toBeTruthy()
  })

  it('checks prices before sending, and shows a barcode clash on the field', async () => {
    const user = userEvent.setup()
    fakeBackend.on('products:create', () => {
      const message = 'The barcode 8901234567890 is already used by Rose Soap'
      throw new AppError('CONFLICT', message, [{ path: 'variants.0.barcodes', message }])
    })
    renderApp('/products')
    await user.click(await screen.findByRole('button', { name: 'Add product' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add product' })
    await user.type(within(dialog).getByLabelText(/^Product name/), 'Neem Soap')
    await user.type(within(dialog).getByLabelText(/^Selling price/), '60')
    await user.type(within(dialog).getByLabelText(/^MRP/), '50')
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }))
    expect(
      await within(dialog).findByText("The selling price can't be more than the MRP")
    ).toBeTruthy()
    expect(fakeBackend.callsTo('products:create')).toEqual([])

    await user.clear(within(dialog).getByLabelText(/^MRP/))
    await user.type(within(dialog).getByLabelText(/^Barcodes/), '8901234567890')
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }))
    expect(
      await within(dialog).findByText('The barcode 8901234567890 is already used by Rose Soap')
    ).toBeTruthy()
    expect(
      within(dialog)
        .getByLabelText(/^Barcodes/)
        .getAttribute('aria-invalid')
    ).toBe('true')
  })

  it('lets a cashier look products up but not add or change them', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('cashier') }
    fakeBackend.on('products:list', () => ({ items: [RICE], total: 1 }))
    fakeBackend.on('products:get', () =>
      detailOf(
        {
          name: 'Sona Masoori Rice',
          categoryId: null,
          taxClassId: 2,
          hsnCode: '1006',
          tracksInventory: true,
          variants: [
            {
              variantName: '5 kg',
              sku: 'RICE-5',
              unitCode: 'pcs',
              sellingPriceMinor: 32000,
              mrpMinor: 34000,
              costPriceMinor: null,
              reorderLevelMilli: null,
              barcodes: []
            }
          ]
        },
        1
      )
    )
    const user = userEvent.setup()
    renderApp('/products')
    await screen.findByText('Sona Masoori Rice')
    expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull()
    await user.click(screen.getByText('Sona Masoori Rice'))
    const dialog = await screen.findByRole('dialog', { name: 'Sona Masoori Rice' })
    expect(
      within(dialog)
        .getByLabelText(/^Product name/)
        .matches(':disabled')
    ).toBe(true)
    expect(within(dialog).queryByRole('button', { name: 'Save product' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Edit/ })).toBeNull()
  })
})
