import type { Page } from '@playwright/test'
import { invokeIpc } from '../fixtures'

/**
 * A South Indian provision store's catalogue for exploring the app: loose rice, dals and
 * spices by weight, packed brands with barcodes, oils, dairy, personal care and pooja
 * items, with opening stock. Used by southIndianStore.seed.ts. Prices and GST rates are
 * illustrative demo values, not tax advice.
 */

type Tax = 'GST 0% (exempt)' | 'GST 5%' | 'GST 18%'

interface Pack {
  /** Pack size shown after the name ("1 kg"), or null for a single-variant item. */
  size: string | null
  sku: string
  unit: 'pcs' | 'kg' | 'l' | 'pack'
  /** Rupees. */
  price: number
  mrp?: number
  cost: number
  /** In the item's unit. */
  stock: number
  reorder?: number
  /** Packed goods carry a barcode; loose goods are looked up by SKU. */
  barcode?: boolean
}

interface Item {
  name: string
  category: string
  hsn: string
  tax: Tax
  packs: Pack[]
}

const loose = (
  sku: string,
  unit: 'kg' | 'l',
  price: number,
  cost: number,
  stock: number,
  reorder: number
): Pack => ({
  size: null,
  sku,
  unit,
  price,
  cost,
  stock,
  reorder
})

const packed = (
  size: string | null,
  sku: string,
  price: number,
  mrp: number,
  cost: number,
  stock: number,
  reorder = 5
): Pack => ({ size, sku, unit: 'pcs', price, mrp, cost, stock, reorder, barcode: true })

