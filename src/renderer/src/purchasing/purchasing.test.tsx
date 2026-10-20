import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import type {
  GoodsReceiptDetail,
  ItemLookup,
  PurchaseOrderDetail,
  SupplierSummary
} from '@shared/ipc/contract'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const SUPPLIER: SupplierSummary = {
  supplierId: 1,
  name: 'Anand Wholesale',
  contactPerson: 'Anand',
  phone: '98400 12345',
  email: null,
  address: 'Koyambedu, Chennai',
  taxRegistrationNumber: '33AAAAA0000A1Z5',
  active: true,
  documentCount: 2
}

const SOAP: ItemLookup = {
  variantId: 11,
  productId: 2,
  name: 'Neem Soap',
  sku: 'SOAP-100',
  unitCode: 'pcs',
  allowsFraction: false,
  sellingPriceMinor: 4500,
  mrpMinor: 5000,
  taxClassId: 2,
  tracksInventory: true,
  onHandMilli: 3000
}

const ORDER: PurchaseOrderDetail = {
  purchaseOrderId: 5,
  orderNumber: 'PO000005',
  status: 'confirmed',
  supplierId: 1,
  supplierName: 'Anand Wholesale',
  notes: null,
  createdByName: 'Ravi Kumar',
  createdAt: Date.UTC(2026, 9, 18, 5, 0),
  updatedAt: Date.UTC(2026, 9, 18, 5, 0),
  confirmedAt: Date.UTC(2026, 9, 18, 5, 1),
  closedAt: null,
  cancelledAt: null,
  totalMinor: 76_800,
  lines: [
    {
      lineNumber: 1,
      variantId: SOAP.variantId,
      name: SOAP.name,
      sku: SOAP.sku,
      unitCode: 'pcs',
      allowsFraction: false,
      quantityMilli: 24_000,
      unitCostMinor: 3200,
      totalMinor: 76_800,
      receivedMilli: 10_000,
      outstandingMilli: 14_000
    }
  ],
  receipts: []
}

function serveSuppliers(): void {
  fakeBackend.on('suppliers:list', () => ({ items: [SUPPLIER], total: 1 }))
}

