import { describe, expect, it } from 'vitest'
import { TEST_STORE } from '@shared/test/stores'
import { insertSale, insertUser } from '../db/dev/builders'
import { useMigratedDb } from '../db/test/testDb'
import { rejection, setUpStore, taxClassId, variant } from '../test/store'

describe('tax classes for a new store', () => {
  const getDb = useMigratedDb()

  it('gives an Indian store the GST slabs, provisionally', async () => {
    const bed = await setUpStore(getDb())
    expect(bed.taxClasses.list().map((t) => [t.name, t.rateBp, t.cessRateBp])).toEqual([
      ['GST 0% (exempt)', 0, 0],
      ['GST 5%', 500, 0],
      ['GST 18%', 1800, 0],
      ['GST 40%', 4000, 0]
    ])
  })

  it('gives any other store one class without tax', async () => {
    const bed = await setUpStore(getDb(), {
      ...TEST_STORE,
      countryCode: 'AE',
      regionCode: null,
      postalCode: null,
      taxRegistrationNumber: null,
      currencyCode: 'AED',
      timeZone: 'Asia/Dubai'
    })
    expect(bed.taxClasses.list().map((t) => t.name)).toEqual(['No tax'])
  })
})

describe('products (M09-02)', () => {
  const getDb = useMigratedDb()

  async function store() {
    const bed = await setUpStore(getDb())
    const gst5 = taxClassId(bed, 'GST 5%')
    const staples = bed.catalogService.createCategory(bed.actor(), { name: 'Staples' })
    return { bed, gst5, staples: staples.categoryId }
  }

  it('creates a product with its pack sizes and barcodes, and reads it back', async () => {
    const { bed, gst5, staples } = await store()
    const created = bed.productService.create(bed.actor(), {
      name: 'Toor Dal',
      categoryId: staples,
      taxClassId: gst5,
      hsnCode: '0713',
      tracksInventory: true,
      variants: [
        variant({
          variantName: '500 g',
          sellingPriceMinor: 8500,
          mrpMinor: 9000,
          barcodes: ['8901000000011']
        }),
        variant({
          variantName: '1 kg',
          sellingPriceMinor: 16000,
          mrpMinor: 17000,
          barcodes: ['8901000000028', '2000000000017']
        })
      ]
    })
    expect(created).toMatchObject({
      name: 'Toor Dal',
      categoryId: staples,
      hsnCode: '0713',
      active: true,
      variants: [
        {
          variantName: '500 g',
          sku: 'ITEM-00001',
          barcodes: ['8901000000011'],
          onHandMilli: 0,
          hasHistory: false
        },
        {
          variantName: '1 kg',
          sku: 'ITEM-00002',
          barcodes: ['8901000000028', '2000000000017'].sort()
        }
      ]
    })
    expect(bed.productService.get(bed.actor(), { productId: created.productId })).toEqual(created)
    expect(bed.audit().at(-1)).toMatchObject({
      action: 'product.created',
      entity_id: created.productId
    })
    expect(JSON.parse(bed.audit().at(-1)?.details ?? '{}')).toEqual({
      name: 'Toor Dal',
      items: ['Toor Dal 500 g at ₹85.00', 'Toor Dal 1 kg at ₹160.00']
    })
  })

  it('rejects a barcode another item already has (FR-022), naming that item', async () => {
    const { bed, gst5 } = await store()
    bed.productService.create(bed.actor(), {
      name: 'Neem Soap',
      categoryId: null,
      taxClassId: gst5,
      hsnCode: null,
      tracksInventory: true,
      variants: [variant({ barcodes: ['8901234567890'] })]
    })
    const error = await rejection(() =>
      bed.productService.create(bed.actor(), {
        name: 'Rose Soap',
        categoryId: null,
        taxClassId: gst5,
        hsnCode: null,
        tracksInventory: true,
        variants: [variant({ barcodes: ['8901234567890'] })]
      })
    )
    expect(error).toMatchObject({
      code: 'CONFLICT',
      details: [
        {
          path: 'variants.0.barcodes',
          message: 'The barcode 8901234567890 is already used by Neem Soap'
        }
      ]
    })
    // Nothing of the failed product was saved.
    expect(bed.productService.list(bed.actor(), {}).total).toBe(1)
  })

  it('rejects a SKU that is taken, whatever its case, and a second unnamed pack size', async () => {
    const { bed, gst5 } = await store()
    const base = { categoryId: null, taxClassId: gst5, hsnCode: null, tracksInventory: true }
    bed.productService.create(bed.actor(), {
      ...base,
      name: 'Sugar',
      variants: [variant({ sku: 'SUGAR-1' })]
    })
    expect(
      await rejection(() =>
        bed.productService.create(bed.actor(), {
          ...base,
          name: 'Salt',
          variants: [variant({ sku: 'sugar-1' })]
        })
      )
    ).toMatchObject({ code: 'CONFLICT', details: [{ path: 'variants.0.sku' }] })
    expect(
      await rejection(() =>
        bed.productService.create(bed.actor(), {
          ...base,
          name: 'Salt',
          variants: [variant(), variant()]
        })
      )
    ).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'variantName' }] })
  })

  it('checks the low-stock level against the unit and refuses archived references', async () => {
    const { bed, gst5, staples } = await store()
    const base = {
      name: 'Eggs',
      categoryId: null,
      taxClassId: gst5,
      hsnCode: null,
      tracksInventory: true
    }
    expect(
      await rejection(() =>
        bed.productService.create(bed.actor(), {
          ...base,
          variants: [variant({ reorderLevelMilli: 1500 })]
        })
      )
    ).toMatchObject({
      details: [
        { path: 'variants.0.reorderLevelMilli', message: 'Pieces are counted in whole numbers' }
      ]
    })
    bed.catalogService.setCategoryActive(bed.actor(), { categoryId: staples, active: false })
    expect(
      await rejection(() =>
        bed.productService.create(bed.actor(), {
          ...base,
          categoryId: staples,
          variants: [variant()]
        })
      )
    ).toMatchObject({ details: [{ path: 'categoryId' }] })
    // Loose items in kg may have a fractional level.
    expect(
      bed.productService.create(bed.actor(), {
        ...base,
        name: 'Rice',
        variants: [variant({ unitCode: 'kg', reorderLevelMilli: 2500 })]
      }).variants[0]?.reorderLevelMilli
    ).toBe(2500)
  })

  it('audits a price change on its own, with amounts people can read (M09-09)', async () => {
    const { bed, gst5 } = await store()
    const soap = bed.productService.create(bed.actor(), {
      name: 'Neem Soap',
      categoryId: null,
      taxClassId: gst5,
      hsnCode: null,
      tracksInventory: true,
      variants: [variant({ sku: 'SOAP-100' })]
    })
    const [only] = soap.variants
    if (!only) throw new Error('no variant')
    bed.productService.updateVariant(bed.actor(), {
      variantId: only.variantId,
      ...variant({ sku: 'SOAP-100', sellingPriceMinor: 4800, reorderLevelMilli: 10_000 })
    })
    const entries = bed.audit().slice(-2)
    expect(entries.map((e) => e.action)).toEqual(['product.price_changed', 'product.updated'])
    expect(JSON.parse(entries[0]?.details ?? '{}')).toEqual({
      item: 'Neem Soap',
      variantId: only.variantId,
      changes: { sellingPrice: { from: '₹45.00', to: '₹48.00' } }
    })
    expect(JSON.parse(entries[1]?.details ?? '{}')).toMatchObject({
      changes: { reorderLevel: { from: null, to: '10 pcs' } }
    })
    // Saving again without changes records nothing.
    const count = bed.audit().length
    bed.productService.updateVariant(bed.actor(), {
      variantId: only.variantId,
      ...variant({ sku: 'SOAP-100', sellingPriceMinor: 4800, reorderLevelMilli: 10_000 })
    })
    expect(bed.audit().length).toBe(count)
  })

  it('keeps the unit once an item has been sold, and archives instead of deleting (M09-08)', async () => {
    const { bed, gst5 } = await store()
    const soap = bed.productService.create(bed.actor(), {
      name: 'Neem Soap',
      categoryId: null,
      taxClassId: gst5,
      hsnCode: null,
      tracksInventory: false,
      variants: [
        variant({ sku: 'SOAP-100' }),
        variant({ variantName: 'Pack of 3', sku: 'SOAP-300' })
      ]
    })
    const [single, pack] = soap.variants
    if (!single || !pack) throw new Error('no variants')
    insertSale(getDb(), {
      invoiceNumber: 'INV000001',
      cashierId: insertUser(getDb(), 'cashier1'),
      lines: [{ variantId: single.variantId, quantityMilli: 1000, unitPriceMinor: 4500 }],
      payments: [{ methodCode: 'cash', amountMinor: 4500 }]
    })
    expect(
      await rejection(() =>
        bed.productService.updateVariant(bed.actor(), {
          variantId: single.variantId,
          ...variant({ sku: 'SOAP-100', unitCode: 'box' })
        })
      )
    ).toMatchObject({ details: [{ path: 'unitCode' }] })

    bed.productService.setVariantActive(bed.actor(), { variantId: pack.variantId, active: false })
    expect(
      await rejection(() =>
        bed.productService.setVariantActive(bed.actor(), {
          variantId: single.variantId,
          active: false
        })
      )
    ).toMatchObject({ code: 'CONFLICT' })
    const archived = bed.productService.setActive(bed.actor(), {
      productId: soap.productId,
      active: false
    })
    expect(archived.active).toBe(false)
    expect(bed.productService.list(bed.actor(), {}).total).toBe(0)
    expect(bed.productService.list(bed.actor(), { status: 'archived' }).total).toBe(2)
    expect(bed.productService.findByBarcode(bed.actor(), { barcode: 'SOAP-100' })).toBeNull()
    // The sale still refers to it.
    expect(getDb().get('SELECT count(*) AS n FROM sale_items')).toEqual({ n: 1 })
  })

  it('lists items by name with search, category and paging (M09-05)', async () => {
    const { bed, gst5, staples } = await store()
    const make = (name: string, sku: string, categoryId: number | null, barcodes: string[] = []) =>
      bed.productService.create(bed.actor(), {
        name,
        categoryId,
        taxClassId: gst5,
        hsnCode: null,
        tracksInventory: true,
        variants: [variant({ sku, barcodes })]
      })
    make('Basmati Rice', 'RICE-BAS', staples)
    make('Sona Masoori Rice', 'RICE-SONA', staples, ['8901000000035'])
    make('Bathing Soap', 'SOAP-1', null)
    const names = (filter: Parameters<typeof bed.productService.list>[1]) =>
      bed.productService.list(bed.actor(), filter).items.map((item) => item.productName)

    expect(names({})).toEqual(['Basmati Rice', 'Bathing Soap', 'Sona Masoori Rice'])
    expect(names({ search: 'rice' })).toEqual(['Basmati Rice', 'Sona Masoori Rice'])
    expect(names({ search: 'ba' })).toEqual(['Basmati Rice', 'Bathing Soap'])
    expect(names({ search: 'RICE-SONA' })).toEqual(['Sona Masoori Rice'])
    expect(names({ search: '890100' })).toEqual(['Sona Masoori Rice'])
    expect(names({ categoryId: staples })).toEqual(['Basmati Rice', 'Sona Masoori Rice'])
    expect(names({ search: '"*:-' })).toEqual([])
    expect(bed.productService.list(bed.actor(), { limit: 2, offset: 2 })).toMatchObject({
      total: 3,
      items: [{ productName: 'Sona Masoori Rice', barcodes: ['8901000000035'] }]
    })
  })

  it('finds an item by barcode or SKU, and by search, for billing (M09-07)', async () => {
    const { bed, gst5 } = await store()
    bed.productService.create(bed.actor(), {
      name: 'Rice',
      categoryId: null,
      taxClassId: gst5,
      hsnCode: null,
      tracksInventory: true,
      variants: [
        variant({
          variantName: 'loose',
          sku: 'RICE-L',
          unitCode: 'kg',
          sellingPriceMinor: 6000,
          mrpMinor: null,
          barcodes: ['2000000000017']
        })
      ]
    })
    const expected = {
      name: 'Rice loose',
      sku: 'RICE-L',
      unitCode: 'kg',
      allowsFraction: true,
      sellingPriceMinor: 6000,
      taxClassId: gst5,
      onHandMilli: 0
    }
    expect(
      bed.productService.findByBarcode(bed.actor(), { barcode: ' 2000000000017 ' })
    ).toMatchObject(expected)
    expect(bed.productService.findByBarcode(bed.actor(), { barcode: 'rice-l' })).toMatchObject(
      expected
    )
    expect(bed.productService.findByBarcode(bed.actor(), { barcode: '999' })).toBeNull()
    expect(bed.productService.search(bed.actor(), { query: 'ric lo' })).toMatchObject([expected])
  })

  it('lets cashiers look products up but not change them', async () => {
    const { bed, gst5 } = await store()
    await bed.signInAs('cashier')
    expect(bed.productService.list(bed.actor(), {}).total).toBe(0)
    expect(
      await rejection(() =>
        bed.productService.create(bed.actor(), {
          name: 'X',
          categoryId: null,
          taxClassId: gst5,
          hsnCode: null,
          tracksInventory: true,
          variants: [variant()]
        })
      )
    ).toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('categories and units (M09-01)', () => {
  const getDb = useMigratedDb()

  it('creates, renames and archives categories, refusing duplicate names', async () => {
    const bed = await setUpStore(getDb())
    const snacks = bed.catalogService.createCategory(bed.actor(), { name: 'Snacks' })
    expect(
      await rejection(() => bed.catalogService.createCategory(bed.actor(), { name: 'snacks' }))
    ).toMatchObject({ code: 'CONFLICT', details: [{ path: 'name' }] })
    bed.catalogService.renameCategory(bed.actor(), {
      categoryId: snacks.categoryId,
      name: 'Namkeen'
    })
    bed.catalogService.setCategoryActive(bed.actor(), {
      categoryId: snacks.categoryId,
      active: false
    })
    expect(bed.catalogService.listCategories(bed.actor())).toEqual([
      { categoryId: snacks.categoryId, name: 'Namkeen', active: false, productCount: 0 }
    ])
    expect(
      bed
        .audit()
        .slice(-3)
        .map((a) => a.action)
    ).toEqual(['category.created', 'category.updated', 'category.archived'])
  })

  it('adds units with their fraction rule and renames them', async () => {
    const bed = await setUpStore(getDb())
    const tray = bed.catalogService.createUnit(bed.actor(), {
      unitCode: 'tray',
      name: 'Trays',
      allowsFraction: false
    })
    expect(tray).toEqual({ unitCode: 'tray', name: 'Trays', allowsFraction: false, inUse: false })
    expect(
      await rejection(() =>
        bed.catalogService.createUnit(bed.actor(), {
          unitCode: 'kg',
          name: 'Kilos',
          allowsFraction: true
        })
      )
    ).toMatchObject({ details: [{ path: 'unitCode' }] })
    expect(
      bed.catalogService.renameUnit(bed.actor(), { unitCode: 'tray', name: 'Egg trays' }).name
    ).toBe('Egg trays')
    expect(bed.catalogService.listUnits(bed.actor()).map((u) => u.unitCode)).toContain('tray')
  })
})
