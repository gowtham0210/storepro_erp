import { TEST_STORE } from '@shared/test/stores'
import { beforeEach, describe, expect, it } from 'vitest'
import { OWNER, type Testbed } from '../auth/test/testbed'
import {
  insertGoodsReceipt,
  insertReturn,
  insertSale,
  insertSupplier,
  insertVoid
} from '../db/dev/builders'
import { checkIntegrity } from '../db/integrity'
import { useMigratedDb } from '../db/test/testDb'
import { setUpStore } from '../test/store'

describe('InventoryService (M14)', () => {
  const getDb = useMigratedDb()
  let bed: Testbed
  let riceId: number
  let soapId: number
  let bagId: number

  beforeEach(async () => {
    bed = await setUpStore(getDb())
    const actor = bed.actor()
    const gst5 =
      bed.catalogService.listTaxClasses(actor).find((t) => t.rateBp === 500)?.taxClassId ?? 1
    const staples = bed.catalogService.createCategory(actor, { name: 'Staples' }).categoryId

    const rice = bed.productService.create(actor, {
      name: 'Sona Masoori Rice',
      categoryId: staples,
      taxClassId: gst5,
      hsnCode: '1006',
      tracksInventory: true,
      variants: [
        {
          variantName: '1 kg',
          sku: 'RICE-1KG',
          unitCode: 'kg',
          sellingPriceMinor: 6000,
          mrpMinor: 6500,
          costPriceMinor: 4800,
          reorderLevelMilli: 5000,
          barcodes: ['8901000000011']
        }
      ]
    })
    riceId = rice.variants[0]!.variantId

    const soap = bed.productService.create(actor, {
      name: 'Neem Soap',
      categoryId: null,
      taxClassId: gst5,
      hsnCode: null,
      tracksInventory: true,
      variants: [
        {
          variantName: null,
          sku: 'SOAP-100',
          unitCode: 'pcs',
          sellingPriceMinor: 4500,
          mrpMinor: 5000,
          costPriceMinor: 3200,
          reorderLevelMilli: 10_000,
          barcodes: []
        }
      ]
    })
    soapId = soap.variants[0]!.variantId

    const bag = bed.productService.create(actor, {
      name: 'Cloth Carry Bag',
      categoryId: null,
      taxClassId: gst5,
      hsnCode: null,
      tracksInventory: false,
      variants: [
        {
          variantName: null,
          sku: 'BAG-CLOTH',
          unitCode: 'pcs',
          sellingPriceMinor: 1000,
          mrpMinor: null,
          costPriceMinor: null,
          reorderLevelMilli: null,
          barcodes: []
        }
      ]
    })
    bagId = bag.variants[0]!.variantId
  })

  it('lists seeded stock adjustment reasons in logical order', () => {
    const reasons = bed.inventoryService.listReasons(bed.actor())
    expect(reasons.map((r) => r.adjustmentReasonCode)).toEqual([
      'opening_stock',
      'count_correction',
      'damage',
      'expiry',
      'theft_loss',
      'other'
    ])
  })

  it('records stock adjustments with sequential numbers and audits them atomically (M14-04)', () => {
    const actor = bed.actor()
    const first = bed.inventoryService.adjust(actor, {
      reasonCode: 'opening_stock',
      notes: 'Initial shelf count',
      items: [
        { variantId: riceId, quantityDeltaMilli: 25_500 },
        { variantId: soapId, quantityDeltaMilli: 20_000 }
      ]
    })

    expect(first).toMatchObject({
      adjustmentNumber: 'ADJ000001',
      reasonCode: 'opening_stock',
      reasonName: 'Opening stock',
      adjustedByName: OWNER.displayName,
      notes: 'Initial shelf count',
      items: [
        {
          variantId: riceId,
          name: 'Sona Masoori Rice 1 kg',
          sku: 'RICE-1KG',
          unitCode: 'kg',
          quantityDeltaMilli: 25_500,
          onHandAfterMilli: 25_500
        },
        {
          variantId: soapId,
          name: 'Neem Soap',
          sku: 'SOAP-100',
          unitCode: 'pcs',
          quantityDeltaMilli: 20_000,
          onHandAfterMilli: 20_000
        }
      ]
    })

    const second = bed.inventoryService.adjust(actor, {
      reasonCode: 'damage',
      notes: 'Torn packet',
      items: [{ variantId: soapId, quantityDeltaMilli: -2000 }]
    })
    expect(second.adjustmentNumber).toBe('ADJ000002')
    expect(second.items[0]?.onHandAfterMilli).toBe(18_000)

    const auditEntry = bed.audit().findLast((e) => e.action === 'stock.adjusted')
    expect(auditEntry).toBeDefined()
    expect(JSON.parse(auditEntry!.details ?? '{}')).toEqual({
      adjustmentNumber: 'ADJ000002',
      reason: 'Damaged',
      notes: 'Torn packet',
      items: [{ item: 'Neem Soap', change: '-2 pcs', onHandAfter: '18 pcs' }]
    })
  })

  it('enforces unit fraction rules and rejects untracked or archived items (M14-04)', () => {
    const actor = bed.actor()
    expect(() =>
      bed.inventoryService.adjust(actor, {
        reasonCode: 'opening_stock',
        notes: null,
        items: [{ variantId: soapId, quantityDeltaMilli: 1500 }]
      })
    ).toThrow(/whole numbers/)

    expect(() =>
      bed.inventoryService.adjust(actor, {
        reasonCode: 'opening_stock',
        notes: null,
        items: [{ variantId: bagId, quantityDeltaMilli: 5000 }]
      })
    ).toThrow(/Stock is not tracked/)
  })

  it('blocks negative stock by default and allows it when enabled in store settings (M14-03)', () => {
    const actor = bed.actor()
    bed.inventoryService.adjust(actor, {
      reasonCode: 'opening_stock',
      notes: null,
      items: [{ variantId: soapId, quantityDeltaMilli: 3000 }]
    })

    expect(() =>
      bed.inventoryService.adjust(actor, {
        reasonCode: 'damage',
        notes: null,
        items: [{ variantId: soapId, quantityDeltaMilli: -5000 }]
      })
    ).toThrow(/Not enough Neem Soap in stock \(3 pcs on hand, 5 pcs needed\)/)

    // Duplicate lines in a checkout call are summed before checking stock.
    expect(() =>
      bed.inventoryService.assertOutflowAllowed([
        { variantId: soapId, quantityMilli: 2000 },
        { variantId: soapId, quantityMilli: 2000 }
      ])
    ).toThrow(/Not enough Neem Soap in stock \(3 pcs on hand, 4 pcs needed\)/)

    // Turning on allowNegativeStock permits the reduction.
    bed.storeService.update(actor, { ...TEST_STORE, allowNegativeStock: true })
    const adjusted = bed.inventoryService.adjust(actor, {
      reasonCode: 'theft_loss',
      notes: 'Shortage allowed',
      items: [{ variantId: soapId, quantityDeltaMilli: -5000 }]
    })
    expect(adjusted.items[0]?.onHandAfterMilli).toBe(-2000)
  })

  it('maintains stock on hand and filters low-stock and out-of-stock items (M14-02, M14-05)', () => {
    const actor = bed.actor()
    // Initially both rice (0 <= 5 kg) and soap (0 <= 10 pcs) are out of stock and low stock.
    const initial = bed.inventoryService.list(actor, {})
    expect(initial.total).toBe(2) // bag is excluded because tracksInventory = false
    expect(initial.lowStockCount).toBe(2)
    expect(initial.outOfStockCount).toBe(2)

    // Stock rice above reorder level (12 kg > 5 kg), soap at reorder level (10 pcs <= 10 pcs).
    bed.inventoryService.adjust(actor, {
      reasonCode: 'opening_stock',
      notes: null,
      items: [
        { variantId: riceId, quantityDeltaMilli: 12_000 },
        { variantId: soapId, quantityDeltaMilli: 10_000 }
      ]
    })

    const all = bed.inventoryService.list(actor, { level: 'all' })
    expect(all.lowStockCount).toBe(1)
    expect(all.outOfStockCount).toBe(0)

    const lowOnly = bed.inventoryService.list(actor, { level: 'low' })
    expect(lowOnly.items.map((i) => i.name)).toEqual(['Neem Soap'])
    expect(lowOnly.items[0]?.isLowStock).toBe(true)

    const outOnly = bed.inventoryService.list(actor, { level: 'out' })
    expect(outOnly.items).toEqual([])
  })

  it('reconciles physical stock counts into count_correction adjustments (M14-06)', () => {
    const actor = bed.actor()
    bed.inventoryService.adjust(actor, {
      reasonCode: 'opening_stock',
      notes: null,
      items: [
        { variantId: riceId, quantityDeltaMilli: 10_000 },
        { variantId: soapId, quantityDeltaMilli: 15_000 }
      ]
    })

    // Counting the exact recorded quantities produces no adjustment.
    expect(
      bed.inventoryService.reconcile(actor, {
        notes: 'All matched',
        items: [
          { variantId: riceId, countedMilli: 10_000 },
          { variantId: soapId, countedMilli: 15_000 }
        ]
      })
    ).toBeNull()

    // Counting 9.25 kg of rice (-0.75 kg variance) and 15 pcs of soap (0 variance) adjusts only rice.
    const reconciled = bed.inventoryService.reconcile(actor, {
      notes: 'Monthly shelf count',
      items: [
        { variantId: riceId, countedMilli: 9250 },
        { variantId: soapId, countedMilli: 15_000 }
      ]
    })
    expect(reconciled).toMatchObject({
      adjustmentNumber: 'ADJ000002',
      reasonCode: 'count_correction',
      reasonName: 'Stock count correction',
      notes: 'Monthly shelf count',
      items: [
        {
          variantId: riceId,
          name: 'Sona Masoori Rice 1 kg',
          quantityDeltaMilli: -750,
          onHandAfterMilli: 9250
        }
      ]
    })

    const auditEntry = bed.audit().findLast((e) => e.action === 'stock.counted')
    expect(JSON.parse(auditEntry!.details ?? '{}')).toEqual({
      adjustmentNumber: 'ADJ000002',
      notes: 'Monthly shelf count',
      items: [
        {
          item: 'Sona Masoori Rice 1 kg',
          recorded: '10 kg',
          counted: '9.25 kg',
          change: '-0.75 kg'
        }
      ]
    })
  })

  it('returns movement history with running balances across every document type and verifies ledger consistency (M14-07, M14-08)', () => {
    const db = getDb()
    const actor = bed.actor()

    bed.clock.time = 1_000
    bed.inventoryService.adjust(actor, {
      reasonCode: 'opening_stock',
      notes: 'Opening',
      items: [{ variantId: soapId, quantityDeltaMilli: 10_000 }]
    })

    const supplierId = insertSupplier(db, 'Kaveri Distributors')
    insertGoodsReceipt(db, {
      receiptNumber: 'GRN000001',
      supplierId,
      userId: actor.userId,
      postedAt: 2_000,
      lines: [{ variantId: soapId, quantityMilli: 20_000, unitCostMinor: 3200 }]
    })

    const sold = insertSale(db, {
      invoiceNumber: 'INV000001',
      cashierId: actor.userId,
      completedAt: 3_000,
      lines: [{ variantId: soapId, quantityMilli: 4000, unitPriceMinor: 4500 }],
      payments: [{ methodCode: 'cash', amountMinor: 18_000 }]
    })

    const voided = insertSale(db, {
      invoiceNumber: 'INV000002',
      cashierId: actor.userId,
      completedAt: 4_000,
      lines: [{ variantId: soapId, quantityMilli: 2000, unitPriceMinor: 4500 }],
      payments: [{ methodCode: 'cash', amountMinor: 9000 }]
    })
    insertVoid(db, voided.saleId, actor.userId, 5_000)

    insertReturn(db, {
      returnNumber: 'CN000001',
      saleId: sold.saleId,
      userId: actor.userId,
      returnedAt: 6_000,
      items: [
        {
          saleItemId: sold.saleItemIds[0]!,
          quantityMilli: 1000,
          disposition: 'restock',
          creditAmountMinor: 4500
        }
      ]
    })

    const history = bed.inventoryService.movements(actor, { variantId: soapId })
    expect(history.onHandMilli).toBe(27_000)
    expect(history.total).toBe(6)
    expect(
      history.items.map((m) => ({
        type: m.movementType,
        doc: m.documentNumber,
        delta: m.quantityDeltaMilli,
        after: m.balanceAfterMilli
      }))
    ).toEqual([
      { type: 'sale_return', doc: 'CN000001', delta: 1000, after: 27_000 },
      { type: 'sale_void', doc: 'INV000002', delta: 2000, after: 26_000 },
      { type: 'sale', doc: 'INV000002', delta: -2000, after: 24_000 },
      { type: 'sale', doc: 'INV000001', delta: -4000, after: 26_000 },
      { type: 'goods_receipt', doc: 'GRN000001', delta: 20_000, after: 30_000 },
      { type: 'adjustment', doc: 'ADJ000001', delta: 10_000, after: 10_000 }
    ])

    // Filtering by movementType keeps each movement's true historical balanceAfterMilli.
    const salesOnly = bed.inventoryService.movements(actor, {
      variantId: soapId,
      movementType: 'sale'
    })
    expect(salesOnly.items.map((m) => m.balanceAfterMilli)).toEqual([24_000, 26_000])

    // M14-08: ledger consistency check passes both via InventoryService and checkIntegrity.
    expect(bed.inventoryService.verifyLedgerConsistency()).toEqual({ ok: true, mismatches: [] })
    expect(checkIntegrity(db, 'quick').ok).toBe(true)
  })
})
