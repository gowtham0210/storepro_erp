import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StockListItem } from '@shared/ipc/contract'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const RICE: StockListItem = {
  variantId: 10,
  productId: 1,
  productName: 'Sona Masoori Rice',
  variantName: '1 kg',
  name: 'Sona Masoori Rice 1 kg',
  sku: 'RICE-1KG',
  barcodes: ['8901000000011'],
  categoryName: 'Staples',
  unitCode: 'kg',
  allowsFraction: true,
  sellingPriceMinor: 6000,
  costPriceMinor: 4800,
  onHandMilli: 12_000,
  reorderLevelMilli: 5000,
  isLowStock: false
}

const SOAP: StockListItem = {
  variantId: 11,
  productId: 2,
  productName: 'Neem Soap',
  variantName: null,
  name: 'Neem Soap',
  sku: 'SOAP-100',
  barcodes: [],
  categoryName: null,
  unitCode: 'pcs',
  allowsFraction: false,
  sellingPriceMinor: 4500,
  costPriceMinor: 3200,
  onHandMilli: 3000,
  reorderLevelMilli: 5000,
  isLowStock: true
}

function serveInventory(items: StockListItem[] = [RICE, SOAP]): void {
  fakeBackend.on('inventory:list', (filter) => {
    const level = filter?.level ?? 'all'
    const filtered = items.filter((item) => {
      if (level === 'low') return item.isLowStock
      if (level === 'out') return item.onHandMilli <= 0
      return true
    })
    return {
      items: filtered,
      total: filtered.length,
      lowStockCount: items.filter((i) => i.isLowStock).length,
      outOfStockCount: items.filter((i) => i.onHandMilli <= 0).length
    }
  })
}

