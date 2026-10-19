import { describe, expect, it } from 'vitest'
import {
  insertBusiness,
  insertProduct,
  insertSale,
  insertTaxClass,
  insertUser
} from './dev/builders'
import { checkIntegrity } from './integrity'
import { useMigratedDb } from './test/testDb'

describe('checkIntegrity', () => {
  const getDb = useMigratedDb()

  function setup() {
    const db = getDb()
    insertBusiness(db)
    const cashier = insertUser(db, 'cashier1')
    const tax = insertTaxClass(db, 'GST 0%', 0)
    const [variant] = insertProduct(db, {
      name: 'Salt',
      taxClassId: tax,
      variants: [{ sku: 'SALT', priceMinor: 2500 }]
    }).variantIds
    return { db, cashier, variant: variant as number }
  }

  it('passes a healthy database in both modes', () => {
    const { db, cashier, variant } = setup()
    insertSale(db, {
      invoiceNumber: 'INV-1',
      cashierId: cashier,
      lines: [{ variantId: variant, quantityMilli: 2000, unitPriceMinor: 2500 }],
      payments: [{ methodCode: 'cash', amountMinor: 5000 }]
    })
    expect(checkIntegrity(db, 'quick')).toMatchObject({
      ok: true,
      storageProblems: [],
      foreignKeyViolations: []
    })
    expect(checkIntegrity(db, 'full').ok).toBe(true)
  })

  it('reports business invariants the schema cannot enforce', () => {
    const { db, cashier, variant } = setup()
    insertSale(db, {
      invoiceNumber: 'INV-1',
      cashierId: cashier,
      lines: [{ variantId: variant, quantityMilli: 2000, unitPriceMinor: 2500 }],
      payments: [{ methodCode: 'cash', amountMinor: 4000 }] // underpaid
    })
    const report = checkIntegrity(db, 'quick')
    expect(report.ok).toBe(false)
    expect(report.consistencyViolations).toEqual([
      { check: 'sale_payments_do_not_match_total', count: 1 }
    ])
  })

  it('reports foreign key violations', () => {
    const { db } = setup()
    db.exec('PRAGMA foreign_keys = OFF')
    db.run("INSERT INTO categories (name, created_at, updated_at) VALUES ('x', 0, 0)")
    db.run('UPDATE products SET category_id = 999')
    db.exec('PRAGMA foreign_keys = ON')
    const report = checkIntegrity(db, 'quick')
    expect(report.ok).toBe(false)
    expect(report.foreignKeyViolations).toEqual([
      expect.objectContaining({ table: 'products', parent: 'categories' })
    ])
  })
})