const CATALOGUE: Item[] = [
  // Rice & Grains
  {
    name: 'Ponni Raw Rice (loose)',
    category: 'Rice & Grains',
    hsn: '1006',
    tax: 'GST 0% (exempt)',
    packs: [loose('RICE-PONNI', 'kg', 58, 50, 150, 25)]
  },
  {
    name: 'Idli Rice (loose)',
    category: 'Rice & Grains',
    hsn: '1006',
    tax: 'GST 0% (exempt)',
    packs: [loose('RICE-IDLI', 'kg', 48, 41, 120, 25)]
  },
  {
    name: 'Seeraga Samba Rice (loose)',
    category: 'Rice & Grains',
    hsn: '1006',
    tax: 'GST 0% (exempt)',
    packs: [loose('RICE-SEERAGA', 'kg', 120, 102, 40, 10)]
  },
  {
    name: 'India Gate Basmati Rice',
    category: 'Rice & Grains',
    hsn: '1006',
    tax: 'GST 5%',
    packs: [
      packed('1 kg', 'BASMATI-1KG', 165, 180, 140, 24),
      packed('5 kg', 'BASMATI-5KG', 780, 825, 690, 6, 3)
    ]
  },
  {
    name: 'Sona Masoori Rice 25 kg Bag',
    category: 'Rice & Grains',
    hsn: '1006',
    tax: 'GST 5%',
    packs: [packed(null, 'SONA-25KG', 1450, 1550, 1300, 8, 3)]
  },

  // Dals & Pulses
  {
    name: 'Toor Dal (loose)',
    category: 'Dals & Pulses',
    hsn: '0713',
    tax: 'GST 0% (exempt)',
    packs: [loose('DAL-TOOR', 'kg', 165, 145, 8, 15)]
  },
  {
    name: 'Urad Dal Whole (loose)',
    category: 'Dals & Pulses',
    hsn: '0713',
    tax: 'GST 0% (exempt)',
    packs: [loose('DAL-URAD', 'kg', 150, 130, 45, 10)]
  },
  {
    name: 'Moong Dal (loose)',
    category: 'Dals & Pulses',
    hsn: '0713',
    tax: 'GST 0% (exempt)',
    packs: [loose('DAL-MOONG', 'kg', 130, 112, 30, 10)]
  },
  {
    name: 'Chana Dal (loose)',
    category: 'Dals & Pulses',
    hsn: '0713',
    tax: 'GST 0% (exempt)',
    packs: [loose('DAL-CHANA', 'kg', 95, 82, 35, 10)]
  },
  {
    name: 'Pottukadalai Roasted Gram (loose)',
    category: 'Dals & Pulses',
    hsn: '0713',
    tax: 'GST 0% (exempt)',
    packs: [loose('DAL-POTTU', 'kg', 120, 104, 20, 5)]
  },

  // Flours & Rava
  {
    name: 'Aashirvaad Atta',
    category: 'Flours & Rava',
    hsn: '1101',
    tax: 'GST 5%',
    packs: [
      packed('1 kg', 'ATTA-1KG', 70, 75, 60, 30),
      packed('5 kg', 'ATTA-5KG', 285, 310, 255, 10, 3)
    ]
  },
  {
    name: 'Anil Rava Sooji 500 g',
    category: 'Flours & Rava',
    hsn: '1103',
    tax: 'GST 5%',
    packs: [packed(null, 'RAVA-500G', 38, 40, 32, 36)]
  },
  {
    name: 'Anil Semiya Vermicelli 180 g',
    category: 'Flours & Rava',
    hsn: '1902',
    tax: 'GST 5%',
    packs: [packed(null, 'SEMIYA-180G', 20, 22, 16, 48)]
  },
  {
    name: 'Rice Flour (Arisi Maavu) 1 kg',
    category: 'Flours & Rava',
    hsn: '1102',
    tax: 'GST 5%',
    packs: [packed(null, 'RICEFLOUR-1KG', 55, 60, 46, 20)]
  },
  {
    name: 'Ragi Flour 500 g',
    category: 'Flours & Rava',
    hsn: '1102',
    tax: 'GST 5%',
    packs: [packed(null, 'RAGI-500G', 45, 50, 38, 15)]
  },

  // Oils & Ghee
  {
    name: 'Idhayam Gingelly Oil',
    category: 'Oils & Ghee',
    hsn: '1515',
    tax: 'GST 5%',
    packs: [
      packed('500 ml', 'IDHAYAM-500', 210, 225, 185, 18),
      packed('1 L', 'IDHAYAM-1L', 410, 440, 365, 3)
    ]
  },
  {
    name: 'Gold Winner Sunflower Oil 1 L',
    category: 'Oils & Ghee',
    hsn: '1512',
    tax: 'GST 5%',
    packs: [packed(null, 'GOLDWINNER-1L', 155, 165, 138, 40, 10)]
  },
  {
    name: 'VVS Groundnut Oil 1 L',
    category: 'Oils & Ghee',
    hsn: '1508',
    tax: 'GST 5%',
    packs: [packed(null, 'VVS-1L', 200, 215, 178, 20)]
  },
  {
    name: 'Chekku Groundnut Oil (loose)',
    category: 'Oils & Ghee',
    hsn: '1508',
    tax: 'GST 5%',
    packs: [loose('CHEKKU-GN', 'l', 220, 190, 25, 5)]
  },
  {
    name: 'Aavin Ghee',
    category: 'Oils & Ghee',
    hsn: '0405',
    tax: 'GST 5%',
    packs: [
      packed('200 ml', 'AAVINGHEE-200', 150, 160, 135, 15),
      packed('500 ml', 'AAVINGHEE-500', 360, 380, 325, 8, 3)
    ]
  },
  {
    name: 'Parachute Coconut Oil 500 ml',
    category: 'Oils & Ghee',
    hsn: '1513',
    tax: 'GST 5%',
    packs: [packed(null, 'PARACHUTE-500', 120, 130, 104, 18)]
  },

  // Spices & Masala
  {
    name: 'Aachi Sambar Powder',
    category: 'Spices & Masala',
    hsn: '0910',
    tax: 'GST 5%',
    packs: [
      packed('100 g', 'AACHI-SAMBAR-100', 42, 45, 35, 30),
      packed('200 g', 'AACHI-SAMBAR-200', 82, 88, 70, 15)
    ]
  },
  {
    name: 'Sakthi Rasam Powder 100 g',
    category: 'Spices & Masala',
    hsn: '0910',
    tax: 'GST 5%',
    packs: [packed(null, 'SAKTHI-RASAM-100', 38, 40, 32, 25)]
  },
  {
    name: 'Aachi Chicken Masala 50 g',
    category: 'Spices & Masala',
    hsn: '0910',
    tax: 'GST 5%',
    packs: [packed(null, 'AACHI-CHICKEN-50', 35, 38, 29, 25)]
  },
  {
    name: 'Sakthi Turmeric Powder 100 g',
    category: 'Spices & Masala',
    hsn: '0910',
    tax: 'GST 5%',
    packs: [packed(null, 'SAKTHI-TURMERIC-100', 30, 32, 25, 30)]
  },
  {
    name: 'Mustard Seeds (Kadugu) 100 g',
    category: 'Spices & Masala',
    hsn: '1207',
    tax: 'GST 5%',
    packs: [packed(null, 'KADUGU-100', 18, 20, 14, 40)]
  },
  {
    name: 'Cumin Seeds (Jeeragam) 100 g',
    category: 'Spices & Masala',
    hsn: '0909',
    tax: 'GST 5%',
    packs: [packed(null, 'JEERAGAM-100', 45, 50, 38, 30)]
  },
  {
    name: 'Tamarind (Puli, loose)',
    category: 'Spices & Masala',
    hsn: '0813',
    tax: 'GST 0% (exempt)',
    packs: [loose('PULI', 'kg', 180, 155, 20, 5)]
  },
  {
    name: 'Dry Red Chilli (Vathal Milagai, loose)',
    category: 'Spices & Masala',
    hsn: '0904',
    tax: 'GST 0% (exempt)',
    packs: [loose('VATHAL-MILAGAI', 'kg', 260, 225, 12, 3)]
  },

  // Tea & Coffee
  {
    name: '3 Roses Tea 250 g',
    category: 'Tea & Coffee',
    hsn: '0902',
    tax: 'GST 5%',
    packs: [packed(null, '3ROSES-250', 145, 155, 125, 24)]
  },
  {
    name: "Narasu's Filter Coffee 200 g",
    category: 'Tea & Coffee',
    hsn: '0901',
    tax: 'GST 5%',
    packs: [packed(null, 'NARASUS-200', 160, 170, 138, 20)]
  },
  {
    name: 'Bru Instant Coffee 50 g',
    category: 'Tea & Coffee',
    hsn: '2101',
    tax: 'GST 5%',
    packs: [packed(null, 'BRU-50', 110, 120, 95, 0)]
  },

  // Snacks & Biscuits
  {
    name: 'Parle-G Biscuits 250 g',
    category: 'Snacks & Biscuits',
    hsn: '1905',
    tax: 'GST 5%',
    packs: [packed(null, 'PARLEG-250', 25, 25, 21, 60, 12)]
  },
  {
    name: 'Britannia Good Day Cashew 75 g',
    category: 'Snacks & Biscuits',
    hsn: '1905',
    tax: 'GST 5%',
    packs: [packed(null, 'GOODDAY-75', 30, 30, 25, 48, 12)]
  },
  {
    name: 'Britannia Marie Gold 250 g',
    category: 'Snacks & Biscuits',
    hsn: '1905',
    tax: 'GST 5%',
    packs: [packed(null, 'MARIE-250', 40, 40, 34, 36, 10)]
  },
  {
    name: 'Kai Murukku 200 g',
    category: 'Snacks & Biscuits',
    hsn: '2106',
    tax: 'GST 5%',
    packs: [packed(null, 'MURUKKU-200', 90, 90, 72, 15)]
  },
  {
    name: 'Aachi Appalam 200 g',
    category: 'Snacks & Biscuits',
    hsn: '1905',
    tax: 'GST 0% (exempt)',
    packs: [packed(null, 'APPALAM-200', 45, 50, 37, 25)]
  },

  // Sugar, Salt & Jaggery
  {
    name: 'Sugar (loose)',
    category: 'Sugar, Salt & Jaggery',
    hsn: '1701',
    tax: 'GST 5%',
    packs: [loose('SUGAR', 'kg', 46, 41, 100, 20)]
  },
  {
    name: 'Tata Salt 1 kg',
    category: 'Sugar, Salt & Jaggery',
    hsn: '2501',
    tax: 'GST 0% (exempt)',
    packs: [packed(null, 'TATASALT-1KG', 28, 28, 23, 40, 10)]
  },
  {
    name: 'Achu Vellam Jaggery (loose)',
    category: 'Sugar, Salt & Jaggery',
    hsn: '1701',
    tax: 'GST 0% (exempt)',
    packs: [loose('VELLAM', 'kg', 75, 64, 30, 8)]
  },
  {
    name: 'Karupatti Palm Jaggery (loose)',
    category: 'Sugar, Salt & Jaggery',
    hsn: '1701',
    tax: 'GST 0% (exempt)',
    packs: [loose('KARUPATTI', 'kg', 380, 330, 10, 3)]
  },

  // Dairy
  {
    name: 'Aavin Toned Milk 500 ml',
    category: 'Dairy',
    hsn: '0401',
    tax: 'GST 0% (exempt)',
    packs: [packed(null, 'AAVINMILK-500', 22, 22, 20, 12, 20)]
  },
  {
    name: 'Aavin Curd 500 ml',
    category: 'Dairy',
    hsn: '0403',
    tax: 'GST 5%',
    packs: [packed(null, 'AAVINCURD-500', 30, 30, 26, 20, 10)]
  },
  {
    name: 'Aavin Butter 100 g',
    category: 'Dairy',
    hsn: '0405',
    tax: 'GST 5%',
    packs: [packed(null, 'AAVINBUTTER-100', 55, 58, 48, 10)]
  },

  // Personal Care
  {
    name: 'Medimix Ayurvedic Soap 125 g',
    category: 'Personal Care',
    hsn: '3401',
    tax: 'GST 5%',
    packs: [packed(null, 'MEDIMIX-125', 45, 48, 38, 36, 10)]
  },
  {
    name: 'Hamam Soap 150 g',
    category: 'Personal Care',
    hsn: '3401',
    tax: 'GST 5%',
    packs: [packed(null, 'HAMAM-150', 40, 42, 34, 36, 10)]
  },
  {
    name: 'Colgate Strong Teeth 200 g',
    category: 'Personal Care',
    hsn: '3306',
    tax: 'GST 5%',
    packs: [packed(null, 'COLGATE-200', 110, 118, 94, 20)]
  },
  {
    name: 'Meera Shikakai Powder 100 g',
    category: 'Personal Care',
    hsn: '3305',
    tax: 'GST 5%',
    packs: [packed(null, 'SHIKAKAI-100', 45, 50, 38, 15)]
  },

  // Household & Pooja
  {
    name: 'Rin Detergent Bar 250 g',
    category: 'Household & Pooja',
    hsn: '3402',
    tax: 'GST 18%',
    packs: [packed(null, 'RIN-250', 28, 30, 23, 40, 10)]
  },
  {
    name: 'Surf Excel Easy Wash 1 kg',
    category: 'Household & Pooja',
    hsn: '3402',
    tax: 'GST 18%',
    packs: [packed(null, 'SURF-1KG', 150, 160, 128, 15)]
  },
  {
    name: 'Vim Dishwash Bar 200 g',
    category: 'Household & Pooja',
    hsn: '3402',
    tax: 'GST 18%',
    packs: [packed(null, 'VIM-200', 20, 22, 16, 40, 10)]
  },
  {
    name: 'Cycle 3-in-1 Agarbatti',
    category: 'Household & Pooja',
    hsn: '3307',
    tax: 'GST 5%',
    packs: [packed(null, 'CYCLE-3IN1', 55, 60, 45, 25)]
  },
  {
    name: 'Camphor (Karpooram) 50 g',
    category: 'Household & Pooja',
    hsn: '2914',
    tax: 'GST 5%',
    packs: [packed(null, 'KARPOORAM-50', 60, 65, 50, 20)]
  },
  {
    name: 'Deepam Lamp Oil 1 L',
    category: 'Household & Pooja',
    hsn: '1515',
    tax: 'GST 5%',
    packs: [packed(null, 'DEEPAM-1L', 180, 195, 155, 12)]
  },
  {
    name: 'Ship Safety Matches (10 boxes)',
    category: 'Household & Pooja',
    hsn: '3605',
    tax: 'GST 5%',
    packs: [packed(null, 'MATCHES-10', 20, 20, 16, 30, 10)]
  }
]