describe('Inventory screen (M14)', () => {
  it('lists tracked stock, highlights low-stock items, and filters to low stock', async () => {
    const user = userEvent.setup()
    serveInventory()
    renderApp('/inventory')

    expect(await screen.findByText('Sona Masoori Rice')).toBeTruthy()
    expect(screen.getByText('Neem Soap')).toBeTruthy()
    expect(screen.getByText('Low stock')).toBeTruthy()

    // Click the alert banner action to filter to low-stock items.
    await user.click(screen.getByRole('button', { name: 'Show low stock' }))
    await waitFor(() =>
      expect(fakeBackend.callsTo('inventory:list')).toContainEqual(
        expect.objectContaining({ level: 'low' })
      )
    )
    expect(screen.queryByText('Sona Masoori Rice')).toBeNull()
    expect(screen.getByText('Neem Soap')).toBeTruthy()
  })

  it('records a stock adjustment and enforces whole-number units', async () => {
    const user = userEvent.setup()
    serveInventory()
    fakeBackend.on('inventory:adjust', (input) => ({
      stockAdjustmentId: 1,
      adjustmentNumber: 'ADJ000001',
      reasonCode: input.reasonCode,
      reasonName: 'Damaged',
      adjustedAt: Date.UTC(2026, 9, 19, 6, 0),
      adjustedByName: 'Ravi Kumar',
      notes: input.notes,
      items: [
        {
          variantId: SOAP.variantId,
          name: SOAP.name,
          sku: SOAP.sku,
          unitCode: SOAP.unitCode,
          quantityDeltaMilli: input.items[0]!.quantityDeltaMilli,
          onHandAfterMilli: 1000
        }
      ]
    }))

    renderApp('/inventory')
    await screen.findByText('Neem Soap')

    await user.click(screen.getByRole('button', { name: 'Adjust Neem Soap' }))
    const dialog = await screen.findByRole('dialog', { name: 'Adjust stock' })

    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'damage')
    await user.type(within(dialog).getByLabelText('Quantity for Neem Soap'), '1.5')
    await user.click(within(dialog).getByRole('button', { name: 'Record adjustment' }))

    expect(
      await within(dialog).findByText('This unit can only be sold in whole numbers')
    ).toBeTruthy()

    await user.clear(within(dialog).getByLabelText('Quantity for Neem Soap'))
    await user.type(within(dialog).getByLabelText('Quantity for Neem Soap'), '2')
    await user.type(within(dialog).getByLabelText(/Note/), 'Damaged carton')
    await user.click(within(dialog).getByRole('button', { name: 'Record adjustment' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('inventory:adjust')).toEqual([
        {
          reasonCode: 'damage',
          notes: 'Damaged carton',
          items: [{ variantId: SOAP.variantId, quantityDeltaMilli: -2000 }]
        }
      ])
    )
    expect(await screen.findByText('Stock adjustment ADJ000001 was recorded.')).toBeTruthy()
  })

  it('reconciles a physical stock count sheet and shows live variances (M14-06)', async () => {
    const user = userEvent.setup()
    serveInventory()
    fakeBackend.on('inventory:reconcile', (input) => ({
      stockAdjustmentId: 2,
      adjustmentNumber: 'ADJ000002',
      reasonCode: 'count_correction',
      reasonName: 'Stock count correction',
      adjustedAt: Date.UTC(2026, 9, 19, 7, 0),
      adjustedByName: 'Ravi Kumar',
      notes: input.notes,
      items: [
        {
          variantId: RICE.variantId,
          name: RICE.name,
          sku: RICE.sku,
          unitCode: RICE.unitCode,
          quantityDeltaMilli: -750,
          onHandAfterMilli: 11_250
        }
      ]
    }))

    renderApp('/inventory')
    await screen.findByText('Sona Masoori Rice')

    await user.click(screen.getByRole('button', { name: 'Count stock' }))
    const dialog = await screen.findByRole('dialog', { name: 'Count stock' })

    await user.type(
      within(dialog).getByLabelText('Counted quantity for Sona Masoori Rice 1 kg'),
      '11.25'
    )
    await user.type(within(dialog).getByLabelText('Counted quantity for Neem Soap'), '3')

    expect(within(dialog).getByText('-0.75 kg')).toBeTruthy()
    expect(within(dialog).getByText('No change')).toBeTruthy()
    expect(within(dialog).getByText('2 counted · 1 with a difference')).toBeTruthy()

    await user.type(within(dialog).getByLabelText(/Note/), 'Shelf check')
    await user.click(within(dialog).getByRole('button', { name: 'Approve count' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('inventory:reconcile')).toEqual([
        {
          notes: 'Shelf check',
          items: [
            { variantId: RICE.variantId, countedMilli: 11_250 },
            { variantId: SOAP.variantId, countedMilli: 3000 }
          ]
        }
      ])
    )
    expect(await screen.findByText('Stock count ADJ000002 was recorded.')).toBeTruthy()
  })

  it('shows stock movement history with running balances for an item (M14-07)', async () => {
    const user = userEvent.setup()
    serveInventory()
    fakeBackend.on('inventory:movements', () => ({
      variantId: SOAP.variantId,
      name: SOAP.name,
      sku: SOAP.sku,
      unitCode: SOAP.unitCode,
      allowsFraction: false,
      onHandMilli: 3000,
      reorderLevelMilli: 5000,
      total: 2,
      items: [
        {
          movementType: 'sale',
          occurredAt: Date.UTC(2026, 9, 19, 6, 30),
          variantId: SOAP.variantId,
          quantityDeltaMilli: -2000,
          balanceAfterMilli: 3000,
          sourceTable: 'sale_item',
          sourceId: 5,
          documentNumber: 'INV000001',
          reasonCode: null,
          reasonName: null,
          actorName: 'Meena Sundar',
          notes: null
        },
        {
          movementType: 'adjustment',
          occurredAt: Date.UTC(2026, 9, 19, 5, 0),
          variantId: SOAP.variantId,
          quantityDeltaMilli: 5000,
          balanceAfterMilli: 5000,
          sourceTable: 'stock_adjustment_item',
          sourceId: 1,
          documentNumber: 'ADJ000001',
          reasonCode: 'opening_stock',
          reasonName: 'Opening stock',
          actorName: 'Ravi Kumar',
          notes: 'Initial count'
        }
      ]
    }))

    renderApp('/inventory')
    await screen.findByText('Neem Soap')

    await user.click(screen.getByRole('button', { name: 'Movements for Neem Soap' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Neem Soap — Stock movements'
    })

    expect(within(dialog).getByText('INV000001')).toBeTruthy()
    expect(within(dialog).getByText('ADJ000001')).toBeTruthy()
    expect(within(dialog).getByText('Adjustment · Opening stock')).toBeTruthy()
    expect(within(dialog).getByText('Initial count')).toBeTruthy()
  })

  it('hides stock adjustment and count actions from cashiers without stock.adjust', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('cashier') }
    serveInventory()
    renderApp('/inventory')

    expect(await screen.findByText('Sona Masoori Rice')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Adjust stock' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Count stock' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adjust Neem Soap' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Movements for Neem Soap' })).toBeTruthy()
  })
})
