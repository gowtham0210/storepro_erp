/**
 * Receipt template engine for 58 mm and 80 mm thermal printers (M13-02, M13-03, M13-05).
 *
 * Pure and dependency-free: builds structured receipt documents, fixed-width
 * monospace lines (32 columns for 58 mm, 48 columns for 80 mm) used by both UI
 * previews and ESC/POS printing, and print-ready HTML for Windows printer
 * drivers.
 */
import type { ReceiptPaperWidthMm, SaleDetail, StoreProfile } from './ipc/contract'
import { formatMoney, type CurrencyFormat } from './money'
import { formatQuantity } from './quantity'
import { formatStoreTime } from './storeTime'

export const RECEIPT_WIDTH_COLS: Record<ReceiptPaperWidthMm, number> = {
  58: 32,
  80: 48
}

export interface ReceiptBuildOptions {
  paperWidthMm: ReceiptPaperWidthMm
  /** Marks the receipt with a prominent Duplicate/Reprint banner (M13-05, FR-043). */
  isReprint?: boolean
}

export interface ReceiptDocument {
  paperWidthMm: ReceiptPaperWidthMm
  columns: number
  isReprint: boolean
  isVoided: boolean
  storeName: string
  storeAddressLines: string[]
  storePhone: string
  storeEmail: string | null
  taxRegistrationNumber: string | null
  receiptHeader: string | null
  receiptFooter: string | null
  invoiceNumber: string
  completedAtText: string
  cashierName: string
  customerName: string | null
  lines: string[]
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Centres `text` within `width` columns, wrapping long lines cleanly. */
export function centerText(text: string, width: number): string[] {
  const wrapped = wrapText(text, width)
  return wrapped.map((line) => {
    const padLeft = Math.max(0, Math.floor((width - line.length) / 2))
    return ' '.repeat(padLeft) + line
  })
}

/** Word-wraps `text` into lines of at most `width` characters. */
export function wrapText(text: string, width: number): string[] {
  const result: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (trimmed === '') {
      continue
    }
    const words = trimmed.split(/\s+/)
    let current = ''
    for (const word of words) {
      if (word.length > width) {
        if (current) {
          result.push(current)
          current = ''
        }
        for (let i = 0; i < word.length; i += width) {
          result.push(word.slice(i, i + width))
        }
        continue
      }
      const next = current === '' ? word : `${current} ${word}`
      if (next.length <= width) {
        current = next
      } else {
        result.push(current)
        current = word
      }
    }
    if (current !== '') {
      result.push(current)
    }
  }
  return result.length > 0 ? result : ['']
}

/** Formats a left label and right value on a single line (or wraps onto two lines if too long). */
export function leftRight(left: string, right: string, width: number): string[] {
  const l = left.trim()
  const r = right.trim()
  if (l.length + 1 + r.length <= width) {
    return [l + ' '.repeat(width - l.length - r.length) + r]
  }
  const wrappedLeft = wrapText(l, width)
  const last = wrappedLeft[wrappedLeft.length - 1] ?? ''
  if (last.length + 1 + r.length <= width) {
    wrappedLeft[wrappedLeft.length - 1] = last + ' '.repeat(width - last.length - r.length) + r
    return wrappedLeft
  }
  return [...wrappedLeft, ' '.repeat(Math.max(0, width - r.length)) + r]
}

function formatRatePercent(rateBp: number): string {
  return `${(rateBp / 100).toFixed(rateBp % 100 === 0 ? 0 : 2)}%`
}

/**
 * Builds a complete `ReceiptDocument` for 58 mm or 80 mm thermal paper from
 * the store profile and a saved `SaleDetail` (M13-02, M13-03, M13-05).
 */
