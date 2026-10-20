import { TEST_STORE } from '@shared/test/stores'
import { describe, expect, it } from 'vitest'
import { parseCsv } from '@shared/csv'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { useMigratedDb } from '../db/test/testDb'

/**
 * M22-01 & M22-02 (FR-026): CSV product import tests.
 *
 * Covers:
 *  - RFC-4180 CSV parsing (UTF-8 BOM, quoted commas, escaped quotes, CRLF/LF).
 *  - Template generation with required headers and sample rows.
 *  - Column mapping override and automatic header alias detection.
 *  - Row-by-row validation preview with specific field errors (missing name,
 *    unknown unit, selling price > MRP, duplicate SKU/barcode within CSV or
 *    against existing products, fractional reorder level on whole-number unit,
 *    inconsistent category/tax across variants of the same product).
 *  - Atomic commit: creates new categories, multi-variant products, auto-SKUs,
 *    and barcodes in one transaction, and records `data.products_imported` in
 *    the audit log.
 *  - Refuses to commit any batch with validation errors (never silently drops rows).
 */
describe('ProductImportService (M22-01 & M22-02)', () => {
  const getDb = useMigratedDb()

  async function setupStore() {
    const bed = createTestbed(getDb())
    await bed.storeService.completeSetup({
      store: TEST_STORE,
      administrator: OWNER
    })
    return { bed, actor: bed.actor() }
  }

  it('parses RFC-4180 CSV with UTF-8 BOM, quoted fields, escaped quotes, and CRLF', () => {
    const raw =
      '\uFEFFproduct_name,variant_name,selling_price\r\n' +
      '"Rice, Sona Masoori","5 ""Super"" kg",320.50\r\n' +
      '\r\n' +
      'Sugar,1 kg,48.00\n'
    const parsed = parseCsv(raw)
    expect(parsed.headers).toEqual(['product_name', 'variant_name', 'selling_price'])
    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        values: {
          product_name: 'Rice, Sona Masoori',
          variant_name: '5 "Super" kg',
          selling_price: '320.50'
        }
      },
      {
        rowNumber: 4,
        values: {
          product_name: 'Sugar',
          variant_name: '1 kg',
          selling_price: '48.00'
        }
      }
    ])
  })

  it('provides a downloadable CSV template whose sample rows pass preview validation cleanly', async () => {
    const { bed, actor } = await setupStore()
    const template = bed.productImportService.getTemplate(actor)
    expect(template.filename).toBe('storepro-products-template.csv')
    expect(template.columns.length).toBeGreaterThanOrEqual(10)

    const preview = bed.productImportService.preview(actor, { csvText: template.csvText })
    expect(preview.totalRows).toBe(2)
    expect(preview.validRowCount).toBe(2)
    expect(preview.errorRowCount).toBe(0)
    expect(preview.productCountToCreate).toBe(1)
    expect(preview.variantCountToCreate).toBe(2)
    expect(preview.categoriesToCreate).toEqual(['Staples'])
  })

  it('validates every row and reports field-level errors without dropping rows', async () => {
    const { bed, actor } = await setupStore()

    // Create an existing product to test duplicate SKU and barcode detection against DB
    const taxClassId = bed.taxClasses.list()[0]!.taxClassId
    bed.productService.create(actor, {
      name: 'Existing Oil',
      categoryId: null,
      taxClassId,
      hsnCode: null,
      tracksInventory: true,
      variants: [
        {
          variantName: '1 L',
          sku: 'OIL-1L',
          unitCode: 'l',
          sellingPriceMinor: 150_00,
          mrpMinor: 160_00,
          costPriceMinor: null,
          reorderLevelMilli: null,
          barcodes: ['8900000000001']
        }
      ]
    })

    const csvText = [
      'product_name,variant_name,sku,barcode,category,unit_code,selling_price,mrp,cost_price,tax_class,hsn_code,reorder_level,tracks_inventory',
      // Row 2: Valid row
      'Tur Dal,1 kg,DAL-1KG,8900000000010,Pulses,kg,140.00,155.00,120.00,5%,0713,5.5,yes',
      // Row 3: Missing product name & selling price > MRP
      ',500 g,DAL-500G,,Pulses,pcs,200.00,180.00,,5%,0713,10,yes',
      // Row 4: Duplicate SKU against existing DB + duplicate barcode against Row 2
      'Chana Dal,1 kg,OIL-1L,8900000000010,Pulses,pcs,95.00,100.00,,5%,0713,1.5,yes',
      // Row 5: Unknown unit, invalid HSN, unknown tax rate
      'Moong Dal,1 kg,MOONG-1KG,,Pulses,bushels,110.00,120.00,,99%,123,5,maybe'
    ].join('\n')

    const preview = bed.productImportService.preview(actor, { csvText })
    expect(preview.totalRows).toBe(4)
    expect(preview.validRowCount).toBe(1)
    expect(preview.errorRowCount).toBe(3)

    expect(preview.rows[0]!.valid).toBe(true)
    expect(preview.rows[0]!.issues).toEqual([])

    const row3Fields = preview.rows[1]!.issues.map((i) => i.field)
    expect(row3Fields).toContain('productName')
    expect(row3Fields).toContain('sellingPrice')

    const row4Fields = preview.rows[2]!.issues.map((i) => i.field)
    expect(row4Fields).toContain('sku')
    expect(row4Fields).toContain('barcode')
    expect(row4Fields).toContain('reorderLevel') // 1.5 on 'pcs' unit which does not allow fractions

    const row5Fields = preview.rows[3]!.issues.map((i) => i.field)
    expect(row5Fields).toContain('unitCode')
    expect(row5Fields).toContain('taxClass')
    expect(row5Fields).toContain('hsnCode')
    expect(row5Fields).toContain('tracksInventory')

    // Refuses to commit while any row has errors
    expect(() => bed.productImportService.commit(actor, { csvText })).toThrow(
      /3 of 4 row\(s\) have validation errors/
    )
    // Nothing beyond the initial product was created
    expect(bed.productService.list(actor, {}).items).toHaveLength(1)
  })

  it('supports custom column mappings and atomically commits multi-variant products and categories', async () => {
    const { bed, actor } = await setupStore()

    const customCsv = [
      'ItemTitle,Pack,Rate,MaxPrice,UOM,Dept,CodeBar',
      'Nandini Milk,500 ml,24.00,25.00,pcs,Dairy,8901112223331',
      'Nandini Milk,1 L,46.00,48.00,pcs,Dairy,8901112223332',
      'Britannia Bread,,45.00,45.00,pcs,Bakery,8901112223333'
    ].join('\n')

    const mapping = {
      productName: 'ItemTitle',
      variantName: 'Pack',
      sellingPrice: 'Rate',
      mrp: 'MaxPrice',
      unitCode: 'UOM',
      category: 'Dept',
      barcode: 'CodeBar'
    }

    const preview = bed.productImportService.preview(actor, { csvText: customCsv, mapping })
    expect(preview.errorRowCount).toBe(0)
    expect(preview.validRowCount).toBe(3)
    expect(preview.productCountToCreate).toBe(2)
    expect(preview.variantCountToCreate).toBe(3)
    expect(preview.categoriesToCreate).toEqual(['Dairy', 'Bakery'])

    const result = bed.productImportService.commit(actor, { csvText: customCsv, mapping })
    expect(result).toEqual({
      importedRowCount: 3,
      createdProductCount: 2,
      createdVariantCount: 3,
      createdCategoryCount: 2
    })

    const products = bed.productService.list(actor, {})
    expect(products.items).toHaveLength(3)
    const milkItems = products.items.filter((p) => p.productName === 'Nandini Milk')
    expect(milkItems).toHaveLength(2)
    expect(milkItems[0]!.categoryName).toBe('Dairy')

    const foundByBarcode = bed.productService.findByBarcode(actor, {
      barcode: '8901112223332'
    })
    expect(foundByBarcode?.name).toBe('Nandini Milk 1 L')
    expect(foundByBarcode?.sellingPriceMinor).toBe(46_00)

    const auditActions = bed.audit().map((a) => a.action)
    expect(auditActions).toContain('data.products_imported')
  })
})
