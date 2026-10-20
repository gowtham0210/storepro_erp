import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ProductImportPreview } from '@shared/ipc/contract'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const PREVIEW_WITH_ERRORS: ProductImportPreview = {
  totalRows: 2,
  validRowCount: 1,
  errorRowCount: 1,
  productCountToCreate: 1,
  variantCountToCreate: 1,
  categoriesToCreate: ['Staples'],
  detectedHeaders: ['product_name', 'unit_code', 'selling_price'],
  resolvedMapping: {
    productName: 'product_name',
    variantName: 'variant_name',
    sku: 'sku',
    barcode: 'barcode',
    category: 'category',
    unitCode: 'unit_code',
    sellingPrice: 'selling_price',
    mrp: 'mrp',
    costPrice: 'cost_price',
    taxClass: 'tax_class',
    hsnCode: 'hsn_code',
    reorderLevel: 'reorder_level',
    tracksInventory: 'tracks_inventory'
  },
  rows: [
    {
      rowNumber: 2,
      valid: true,
      productName: 'Sona Masoori Rice',
      variantName: '5 kg',
      sku: 'RICE-5KG',
      barcodes: ['8901000000011'],
      categoryName: 'Staples',
      willCreateCategory: true,
      unitCode: 'pcs',
      sellingPriceMinor: 320_00,
      mrpMinor: 350_00,
      costPriceMinor: null,
      taxClassName: 'GST 5%',
      hsnCode: '1006',
      reorderLevelMilli: null,
      tracksInventory: true,
      issues: []
    },
    {
      rowNumber: 3,
      valid: false,
      productName: 'Broken Item',
      variantName: null,
      sku: null,
      barcodes: [],
      categoryName: null,
      willCreateCategory: false,
      unitCode: 'unknown_unit',
      sellingPriceMinor: null,
      mrpMinor: null,
      costPriceMinor: null,
      taxClassName: null,
      hsnCode: null,
      reorderLevelMilli: null,
      tracksInventory: true,
      issues: [
        { field: 'unitCode', message: 'Unknown unit "unknown_unit"' },
        { field: 'sellingPrice', message: 'Enter the selling price' }
      ]
    }
  ]
}

const VALID_PREVIEW: ProductImportPreview = {
  ...PREVIEW_WITH_ERRORS,
  totalRows: 1,
  validRowCount: 1,
  errorRowCount: 0,
  rows: [PREVIEW_WITH_ERRORS.rows[0]!]
}

describe('ProductImportDialog (M22-01 & M22-02)', () => {
  it('shows row-by-row validation errors, disables import until all rows are valid, and commits valid batches', async () => {
    const user = userEvent.setup()
    let previewResult = PREVIEW_WITH_ERRORS
    fakeBackend.on('import:products-preview', () => previewResult)
    fakeBackend.on('import:products-commit', () => ({
      importedRowCount: 1,
      createdProductCount: 1,
      createdVariantCount: 1,
      createdCategoryCount: 1
    }))

    renderApp('/products')
    await user.click(await screen.findByRole('button', { name: 'Import CSV' }))
    const dialog = await screen.findByRole('dialog', { name: 'Import products from CSV' })

    const csvInput = within(dialog).getByLabelText(/^CSV content/)
    await user.type(csvInput, 'product_name,unit_code,selling_price\nRice,pcs,320')
    await user.click(within(dialog).getByRole('button', { name: 'Validate & preview' }))

    expect(
      await within(dialog).findByText(/1 of 2 row\(s\) have validation errors/)
    ).toBeTruthy()
    expect(within(dialog).getByText(/Unknown unit "unknown_unit"/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /Import 1 product/ }).matches(':disabled')).toBe(
      true
    )

    // Fix CSV and re-validate
    previewResult = VALID_PREVIEW
    await user.click(within(dialog).getByRole('button', { name: 'Validate & preview' }))
    expect(await within(dialog).findByText('All rows validated')).toBeTruthy()

    const importBtn = within(dialog).getByRole('button', { name: 'Import 1 product(s)' })
    expect(importBtn.matches(':disabled')).toBe(false)
    await user.click(importBtn)

    await waitFor(() => expect(fakeBackend.callsTo('import:products-commit')).toHaveLength(1))
  })

  it('hides Import CSV for roles without data.import permission', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('manager') }
    renderApp('/products')
    await screen.findByRole('button', { name: 'Add product' })
    expect(screen.queryByRole('button', { name: 'Import CSV' })).toBeNull()
  })
})
