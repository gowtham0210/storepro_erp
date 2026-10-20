import type { ProductCsvColumnMapping, ProductImportTemplate } from './ipc/contract'

/**
 * CSV for exports (M22-03). Pure and dependency-free.
 *
 *  - Standard quoting: a cell with a comma, quote or line break is wrapped in
 *    quotes and its quotes doubled. Rows end with CRLF, as spreadsheets expect.
 *  - A byte-order mark leads the file, so Excel opens it as UTF-8 and keeps
 *    names such as "Ponni அரிசி" and the rupee sign intact.
 *  - **Spreadsheet formula injection.** A text cell that starts with `=`, `+`,
 *    `-`, `@`, a tab or a carriage return would be run as a formula when the
 *    file is opened (a product named `=HYPERLINK(...)` is enough). Such text is
 *    prefixed with an apostrophe so it stays text. Plain numbers, including
 *    negative amounts and amounts written with decimals ("-12.50"), are left
 *    alone, because they are data, not text.
 */
export type CsvCell = string | number | null | undefined

const BOM = '﻿'
const NUMBER = /^-?\d+(\.\d+)?$/
const FORMULA_START = /^[=+\-@\t\r]/

/** One cell, quoted and protected against formula injection as described above. */
export function escapeCsvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return ''
  let text = typeof cell === 'number' ? String(cell) : cell
  if (typeof cell === 'string' && FORMULA_START.test(text) && !NUMBER.test(text)) {
    text = `'${text}`
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return BOM + rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n'
}

/**
 * Reads CSV text back into raw rows, exactly as written: the inverse of `toCsv`, used to
 * check exported files. Product import uses `parseCsv` below, which keys rows by header.
 */
export function parseCsvRows(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

// ---------------------------------------------------------------------------
// Import (M22-01): an RFC-4180 parser that keys rows by header, and column mapping.
// Shared between main and renderer with zero runtime dependencies.
// ---------------------------------------------------------------------------

export interface ParsedCsvDocument {
  headers: string[]
  /** Each data row, with its 1-based line number in the CSV file. */
  rows: { rowNumber: number; values: Record<string, string> }[]
}

/**
 * Parses CSV text (handles UTF-8 BOM, quoted fields, escaped quotes `""`,
 * CRLF and LF line endings, and ignores blank lines).
 */
export function parseCsv(text: string): ParsedCsvDocument {
  const cleaned = text.replace(/^\uFEFF/, '')
  const rawRows: { lineNumber: number; cells: string[] }[] = []

  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  let line = 1
  let rowStartLine = 1

  const pushRow = (): void => {
    const isAllEmpty = currentRow.every((cell) => cell.trim() === '')
    if (!isAllEmpty) {
      rawRows.push({ lineNumber: rowStartLine, cells: currentRow })
    }
    currentRow = []
  }

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i] ?? ''
    const next = cleaned[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        if (ch === '\n') line++
        currentField += ch
      }
      continue
    }

    if (ch === '"' && currentField === '') {
      inQuotes = true
      continue
    }

    if (ch === ',') {
      currentRow.push(currentField.trim())
      currentField = ''
      continue
    }

    if (ch === '\r' && next === '\n') {
      currentRow.push(currentField.trim())
      currentField = ''
      pushRow()
      line++
      rowStartLine = line
      i++
      continue
    }

    if (ch === '\n' || ch === '\r') {
      currentRow.push(currentField.trim())
      currentField = ''
      pushRow()
      line++
      rowStartLine = line
      continue
    }

    currentField += ch
  }

  if (inQuotes) {
    throw new Error('CSV contains an unclosed double-quoted value')
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    pushRow()
  }

  const headerRow = rawRows[0]
  if (!headerRow) {
    return { headers: [], rows: [] }
  }
  const headers = headerRow.cells.map((h) => h.trim()).filter(Boolean)

  const rows = rawRows.slice(1).map((r) => {
    const values: Record<string, string> = {}
    headerRow.cells.forEach((headerName, idx) => {
      const key = headerName.trim()
      if (key) {
        values[key] = (r.cells[idx] ?? '').trim()
      }
    })
    return { rowNumber: r.lineNumber, values }
  })

  return { headers, rows }
}

export const DEFAULT_CSV_HEADERS: Required<ProductCsvColumnMapping> = {
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
}