export function buildReceiptDocument(
  store: StoreProfile,
  sale: SaleDetail,
  options: ReceiptBuildOptions
): ReceiptDocument {
  const paperWidthMm = options.paperWidthMm
  const columns = RECEIPT_WIDTH_COLS[paperWidthMm]
  const isReprint = options.isReprint === true
  const isVoided = sale.voidInfo !== null
  const currency: CurrencyFormat = store.currency
  const ruleDash = '-'.repeat(columns)
  const ruleDouble = '='.repeat(columns)

  const lines: string[] = []

  // Store header
  lines.push(...centerText(store.name.toUpperCase(), columns))

  const addressParts = [store.addressLine1, store.addressLine2].filter(
    (part): part is string => Boolean(part && part.trim() !== '')
  )
  const cityLine = [store.city, store.regionCode, store.postalCode]
    .filter((part): part is string => Boolean(part && part.trim() !== ''))
    .join(' ')
  const storeAddressLines = [...addressParts, cityLine].filter((s) => s !== '')
  for (const addr of storeAddressLines) {
    lines.push(...centerText(addr, columns))
  }
  lines.push(...centerText(`Ph: ${store.phone}`, columns))
  if (store.email) {
    lines.push(...centerText(store.email, columns))
  }
  if (store.taxRegistrationNumber) {
    const label = store.countryCode === 'IN' ? 'GSTIN' : 'Tax ID'
    lines.push(...centerText(`${label}: ${store.taxRegistrationNumber}`, columns))
  }
  if (store.receiptHeader && store.receiptHeader.trim() !== '') {
    lines.push(...centerText(store.receiptHeader.trim(), columns))
  }

  // Banners for Duplicate/Reprint (M13-05) and Voided sales
  if (isReprint) {
    lines.push(ruleDouble)
    lines.push(...centerText('*** DUPLICATE / REPRINT ***', columns))
    lines.push(ruleDouble)
  }
  if (isVoided) {
    lines.push(ruleDouble)
    lines.push(...centerText('*** VOIDED INVOICE ***', columns))
    lines.push(ruleDouble)
  }

  lines.push(ruleDash)

  // Invoice metadata
  const completedAtText = formatStoreTime(sale.completedAt, store.timeZone)
  lines.push(...leftRight(`Bill: ${sale.invoiceNumber}`, completedAtText, columns))
  lines.push(...leftRight(`Cashier: ${sale.cashierName}`, '', columns))
  if (sale.customerName) {
    lines.push(...leftRight(`Customer: ${sale.customerName}`, '', columns))
  }

  lines.push(ruleDash)

  // Column header
  lines.push(...leftRight('Item (Qty x Rate)', 'Amount', columns))
  lines.push(ruleDash)

  // Line items
  for (const item of sale.lines) {
    const hsnSuffix = item.hsnCode ? ` [HSN:${item.hsnCode}]` : ''
    lines.push(...wrapText(`${item.description}${hsnSuffix}`, columns))
    const qtyRate = `  ${formatQuantity(item.quantityMilli)} ${item.unitCode} x ${formatMoney(item.unitPriceMinor, currency)}`
    const discNote =
      item.discountMinor > 0 ? ` (-${formatMoney(item.discountMinor, currency)})` : ''
    lines.push(
      ...leftRight(`${qtyRate}${discNote}`, formatMoney(item.totalMinor, currency), columns)
    )
  }

  lines.push(ruleDash)

  // Totals breakdown
  lines.push(
    ...leftRight(`Items: ${sale.lines.length}`, formatMoney(sale.grossMinor, currency), columns)
  )
  if (sale.discountMinor > 0) {
    lines.push(
      ...leftRight('Discount', `-${formatMoney(sale.discountMinor, currency)}`, columns)
    )
  }
  lines.push(...leftRight('Taxable amount', formatMoney(sale.taxableMinor, currency), columns))

  for (const taxRow of sale.taxSummary) {
    const inclTag = sale.pricesIncludeTax ? ' (incl.)' : ''
    lines.push(
      ...leftRight(
        `${taxRow.code} ${formatRatePercent(taxRow.rateBp)}${inclTag}`,
        formatMoney(taxRow.amountMinor, currency),
        columns
      )
    )
  }

  if (sale.roundOffMinor !== 0) {
    const sign = sale.roundOffMinor > 0 ? '+' : '-'
    lines.push(
      ...leftRight(
        'Round off',
        `${sign}${formatMoney(Math.abs(sale.roundOffMinor), currency)}`,
        columns
      )
    )
  }

  lines.push(ruleDouble)
  lines.push(
    ...leftRight('TOTAL PAYABLE', formatMoney(sale.grandTotalMinor, currency), columns)
  )
  lines.push(ruleDouble)

  // Payments
  for (const p of sale.payments) {
    const refPart = p.reference ? ` (${p.reference})` : ''
    lines.push(
      ...leftRight(`Paid: ${p.methodName}${refPart}`, formatMoney(p.amountMinor, currency), columns)
    )
    if (p.verificationNotice) {
      lines.push(...wrapText(`  * ${p.verificationNotice}`, columns))
    }
    if (p.tenderedMinor !== null && p.tenderedMinor > p.amountMinor) {
      lines.push(
        ...leftRight('  Cash tendered', formatMoney(p.tenderedMinor, currency), columns)
      )
    }
  }
  if (sale.changeMinor > 0) {
    lines.push(...leftRight('Change returned', formatMoney(sale.changeMinor, currency), columns))
  }

  // Linked return refunds (M12-04)
  if (sale.refunds.length > 0) {
    lines.push(ruleDash)
    for (const r of sale.refunds) {
      lines.push(
        ...leftRight(
          `Refund (${r.returnNumber} · ${r.methodName})`,
          `-${formatMoney(r.amountMinor, currency)}`,
          columns
        )
      )
    }
  }

  // Footer
  if (store.receiptFooter && store.receiptFooter.trim() !== '') {
    lines.push(ruleDash)
    lines.push(...centerText(store.receiptFooter.trim(), columns))
  }

  return {
    paperWidthMm,
    columns,
    isReprint,
    isVoided,
    storeName: store.name,
    storeAddressLines,
    storePhone: store.phone,
    storeEmail: store.email,
    taxRegistrationNumber: store.taxRegistrationNumber,
    receiptHeader: store.receiptHeader,
    receiptFooter: store.receiptFooter,
    invoiceNumber: sale.invoiceNumber,
    completedAtText,
    cashierName: sale.cashierName,
    customerName: sale.customerName,
    lines
  }
}

/**
 * Renders a self-contained HTML document sized for 58 mm or 80 mm thermal
 * paper so Electron's silent print driver prints crisp monospace output (M13-03).
 */
export function renderReceiptHtml(doc: ReceiptDocument): string {
  const widthMm = doc.paperWidthMm
  const fontSizePt = widthMm === 58 ? 8.5 : 9.5
  const bodyText = escapeHtml(doc.lines.join('\n'))
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Receipt ${escapeHtml(doc.invoiceNumber)}</title>
<style>
  @page {
    size: ${widthMm}mm auto;
    margin: 2mm;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: ${widthMm - 4}mm;
    background: #ffffff;
    color: #000000;
    font-family: "Consolas", "Courier New", monospace;
    font-size: ${fontSizePt}pt;
    line-height: 1.3;
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    font-size: inherit;
  }
</style>
</head>
<body>
<pre>${bodyText}</pre>
</body>
</html>`
}