/** A made-up but valid EAN-13 barcode in India's 890 range, the same every run. */
function barcodeFor(index: number): string {
  const body = `890${String(7700000 + index).padStart(9, '0')}`
  const sum = [...body].reduce(
    (total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 1 : 3),
    0
  )
  return body + String((10 - (sum % 10)) % 10)
}

const paise = (rupees: number): number => Math.round(rupees * 100)

/** Add the catalogue and its opening stock to the store signed in on `ui`. Returns a summary. */
export async function fillCatalogue(ui: Page): Promise<string> {
  const taxes = await invokeIpc<{ taxClassId: number; name: string }[]>(ui, 'tax:list-classes')
  const taxId = (name: Tax): number => {
    const found = taxes.find((t) => t.name === name)
    if (!found) throw new Error(`Tax class “${name}” is missing in this store`)
    return found.taxClassId
  }

  const categories = new Map(
    (await invokeIpc<{ categoryId: number; name: string }[]>(ui, 'catalog:list-categories')).map(
      (c) => [c.name, c.categoryId]
    )
  )
  for (const name of new Set(CATALOGUE.map((item) => item.category))) {
    if (categories.has(name)) continue
    const created = await invokeIpc<{ categoryId: number }>(ui, 'catalog:create-category', {
      name
    })
    categories.set(name, created.categoryId)
  }

  let barcodeIndex = 0
  const opening: { variantId: number; quantityDeltaMilli: number }[] = []
  let createdProducts = 0
  let skipped = 0
  for (const item of CATALOGUE) {
    const packs = item.packs.map((pack) => ({
      pack,
      barcode: pack.barcode ? barcodeFor(++barcodeIndex) : null
    }))
    const existing = await invokeIpc<unknown>(ui, 'products:find-by-barcode', {
      barcode: item.packs[0]?.sku ?? ''
    })
    if (existing) {
      skipped++
      continue
    }
    const product = await invokeIpc<{ variants: { variantId: number; sku: string }[] }>(
      ui,
      'products:create',
      {
        name: item.name,
        categoryId: categories.get(item.category) ?? null,
        taxClassId: taxId(item.tax),
        hsnCode: item.hsn,
        tracksInventory: true,
        variants: packs.map(({ pack, barcode }) => ({
          variantName: pack.size,
          sku: pack.sku,
          unitCode: pack.unit,
          sellingPriceMinor: paise(pack.price),
          mrpMinor: pack.mrp === undefined ? null : paise(pack.mrp),
          costPriceMinor: paise(pack.cost),
          reorderLevelMilli: pack.reorder === undefined ? null : pack.reorder * 1000,
          barcodes: barcode ? [barcode] : []
        }))
      }
    )
    createdProducts++
    for (const { pack } of packs) {
      const variant = product.variants.find((v) => v.sku === pack.sku)
      if (variant && pack.stock > 0) {
        opening.push({ variantId: variant.variantId, quantityDeltaMilli: pack.stock * 1000 })
      }
    }
  }

  if (opening.length > 0) {
    await invokeIpc(ui, 'inventory:adjust', {
      reasonCode: 'opening_stock',
      notes: 'Opening stock for the demo catalogue',
      items: opening
    })
  }
  return (
    `Added ${createdProducts} products (${opening.length} with opening stock) in ${categories.size} categories.` +
    (skipped > 0 ? ` Skipped ${skipped} that were already there.` : '')
  )
}