describe('Suppliers screen (M15-01)', () => {
  it('lists suppliers and adds one, keeping empty details empty', async () => {
    const user = userEvent.setup()
    serveSuppliers()
    fakeBackend.on('suppliers:create', (input) => ({
      ...SUPPLIER,
      supplierId: 2,
      ...input,
      documentCount: 0,
      active: true
    }))
    renderApp('/suppliers')

    expect(await screen.findByText('Anand Wholesale')).toBeTruthy()
    expect(screen.getByText('33AAAAA0000A1Z5')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Add supplier' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add supplier' })

    // The name is required.
    await user.click(within(dialog).getByRole('button', { name: 'Add supplier' }))
    expect(await within(dialog).findAllByText('Enter the supplier name')).not.toHaveLength(0)
    expect(fakeBackend.callsTo('suppliers:create')).toHaveLength(0)

    await user.type(within(dialog).getByLabelText(/Supplier name/), 'Balaji Traders')
    await user.type(within(dialog).getByLabelText('Phone'), '044 2345 6789')
    await user.click(within(dialog).getByRole('button', { name: 'Add supplier' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('suppliers:create')).toEqual([
        {
          name: 'Balaji Traders',
          contactPerson: null,
          phone: '044 2345 6789',
          email: null,
          address: null,
          taxRegistrationNumber: null
        }
      ])
    )
    expect(await screen.findByText('Balaji Traders was added.')).toBeTruthy()
  })

  it('asks before archiving, then archives', async () => {
    const user = userEvent.setup()
    serveSuppliers()
    fakeBackend.on('suppliers:set-active', ({ supplierId, active }) => ({
      ...SUPPLIER,
      supplierId,
      active
    }))
    renderApp('/suppliers')
    await screen.findByText('Anand Wholesale')

    await user.click(screen.getByRole('button', { name: 'Archive Anand Wholesale' }))
    const confirm = await screen.findByRole('dialog', { name: 'Archive Anand Wholesale?' })
    await user.click(within(confirm).getByRole('button', { name: 'Archive supplier' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('suppliers:set-active')).toEqual([
        { supplierId: 1, active: false }
      ])
    )
  })

  it('is read-only for someone who can view but not manage suppliers', async () => {
    serveSuppliers()
    fakeBackend.authState = {
      status: 'signed-in',
      user: userWithRole('inventory_operator', {
        permissions: ['supplier.view']
      })
    }
    renderApp('/suppliers')
    await screen.findByText('Anand Wholesale')
    expect(screen.queryByRole('button', { name: 'Add supplier' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit Anand/ })).toBeNull()
  })
})

describe('Purchases screen (M15-02 to M15-06)', () => {
  function servePurchases(): void {
    serveSuppliers()
    fakeBackend.on('purchases:list-orders', () => ({
      items: [
        {
          purchaseOrderId: ORDER.purchaseOrderId,
          orderNumber: ORDER.orderNumber,
          status: 'confirmed',
          supplierId: 1,
          supplierName: 'Anand Wholesale',
          createdAt: ORDER.createdAt,
          lineCount: 1,
          totalMinor: ORDER.totalMinor
        }
      ],
      total: 1
    }))
    fakeBackend.on('purchases:list-receipts', () => ({ items: [], total: 0 }))
    fakeBackend.on('purchases:get-order', () => ORDER)
    fakeBackend.on('products:search', () => [SOAP])
  }

  it('lists orders with their status and opens one to show what is still to come', async () => {
    const user = userEvent.setup()
    servePurchases()
    renderApp('/purchases')

    expect(await screen.findByText('PO000005')).toBeTruthy()
    expect(within(screen.getByRole('table')).getByText('Confirmed')).toBeTruthy()

    await user.click(screen.getByText('PO000005'))
    const dialog = await screen.findByRole('dialog', { name: 'Order PO000005' })
    expect(await within(dialog).findByText('Still to come')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Receive goods' })).toBeTruthy()
    // Goods have arrived, so the order can only be closed, not cancelled.
    expect(within(dialog).queryByRole('button', { name: 'Cancel order' })).toBeNull()
  })

  it('writes an order in minor units and thousandths, and confirms it', async () => {
    const user = userEvent.setup()
    servePurchases()
    fakeBackend.on('purchases:save-order', () => ORDER)
    renderApp('/purchases')
    await screen.findByText('PO000005')

    await user.click(screen.getByRole('button', { name: 'New purchase order' }))
    const dialog = await screen.findByRole('dialog', { name: 'New purchase order' })

    // Nothing is saved until the form is complete.
    await user.click(within(dialog).getByRole('button', { name: 'Save and confirm' }))
    expect(await within(dialog).findByText('Choose a supplier')).toBeTruthy()
    expect(fakeBackend.callsTo('purchases:save-order')).toHaveLength(0)

    await user.selectOptions(await within(dialog).findByLabelText(/Supplier/), '1')
    await user.type(within(dialog).getByLabelText(/Add an item/), 'soap')
    await user.click(await within(dialog).findByRole('button', { name: /Neem Soap/ }))

    await user.click(within(dialog).getByRole('button', { name: 'Save and confirm' }))
    expect(await within(dialog).findByText('Enter a quantity')).toBeTruthy()

    await user.type(within(dialog).getByLabelText('Quantity (pcs)'), '24')
    await user.type(within(dialog).getByLabelText('Cost per pcs'), '32.5')
    expect(within(dialog).getAllByText('₹780.00')).toHaveLength(2)
    await user.click(within(dialog).getByRole('button', { name: 'Save and confirm' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('purchases:save-order')).toEqual([
        {
          supplierId: 1,
          notes: null,
          lines: [{ variantId: SOAP.variantId, quantityMilli: 24_000, unitCostMinor: 3250 }],
          confirm: true
        }
      ])
    )
  })

  it('receives goods against an order, prefilled with what is outstanding', async () => {
    const user = userEvent.setup()
    servePurchases()
    const saved: GoodsReceiptDetail = {
      goodsReceiptId: 9,
      receiptNumber: 'GRN000009',
      status: 'posted',
      supplierId: 1,
      supplierName: 'Anand Wholesale',
      purchaseOrderId: ORDER.purchaseOrderId,
      orderNumber: ORDER.orderNumber,
      supplierInvoiceNumber: 'AW-1042',
      supplierInvoiceDate: null,
      createdByName: 'Ravi Kumar',
      createdAt: Date.UTC(2026, 9, 19, 5, 0),
      postedAt: Date.UTC(2026, 9, 19, 5, 0),
      postedByName: 'Ravi Kumar',
      totalMinor: 44_800,
      lines: []
    }
    fakeBackend.on('purchases:save-receipt', () => saved)
    fakeBackend.on('purchases:get-receipt', () => saved)
    renderApp('/purchases')

    await user.click(await screen.findByText('PO000005'))
    const detail = await screen.findByRole('dialog', { name: 'Order PO000005' })
    await user.click(await within(detail).findByRole('button', { name: 'Receive goods' }))

    const dialog = await screen.findByRole('dialog', { name: 'Receive goods for PO000005' })
    expect(within(dialog).getByLabelText('Quantity (pcs)')).toHaveProperty('value', '14')
    expect(within(dialog).getByLabelText('Cost per pcs')).toHaveProperty('value', '32.00')

    await user.type(within(dialog).getByLabelText(/Supplier bill number/), 'AW-1042')
    await user.click(within(dialog).getByRole('button', { name: 'Post and add to stock' }))

    // Posting asks first, because a posted receipt cannot be edited.
    const confirm = await screen.findByRole('dialog', { name: 'Add these goods to stock?' })
    expect(fakeBackend.callsTo('purchases:save-receipt')).toHaveLength(0)
    await user.click(within(confirm).getByRole('button', { name: 'Add to stock' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('purchases:save-receipt')).toEqual([
        {
          supplierId: 1,
          purchaseOrderId: 5,
          supplierInvoiceNumber: 'AW-1042',
          supplierInvoiceDate: null,
          lines: [{ variantId: SOAP.variantId, quantityMilli: 14_000, unitCostMinor: 3200 }],
          post: true,
          updateCosts: false
        }
      ])
    )
    expect(await screen.findByText(/GRN000009 was posted/)).toBeTruthy()
  })

  it('hides ordering and receiving from someone who can only view purchases', async () => {
    servePurchases()
    fakeBackend.authState = {
      status: 'signed-in',
      user: userWithRole('inventory_operator', { permissions: ['purchase.view'] })
    }
    renderApp('/purchases')
    await screen.findByText('PO000005')
    expect(screen.queryByRole('button', { name: 'New purchase order' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Receive without order' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cost history' })).toBeTruthy()
  })
})

describe('purchasing accessibility', () => {
  async function violations(): Promise<string[]> {
    const results = await axe.run(document.body, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
      },
      rules: { 'color-contrast': { enabled: false } }
    })
    return results.violations.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`
    )
  }

  it('the suppliers and purchases screens, and the order form, have no axe violations', async () => {
    const user = userEvent.setup()
    serveSuppliers()
    fakeBackend.on('purchases:list-orders', () => ({ items: [], total: 0 }))
    fakeBackend.on('purchases:list-receipts', () => ({ items: [], total: 0 }))
    fakeBackend.on('products:search', () => [SOAP])

    const suppliers = renderApp('/suppliers')
    await screen.findByText('Anand Wholesale')
    expect(await violations()).toEqual([])
    suppliers.unmount()

    renderApp('/purchases')
    await screen.findByText('No purchase orders yet')
    expect(await violations()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'New purchase order' }))
    const dialog = await screen.findByRole('dialog', { name: 'New purchase order' })
    await user.type(await within(dialog).findByLabelText(/Add an item/), 'soap')
    await user.click(await within(dialog).findByRole('button', { name: /Neem Soap/ }))
    await within(dialog).findByLabelText('Quantity (pcs)')
    expect(await violations()).toEqual([])
  })
})
