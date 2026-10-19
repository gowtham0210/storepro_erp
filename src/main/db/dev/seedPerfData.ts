import { allocate, multiplyByQuantity, taxIncludedIn } from '@shared/money'
import type { Database } from '../database'
import {
  BASE_TIME,
  insertAdjustment,
  insertBusiness,
  insertCategory,
  insertGoodsReceipt,
  insertProduct,
  insertReturn,
  insertSale,
  insertSupplier,
  insertTaxClass,
  insertUser
} from './builders'

export interface SeedOptions {
  products: number
  days: number
  salesPerDay: number
  /** PRNG seed; the same seed always produces the same data. */
  seed?: number
}

export interface SeedSummary {
  products: number
  variants: number
  sales: number
  saleItems: number
  returns: number
  goodsReceipts: number
  barcodes: string[]
  durationMs: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const WORDS = [
  'Basmati',
  'Sona',
  'Toor',
  'Moong',
  'Urad',
  'Chana',
  'Atta',
  'Maida',
  'Sugar',
  'Jaggery',
  'Salt',
  'Turmeric',
  'Chilli',
  'Coriander',
  'Cumin',
  'Mustard',
  'Sunflower',
  'Groundnut',
  'Coconut',
  'Ghee',
  'Tea',
  'Coffee',
  'Biscuit',
  'Rusk',
  'Noodles',
  'Soap',
  'Shampoo',
  'Detergent',
  'Toothpaste',
  'Agarbatti'
]
const FORMS = [
  'Rice',
  'Dal',
  'Flour',
  'Powder',
  'Oil',
  'Pack',
  'Bar',
  'Liquid',
  'Masala',
  'Classic'
]

/** Deterministic PRNG (mulberry32). */
function createRandom(seed: number): (max: number) => number {
  let state = seed >>> 0
  return (max) => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * max
  }
}

/**
 * Fill an empty, migrated database with a realistic grocery store: a
 * catalogue, opening stock, daily deliveries, sales and a few returns.
 * Used by the performance tests (PRD §11) and for manual testing.
 */
