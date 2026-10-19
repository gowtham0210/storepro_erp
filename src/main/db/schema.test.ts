import { beforeEach, describe, expect, it } from 'vitest'
import { multiplyByQuantity } from '@shared/money'
import type { Database } from './database'
import {
  BASE_TIME,
  insertAdjustment,
  insertBusiness,
  insertCategory,
  insertGoodsReceipt,
  insertProduct,
  insertPurchaseOrder,
  insertReturn,
  insertSale,
  insertSupplier,
  insertTaxClass,
  insertUser,
  insertVoid,
  stockOnHand
} from './dev/builders'
import { useMigratedDb } from './test/testDb'

interface TableInfo {
  name: string
  strict: number
  type: string
}
interface ColumnInfo {
  name: string
  type: string
  pk: number
}

function baseTables(db: Database): string[] {
  return db
    .all<TableInfo>("SELECT name, strict, type FROM pragma_table_list WHERE schema = 'main'")
    .filter(
      (t) =>
        t.type === 'table' && !t.name.startsWith('sqlite_') && !t.name.startsWith('variant_search')
    )
    .map((t) => t.name)
}

function columns(db: Database, table: string): ColumnInfo[] {
  return db.all<ColumnInfo>('SELECT name, type, pk FROM pragma_table_info(?)', [table])
}

