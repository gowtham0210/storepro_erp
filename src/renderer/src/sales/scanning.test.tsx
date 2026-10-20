import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ItemLookup } from '@shared/ipc/contract'
import { fakeBackend } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const item = (variantId: number, name: string, sku: string): ItemLookup => ({
  variantId,
  productId: variantId,
  name,
  sku,
  unitCode: 'pcs',
  allowsFraction: false,
  sellingPriceMinor: 10_000,
  mrpMinor: null,
  taxClassId: 2,
  tracksInventory: true,
  onHandMilli: 50_000
})

const TEA = item(10, 'Tata Tea Gold 250 g', 'TEA')
const SOAP = item(11, 'Neem Soap', 'SOAP')

/** A lookup that takes a moment, as a busy store's does, so the next scan arrives before it ends. */
const slowly = <T,>(value: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

describe('scanning while the last scan is still being looked up (M30-06)', () => {
  it('adds each barcode, none glued to the one before or lost', async () => {
    const user = userEvent.setup({ delay: 8 })
    fakeBackend.on('products:find-by-barcode', ({ barcode }) =>
      slowly(barcode === '8901052001012' ? TEA : barcode === '8901234000028' ? SOAP : null)
    )
    renderApp('/billing')
    const scan = await screen.findByLabelText('Scan barcode or enter SKU')

    await user.type(scan, '8901052001012{Enter}')
    // The next scan starts while the first lookup is still running.
    await user.type(scan, '8901234000028{Enter}')

    expect(await screen.findByText('Neem Soap')).toBeTruthy()
    expect(screen.getByText('Tata Tea Gold 250 g')).toBeTruthy()
    expect(screen.queryByText(/No product matches/)).toBeNull()
    await waitFor(() => expect((scan as HTMLInputElement).value).toBe(''))
    expect(fakeBackend.callsTo('products:find-by-barcode')).toEqual([
      { barcode: '8901052001012' },
      { barcode: '8901234000028' }
    ])
  })

  it('counts the same item twice when it is scanned twice in a row', async () => {
    const user = userEvent.setup({ delay: 8 })
    fakeBackend.on('products:find-by-barcode', () => slowly(TEA))
    renderApp('/billing')
    const scan = await screen.findByLabelText('Scan barcode or enter SKU')

    await user.type(scan, '8901052001012{Enter}')
    await user.type(scan, '8901052001012{Enter}')

    await waitFor(() =>
      expect(
        (screen.getByLabelText('Quantity of Tata Tea Gold 250 g') as HTMLInputElement).value
      ).toBe('2')
    )
    expect(fakeBackend.callsTo('products:find-by-barcode')).toEqual([
      { barcode: '8901052001012' },
      { barcode: '8901052001012' }
    ])
  })

  it('puts an unknown code back in the field so it can be corrected', async () => {
    const user = userEvent.setup()
    fakeBackend.on('products:find-by-barcode', () => slowly(null, 10))
    renderApp('/billing')
    const scan = await screen.findByLabelText('Scan barcode or enter SKU')

    await user.type(scan, '12345{Enter}')
    expect(await screen.findByText('No product matches barcode or SKU “12345”.')).toBeTruthy()
    await waitFor(() => expect((scan as HTMLInputElement).value).toBe('12345'))
  })
})