export function seedPerfData(db: Database, options: SeedOptions): SeedSummary {
  const started = Date.now()
  const random = createRandom(options.seed ?? 1)
  const int = (max: number) => Math.floor(random(max))

  const variants: { id: number; price: number; rateBp: number; fraction: boolean }[] = []
  const barcodes: string[] = []
  let cashiers: number[] = []
  let suppliers: number[] = []

  db.transaction(() => {
    insertBusiness(db)
    cashiers = Array.from({ length: 5 }, (_, i) => insertUser(db, `cashier${i + 1}`))
    const taxClasses = [
      { id: insertTaxClass(db, 'GST 0%', 0), rateBp: 0 },
      { id: insertTaxClass(db, 'GST 5%', 500), rateBp: 500 },
      { id: insertTaxClass(db, 'GST 18%', 1800), rateBp: 1800 }
    ]
    const categories = Array.from({ length: 30 }, (_, i) => insertCategory(db, `Category ${i + 1}`))
    suppliers = Array.from({ length: 20 }, (_, i) => insertSupplier(db, `Supplier ${i + 1}`))

    for (let p = 0; p < options.products; p++) {
      const tax = taxClasses[int(taxClasses.length)] ?? taxClasses[0]!
      const loose = random(1) < 0.1
      const variantCount = !loose && random(1) < 0.15 ? 2 : 1
      const name = `${WORDS[int(WORDS.length)]} ${FORMS[int(FORMS.length)]} ${p + 1}`
      const specs = Array.from({ length: variantCount }, (_, v) => {
        const price = (500 + int(50_000)) * (v + 1)
        const barcode = `890${String(1_000_000_000 + p * 10 + v).padStart(10, '0')}`
        barcodes.push(barcode)
        return {
          variantName: variantCount === 1 ? null : v === 0 ? 'Small' : 'Large',
          sku: `SKU-${p + 1}-${v + 1}`,
          unitCode: loose ? 'kg' : 'pcs',
          priceMinor: price,
          mrpMinor: price + int(2000),
          costMinor: Math.round(price * 0.8),
          barcodes: [barcode]
        }
      })
      const { variantIds } = insertProduct(db, {
        name,
        taxClassId: tax.id,
        categoryId: categories[int(categories.length)] ?? null,
        hsnCode: '1006',
        variants: specs
      })
      variantIds.forEach((id, i) =>
        variants.push({ id, price: specs[i]!.priceMinor, rateBp: tax.rateBp, fraction: loose })
      )
    }

    insertAdjustment(db, {
      adjustmentNumber: 'ADJ-000001',
      reasonCode: 'opening_stock',
      userId: cashiers[0]!,
      adjustedAt: BASE_TIME - DAY_MS,
      lines: variants.map((v) => ({ variantId: v.id, quantityDeltaMilli: 500_000 }))
    })
  })

  // Popular items sell more: pick from a skewed distribution.
  const pickVariant = () => variants[Math.floor(variants.length * random(1) ** 2)]!
  let sales = 0
  let saleItems = 0
  let returns = 0
  let goodsReceipts = 0

  for (let day = 0; day < options.days; day++) {
    const dayStart = BASE_TIME + day * DAY_MS
    db.transaction(() => {
      const receiptLines = new Map<number, number>()
      while (receiptLines.size < 40) receiptLines.set(pickVariant().id, 1000 * (10 + int(90)))
      insertGoodsReceipt(db, {
        receiptNumber: `GRN-${String(++goodsReceipts).padStart(6, '0')}`,
        supplierId: suppliers[int(suppliers.length)]!,
        userId: cashiers[0]!,
        postedAt: dayStart,
        lines: [...receiptLines].map(([variantId, quantityMilli]) => ({
          variantId,
          quantityMilli,
          unitCostMinor: 1000 + int(20_000)
        }))
      })

      for (let s = 0; s < options.salesPerDay; s++) {
        const chosen = new Map<number, (typeof variants)[number]>()
        const lineCount = 1 + int(8)
        while (chosen.size < lineCount) {
          const v = pickVariant()
          chosen.set(v.id, v)
        }
        let total = 0
        const lines = [...chosen.values()].map((v) => {
          const quantityMilli = v.fraction ? 250 + int(2750) : 1000 * (1 + int(3))
          const net = multiplyByQuantity(v.price, quantityMilli)
          const tax = taxIncludedIn(net, v.rateBp)
          const [cgst, sgst] = allocate(tax, [1, 1])
          total += net
          return {
            variantId: v.id,
            quantityMilli,
            unitPriceMinor: v.price,
            taxes:
              v.rateBp === 0
                ? []
                : [
                    { code: 'CGST', rateBp: v.rateBp / 2, amountMinor: cgst! },
                    { code: 'SGST', rateBp: v.rateBp / 2, amountMinor: sgst! }
                  ]
          }
        })
        const sale = insertSale(db, {
          invoiceNumber: `INV-${String(++sales).padStart(8, '0')}`,
          cashierId: cashiers[int(cashiers.length)]!,
          completedAt: dayStart + Math.floor((s / options.salesPerDay) * 12 * 60 * 60 * 1000),
          lines,
          payments: [{ methodCode: random(1) < 0.6 ? 'cash' : 'upi', amountMinor: total }]
        })
        saleItems += lines.length

        if (random(1) < 0.005) {
          const line = lines[0]!
          const net = multiplyByQuantity(line.unitPriceMinor, line.quantityMilli)
          insertReturn(db, {
            returnNumber: `CN-${String(++returns).padStart(6, '0')}`,
            saleId: sale.saleId,
            userId: cashiers[0]!,
            returnedAt: dayStart + 13 * 60 * 60 * 1000,
            items: [
              {
                saleItemId: sale.saleItemIds[0]!,
                quantityMilli: line.quantityMilli,
                creditAmountMinor: net
              }
            ],
            refunds: [{ methodCode: 'cash', amountMinor: net }]
          })
        }
      }
    })
  }

  db.exec('PRAGMA optimize')
  return {
    products: options.products,
    variants: variants.length,
    sales,
    saleItems,
    returns,
    goodsReceipts,
    barcodes,
    durationMs: Date.now() - started
  }
}