describe('schema structure', () => {
  const getDb = useMigratedDb()

  it('uses STRICT tables everywhere, so column types are enforced', () => {
    const db = getDb()
    const nonStrict = db
      .all<TableInfo>(
        "SELECT name, strict, type FROM pragma_table_list WHERE schema = 'main' AND type = 'table'"
      )
      .filter(
        (t) =>
          !t.name.startsWith('sqlite_') && !t.name.startsWith('variant_search') && t.strict !== 1
      )
    expect(nonStrict.map((t) => t.name)).toEqual([])
  })

  it('never stores floating-point numbers', () => {
    const db = getDb()
    const real = baseTables(db).flatMap((table) =>
      columns(db, table)
        .filter((c) => !['INTEGER', 'TEXT', 'BLOB'].includes(c.type))
        .map((c) => `${table}.${c.name} (${c.type})`)
    )
    expect(real).toEqual([])
  })

  it('stores money, quantities, rates and timestamps as integers, by naming convention', () => {
    const db = getDb()
    const wrong = baseTables(db).flatMap((table) =>
      columns(db, table)
        .filter((c) => /(_minor|_milli|_bp|_at)$/.test(c.name) && c.type !== 'INTEGER')
        .map((c) => `${table}.${c.name}`)
    )
    expect(wrong).toEqual([])
  })

  it('gives every table a primary key', () => {
    const db = getDb()
    expect(baseTables(db).filter((table) => !columns(db, table).some((c) => c.pk > 0))).toEqual([])
  })

  it('indexes every foreign key column', () => {
    const db = getDb()
    const missing: string[] = []
    for (const table of baseTables(db)) {
      const fks = db.all<{ from: string; table: string }>(
        'SELECT "from", "table" FROM pragma_foreign_key_list(?)',
        [table]
      )
      const leadingColumns = new Set(
        db
          .all<{ name: string }>('SELECT name FROM pragma_index_list(?)', [table])
          .map(
            (index) =>
              db.get<{ name: string }>('SELECT name FROM pragma_index_info(?) WHERE seqno = 0', [
                index.name
              ])?.name
          )
      )
      const pk = columns(db, table)
        .filter((c) => c.pk === 1)
        .map((c) => c.name)
      for (const fk of fks) {
        if (!leadingColumns.has(fk.from) && !pk.includes(fk.from))
          missing.push(`${table}.${fk.from}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('names foreign keys after the key they reference', () => {
    const db = getDb()
    const offenders: string[] = []
    for (const table of baseTables(db)) {
      for (const fk of db.all<{ from: string; to: string }>(
        'SELECT "from", "to" FROM pragma_foreign_key_list(?)',
        [table]
      )) {
        // e.g. cashier_user_id -> user_id, purchase_order_id -> purchase_order_id
        if (!fk.from.endsWith(fk.to)) offenders.push(`${table}.${fk.from} -> ${fk.to}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('has no foreign key violations in the seeded reference data', () => {
    expect(getDb().all('PRAGMA foreign_key_check')).toEqual([])
  })
})

describe('schema rules', () => {
  const getDb = useMigratedDb()
  let db: Database
  let cashier: number
  let gst5: number
  let rice: number
  let soap: number

  beforeEach(() => {
    db = getDb()
    insertBusiness(db)
    cashier = insertUser(db, 'cashier1')
    gst5 = insertTaxClass(db, 'GST 5%', 500)
    const staples = insertCategory(db, 'Staples')
    rice = insertProduct(db, {
      name: 'Sona Masoori Rice',
      taxClassId: gst5,
      categoryId: staples,
      hsnCode: '1006',
      variants: [
        { sku: 'RICE-LOOSE', unitCode: 'kg', priceMinor: 6000, barcodes: ['2000000000017'] }
      ]
    }).variantIds[0] as number
    soap = insertProduct(db, {
      name: 'Neem Soap',
      taxClassId: gst5,
      variants: [{ sku: 'SOAP-100', priceMinor: 4500, mrpMinor: 5000 }]
    }).variantIds[0] as number
  })

  function sellSoap(
    invoiceNumber: string,
    quantity = 2
  ): { saleId: number; saleItemIds: number[] } {
    return insertSale(db, {
      invoiceNumber,
      cashierId: cashier,
      lines: [{ variantId: soap, quantityMilli: quantity * 1000, unitPriceMinor: 4500 }],
      payments: [{ methodCode: 'cash', amountMinor: 4500 * quantity }]
    })
  }

  describe('domain constraints', () => {
    it('rejects a barcode already used by another variant (FR-022)', () => {
      expect(() =>
        db.run('INSERT INTO barcodes (barcode, variant_id, created_at) VALUES (?, ?, ?)', [
          '2000000000017',
          soap,
          BASE_TIME
        ])
      ).toThrow(/UNIQUE|PRIMARY KEY/)
    })

    it('rejects a selling price above MRP and negative prices', () => {
      expect(() =>
        db.run('UPDATE product_variants SET selling_price_minor = 6000 WHERE variant_id = ?', [
          soap
        ])
      ).toThrow(/CHECK/)
      expect(() =>
        db.run('UPDATE product_variants SET selling_price_minor = -1 WHERE variant_id = ?', [rice])
      ).toThrow(/CHECK/)
    })

    it('rejects values of the wrong type instead of silently storing them', () => {
      expect(() =>
        db.run('UPDATE product_variants SET selling_price_minor = ? WHERE variant_id = ?', [
          45.5,
          soap
        ])
      ).toThrow(/cannot store REAL/)
    })

    it('allows only one unnamed default variant per product', () => {
      const product = db.get<{ product_id: number }>(
        'SELECT product_id FROM product_variants WHERE variant_id = ?',
        [soap]
      )?.product_id
      expect(() =>
        db.run(
          `INSERT INTO product_variants (product_id, sku, unit_code, selling_price_minor, created_at, updated_at)
           VALUES (?, 'SOAP-DUP', 'pcs', 100, 0, 0)`,
          [product ?? 0]
        )
      ).toThrow(/UNIQUE/)
    })

    it('rejects a line discount larger than the line amount', () => {
      expect(() =>
        insertSale(db, {
          invoiceNumber: 'INV-X',
          cashierId: cashier,
          lines: [
            { variantId: soap, quantityMilli: 1000, unitPriceMinor: 4500, discountMinor: 4501 }
          ],
          payments: []
        })
      ).toThrow(/CHECK/)
    })

    it('rejects invalid calendar dates', () => {
      expect(() =>
        db.run(
          `INSERT INTO expenses (expense_category_id, expense_date, amount_minor, payment_method_id,
             recorded_by_user_id, recorded_at, updated_at) VALUES (1, '2026-02-30', 100, 1, ?, 0, 0)`,
          [cashier]
        )
      ).toThrow(/CHECK/)
    })

    it('rejects a second checkout with the same idempotency key (FR-038)', () => {
      sellSoap('INV-1')
      expect(() =>
        db.run(
          `INSERT INTO sales (invoice_number, checkout_key, completed_at, cashier_user_id, prices_include_tax)
           VALUES ('INV-2', 'checkout-INV-1', 0, ?, 1)`,
          [cashier]
        )
      ).toThrow(/UNIQUE/)
    })

    it('keeps only one business row', () => {
      expect(() => insertBusiness(db)).toThrow()
    })
  })

  describe('append-only records', () => {
    it('blocks updating or deleting completed sales and their lines', () => {
      const { saleId } = sellSoap('INV-1')
      expect(() =>
        db.run('UPDATE sales SET round_off_minor = 1 WHERE sale_id = ?', [saleId])
      ).toThrow(/immutable/)
      expect(() => db.run('DELETE FROM sale_items WHERE sale_id = ?', [saleId])).toThrow(
        /immutable/
      )
      expect(() => db.run('DELETE FROM sale_payments WHERE sale_id = ?', [saleId])).toThrow(
        /immutable/
      )
    })

    it('blocks deleting referenced reference data', () => {
      sellSoap('INV-1')
      expect(() => db.run('DELETE FROM product_variants WHERE variant_id = ?', [soap])).toThrow(
        /FOREIGN KEY/
      )
    })

    it('blocks changes to stock adjustments and audit logs', () => {
      insertAdjustment(db, {
        adjustmentNumber: 'ADJ-1',
        reasonCode: 'opening_stock',
        userId: cashier,
        lines: [{ variantId: soap, quantityDeltaMilli: 10_000 }]
      })
      expect(() => db.run('UPDATE stock_adjustment_items SET quantity_delta_milli = 1')).toThrow(
        /immutable/
      )
      db.run("INSERT INTO audit_logs (occurred_at, action) VALUES (0, 'sale.void')")
      expect(() => db.run('DELETE FROM audit_logs')).toThrow(/immutable/)
    })

    it('lets drafts change but freezes posted goods receipts', () => {
      const supplier = insertSupplier(db, 'Acme Traders')
      const draft = insertGoodsReceipt(db, {
        receiptNumber: 'GRN-1',
        supplierId: supplier,
        userId: cashier,
        post: false,
        lines: [{ variantId: soap, quantityMilli: 5000, unitCostMinor: 3500 }]
      })
      db.run('UPDATE goods_receipt_items SET quantity_milli = 6000 WHERE goods_receipt_id = ?', [
        draft
      ])
      db.run(
        'UPDATE goods_receipts SET posted_at = 1, posted_by_user_id = ? WHERE goods_receipt_id = ?',
        [cashier, draft]
      )
      expect(() =>
        db.run('UPDATE goods_receipt_items SET quantity_milli = 1 WHERE goods_receipt_id = ?', [
          draft
        ])
      ).toThrow(/immutable/)
      expect(() =>
        db.run('DELETE FROM goods_receipts WHERE goods_receipt_id = ?', [draft])
      ).toThrow(/immutable/)
    })

    it('freezes the lines of a confirmed purchase order but allows closing it', () => {
      const supplier = insertSupplier(db, 'Acme Traders')
      const order = insertPurchaseOrder(db, {
        orderNumber: 'PO-1',
        supplierId: supplier,
        userId: cashier,
        lines: [{ variantId: soap, quantityMilli: 10_000, unitCostMinor: 3500 }]
      })
      expect(() => db.run('UPDATE purchase_order_items SET quantity_milli = 1')).toThrow(
        /cannot be edited/
      )
      db.run('UPDATE purchase_orders SET closed_at = 2 WHERE purchase_order_id = ?', [order])
      expect(
        db.get('SELECT status FROM v_purchase_orders WHERE purchase_order_id = ?', [order])
      ).toEqual({
        status: 'closed'
      })
    })
  })

  describe('cross-row business rules', () => {
    it('never lets the total returned exceed the quantity sold (FR-071)', () => {
      const { saleId, saleItemIds } = sellSoap('INV-1', 2)
      const item = saleItemIds[0] as number
      insertReturn(db, {
        returnNumber: 'CN-1',
        saleId,
        userId: cashier,
        items: [{ saleItemId: item, quantityMilli: 1000, creditAmountMinor: 4500 }]
      })
      expect(() =>
        insertReturn(db, {
          returnNumber: 'CN-2',
          saleId,
          userId: cashier,
          items: [{ saleItemId: item, quantityMilli: 1500, creditAmountMinor: 6750 }]
        })
      ).toThrow('return quantity exceeds the quantity sold')
      // The failed return was rolled back as a whole.
      expect(db.get("SELECT count(*) AS n FROM sale_returns WHERE return_number = 'CN-2'")).toEqual(
        { n: 0 }
      )
    })

    it('rejects returning a line from a different sale', () => {
      const first = sellSoap('INV-1')
      const second = sellSoap('INV-2')
      expect(() =>
        insertReturn(db, {
          returnNumber: 'CN-1',
          saleId: first.saleId,
          userId: cashier,
          items: [
            {
              saleItemId: second.saleItemIds[0] as number,
              quantityMilli: 1000,
              creditAmountMinor: 4500
            }
          ]
        })
      ).toThrow('does not belong to the returned sale')
    })

    it('keeps voids and returns mutually exclusive', () => {
      const voided = sellSoap('INV-1')
      insertVoid(db, voided.saleId, cashier)
      expect(() =>
        insertReturn(db, {
          returnNumber: 'CN-1',
          saleId: voided.saleId,
          userId: cashier,
          items: [
            {
              saleItemId: voided.saleItemIds[0] as number,
              quantityMilli: 1000,
              creditAmountMinor: 4500
            }
          ]
        })
      ).toThrow('voided sale cannot be returned')

      const returned = sellSoap('INV-2')
      insertReturn(db, {
        returnNumber: 'CN-2',
        saleId: returned.saleId,
        userId: cashier,
        items: [
          {
            saleItemId: returned.saleItemIds[0] as number,
            quantityMilli: 1000,
            creditAmountMinor: 4500
          }
        ]
      })
      expect(() => insertVoid(db, returned.saleId, cashier)).toThrow(
        'with returns cannot be voided'
      )
    })

    it('links a goods receipt only to a confirmed order from the same supplier', () => {
      const acme = insertSupplier(db, 'Acme Traders')
      const other = insertSupplier(db, 'Other Traders')
      const order = insertPurchaseOrder(db, {
        orderNumber: 'PO-1',
        supplierId: acme,
        userId: cashier,
        lines: [{ variantId: soap, quantityMilli: 10_000, unitCostMinor: 3500 }]
      })
      expect(() =>
        insertGoodsReceipt(db, {
          receiptNumber: 'GRN-1',
          supplierId: other,
          userId: cashier,
          purchaseOrderId: order,
          lines: [{ variantId: soap, quantityMilli: 1000, unitCostMinor: 3500 }]
        })
      ).toThrow('different suppliers')
      const draftOrder = insertPurchaseOrder(db, {
        orderNumber: 'PO-2',
        supplierId: acme,
        userId: cashier,
        confirm: false,
        lines: [{ variantId: soap, quantityMilli: 1000, unitCostMinor: 3500 }]
      })
      expect(() =>
        insertGoodsReceipt(db, {
          receiptNumber: 'GRN-2',
          supplierId: acme,
          userId: cashier,
          purchaseOrderId: draftOrder,
          lines: [{ variantId: soap, quantityMilli: 1000, unitCostMinor: 3500 }]
        })
      ).toThrow('not confirmed')
    })

    it('rejects the same supplier invoice entered twice', () => {
      const acme = insertSupplier(db, 'Acme Traders')
      const receipt = {
        supplierId: acme,
        userId: cashier,
        supplierInvoiceNumber: 'A-778',
        lines: [{ variantId: soap, quantityMilli: 1000, unitCostMinor: 3500 }]
      }
      insertGoodsReceipt(db, { ...receipt, receiptNumber: 'GRN-1' })
      expect(() => insertGoodsReceipt(db, { ...receipt, receiptNumber: 'GRN-2' })).toThrow(/UNIQUE/)
    })
  })

  describe('derived data', () => {
    it('computes tax-inclusive sale totals from the lines', () => {
      // 1.25 kg rice at ₹60.00/kg = ₹75.00, ₹5.00 off, 5% GST included (₹3.33).
      const { saleId } = insertSale(db, {
        invoiceNumber: 'INV-1',
        cashierId: cashier,
        roundOffMinor: 0,
        lines: [
          {
            variantId: rice,
            quantityMilli: 1250,
            unitPriceMinor: 6000,
            discountMinor: 500,
            taxes: [
              { code: 'CGST', rateBp: 250, amountMinor: 167 },
              { code: 'SGST', rateBp: 250, amountMinor: 166 }
            ]
          },
          { variantId: soap, quantityMilli: 1000, unitPriceMinor: 4500 }
        ],
        payments: [{ methodCode: 'cash', amountMinor: 11500, tenderedMinor: 20000 }]
      })
      expect(
        db.get(
          `SELECT line_count, gross_minor, discount_minor, taxable_minor, tax_minor, grand_total_minor,
             paid_minor, is_voided FROM v_sale_totals WHERE sale_id = ?`,
          [saleId]
        )
      ).toEqual({
        line_count: 2,
        gross_minor: 12000,
        discount_minor: 500,
        taxable_minor: 11167,
        tax_minor: 333,
        grand_total_minor: 11500,
        paid_minor: 11500,
        is_voided: 0
      })
    })

    it('adds tax on top when prices exclude tax, and applies bill rounding', () => {
      const { saleId } = insertSale(db, {
        invoiceNumber: 'INV-1',
        cashierId: cashier,
        pricesIncludeTax: false,
        roundOffMinor: -25,
        lines: [
          {
            variantId: soap,
            quantityMilli: 1000,
            unitPriceMinor: 4500,
            taxes: [{ code: 'IGST', rateBp: 500, amountMinor: 225 }]
          }
        ],
        payments: [{ methodCode: 'upi', amountMinor: 4700 }]
      })
      expect(
        db.get(
          'SELECT taxable_minor, tax_minor, grand_total_minor FROM v_sale_totals WHERE sale_id = ?',
          [saleId]
        )
      ).toEqual({ taxable_minor: 4500, tax_minor: 225, grand_total_minor: 4700 })
    })

    it('rounds line amounts in SQL exactly like multiplyByQuantity', () => {
      let seed = 42
      const random = (max: number) => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31
        return 1 + (seed % max)
      }
      const samples = Array.from({ length: 300 }, () => [random(999_999), random(50_000)] as const)
      for (const [price, quantity] of samples) {
        const sql = db.get<{ v: number }>('SELECT (? * ? + 500) / 1000 AS v', [quantity, price])?.v
        expect(sql).toBe(multiplyByQuantity(price, quantity))
      }
    })

    it('derives stock on hand from every kind of document (FR-051)', () => {
      const supplier = insertSupplier(db, 'Acme Traders')
      insertAdjustment(db, {
        adjustmentNumber: 'ADJ-1',
        reasonCode: 'opening_stock',
        userId: cashier,
        lines: [{ variantId: soap, quantityDeltaMilli: 10_000 }]
      })
      insertGoodsReceipt(db, {
        receiptNumber: 'GRN-1',
        supplierId: supplier,
        userId: cashier,
        lines: [{ variantId: soap, quantityMilli: 24_000, unitCostMinor: 3500 }]
      })
      insertGoodsReceipt(db, {
        receiptNumber: 'GRN-2',
        supplierId: supplier,
        userId: cashier,
        post: false, // drafts do not move stock
        lines: [{ variantId: soap, quantityMilli: 99_000, unitCostMinor: 3500 }]
      })
      const sold = sellSoap('INV-1', 3)
      const voided = sellSoap('INV-2', 5)
      insertVoid(db, voided.saleId, cashier)
      insertReturn(db, {
        returnNumber: 'CN-1',
        saleId: sold.saleId,
        userId: cashier,
        items: [
          {
            saleItemId: sold.saleItemIds[0] as number,
            quantityMilli: 1000,
            creditAmountMinor: 4500
          },
          {
            saleItemId: sold.saleItemIds[0] as number,
            quantityMilli: 1000,
            disposition: 'write_off',
            creditAmountMinor: 4500
          }
        ]
      })

      // 10 opening + 24 received - 3 sold - 5 sold + 5 voided + 1 restocked = 32
      expect(stockOnHand(db, soap)).toBe(32_000)
      expect(
        db.get('SELECT on_hand_milli FROM v_stock_on_hand WHERE variant_id = ?', [soap])
      ).toEqual({
        on_hand_milli: 32_000
      })
      expect(
        db
          .all<{ movement_type: string }>(
            'SELECT movement_type FROM v_inventory_movements WHERE variant_id = ? ORDER BY occurred_at, movement_type',
            [soap]
          )
          .map((m) => m.movement_type)
          .sort()
      ).toEqual(['adjustment', 'goods_receipt', 'sale', 'sale', 'sale_return', 'sale_void'])
    })

    it('excludes products that do not track inventory from stock', () => {
      const bag = insertProduct(db, {
        name: 'Carry bag',
        taxClassId: gst5,
        tracksInventory: false,
        variants: [{ sku: 'BAG', priceMinor: 500 }]
      }).variantIds[0]
      expect(
        db.get('SELECT * FROM v_stock_on_hand WHERE variant_id = ?', [bag ?? 0])
      ).toBeUndefined()
    })

    it('compares ordered and received quantities per order line (FR-062)', () => {
      const supplier = insertSupplier(db, 'Acme Traders')
      const order = insertPurchaseOrder(db, {
        orderNumber: 'PO-1',
        supplierId: supplier,
        userId: cashier,
        lines: [{ variantId: soap, quantityMilli: 10_000, unitCostMinor: 3500 }]
      })
      for (const [number, quantity] of [
        ['GRN-1', 4000],
        ['GRN-2', 5000]
      ] as const) {
        insertGoodsReceipt(db, {
          receiptNumber: number,
          supplierId: supplier,
          userId: cashier,
          purchaseOrderId: order,
          lines: [{ variantId: soap, quantityMilli: quantity, unitCostMinor: 3500 }]
        })
      }
      expect(
        db.get(
          'SELECT ordered_milli, received_milli FROM v_purchase_order_receipts WHERE purchase_order_id = ?',
          [order]
        )
      ).toEqual({ ordered_milli: 10_000, received_milli: 9000 })
    })
  })

  describe('product search index', () => {
    function search(query: string): number[] {
      return db
        .all<{ rowid: number }>(
          'SELECT rowid FROM variant_search WHERE variant_search MATCH ? ORDER BY rank',
          [query]
        )
        .map((r) => r.rowid)
    }

    it('finds variants by name prefix, SKU and barcode', () => {
      expect(search('sona*')).toEqual([rice])
      expect(search('"SOAP-100"')).toEqual([soap])
      expect(search('2000000000017')).toEqual([rice])
    })

    it('follows renames, new variants and barcode changes', () => {
      db.run(
        "UPDATE products SET name = 'Ponni Rice' WHERE product_id = (SELECT product_id FROM product_variants WHERE variant_id = ?)",
        [rice]
      )
      expect(search('sona*')).toEqual([])
      expect(search('ponni*')).toEqual([rice])

      db.run('INSERT INTO barcodes (barcode, variant_id, created_at) VALUES (?, ?, 0)', [
        '8901234567890',
        soap
      ])
      expect(search('8901234567890')).toEqual([soap])
      db.run("DELETE FROM barcodes WHERE barcode = '8901234567890'")
      expect(search('8901234567890')).toEqual([])
      expect(search('neem*')).toEqual([soap])
    })
  })
})