const HEADER_ALIASES: Record<keyof ProductCsvColumnMapping, readonly string[]> = {
  productName: ['product_name', 'productname', 'product', 'name', 'item_name', 'item'],
  variantName: ['variant_name', 'variantname', 'variant', 'pack_size', 'packsize', 'size'],
  sku: ['sku', 'item_code', 'itemcode', 'code'],
  barcode: ['barcode', 'barcodes', 'ean', 'upc'],
  category: ['category', 'category_name', 'group', 'department'],
  unitCode: ['unit_code', 'unitcode', 'unit', 'uom'],
  sellingPrice: ['selling_price', 'sellingprice', 'price', 'rate', 'sale_price'],
  mrp: ['mrp', 'max_retail_price'],
  costPrice: ['cost_price', 'costprice', 'cost', 'purchase_price'],
  taxClass: ['tax_class', 'taxclass', 'tax', 'gst', 'tax_rate'],
  hsnCode: ['hsn_code', 'hsncode', 'hsn'],
  reorderLevel: ['reorder_level', 'reorderlevel', 'min_stock', 'low_stock_level', 'reorder'],
  tracksInventory: ['tracks_inventory', 'tracksinventory', 'track_stock', 'track_inventory']
}

function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * Resolves the column mapping from user overrides or auto-detects headers
 * by matching common aliases.
 */
export function resolveCsvColumnMapping(
  headers: readonly string[],
  override?: ProductCsvColumnMapping
): Required<ProductCsvColumnMapping> {
  const byNorm = new Map<string, string>()
  for (const h of headers) {
    byNorm.set(normaliseHeader(h), h)
  }

  const resolved = { ...DEFAULT_CSV_HEADERS }
  const keys = Object.keys(DEFAULT_CSV_HEADERS) as (keyof ProductCsvColumnMapping)[]

  for (const key of keys) {
    const explicit = override?.[key]?.trim()
    if (explicit) {
      resolved[key] = explicit
      continue
    }
    const aliases = HEADER_ALIASES[key]
    for (const alias of aliases) {
      const found = byNorm.get(alias)
      if (found) {
        resolved[key] = found
        break
      }
    }
  }

  return resolved
}

export function buildProductImportTemplate(): ProductImportTemplate {
  const columns: ProductImportTemplate['columns'] = [
    {
      header: 'product_name',
      required: true,
      description: 'Product name (rows with the same product_name are grouped as pack sizes)',
      example: 'Sona Masoori Rice'
    },
    {
      header: 'variant_name',
      required: false,
      description: 'Pack size or variant name (leave blank for single-variant products)',
      example: '5 kg'
    },
    {
      header: 'sku',
      required: false,
      description: 'Unique SKU code (auto-assigned as ITEM-00001 if left blank)',
      example: 'RICE-SM-5KG'
    },
    {
      header: 'barcode',
      required: false,
      description: 'Barcode(s); separate multiple barcodes with spaces or semicolons',
      example: '8901234560012'
    },
    {
      header: 'category',
      required: false,
      description: 'Category name (created automatically if it does not exist yet)',
      example: 'Staples'
    },
    {
      header: 'unit_code',
      required: true,
      description: 'Unit code (e.g. pcs, kg, g, l, ml, pack, box, dozen)',
      example: 'bag'
    },
    {
      header: 'selling_price',
      required: true,
      description: 'Selling price in store currency (e.g. 320.00)',
      example: '320.00'
    },
    {
      header: 'mrp',
      required: false,
      description: 'Maximum retail price (>= selling_price)',
      example: '350.00'
    },
    {
      header: 'cost_price',
      required: false,
      description: 'Standard purchase cost per unit',
      example: '285.00'
    },
    {
      header: 'tax_class',
      required: false,
      description: 'Tax class name or rate (e.g. "GST 5%" or "5%"); defaults to lowest active rate',
      example: 'GST 5%'
    },
    {
      header: 'hsn_code',
      required: false,
      description: '4, 6, or 8 digit HSN code for GST invoices',
      example: '1006'
    },
    {
      header: 'reorder_level',
      required: false,
      description: 'Minimum stock alert threshold in the item unit',
      example: '10'
    },
    {
      header: 'tracks_inventory',
      required: false,
      description: 'yes / no (defaults to yes)',
      example: 'yes'
    }
  ]

  const headerLine = columns.map((c) => c.header).join(',')
  const sampleRow1 = [
    'Sona Masoori Rice',
    '5 kg',
    'RICE-SM-5KG',
    '8901234560012',
    'Staples',
    'pcs',
    '320.00',
    '350.00',
    '285.00',
    'GST 5%',
    '1006',
    '10',
    'yes'
  ]
    .map(escapeCsvCell)
    .join(',')
  const sampleRow2 = [
    'Sona Masoori Rice',
    '1 kg',
    'RICE-SM-1KG',
    '8901234560019',
    'Staples',
    'pcs',
    '68.00',
    '75.00',
    '58.00',
    'GST 5%',
    '1006',
    '25',
    'yes'
  ]
    .map(escapeCsvCell)
    .join(',')

  return {
    filename: 'storepro-products-template.csv',
    csvText: `${headerLine}\n${sampleRow1}\n${sampleRow2}\n`,
    columns
  }
}
