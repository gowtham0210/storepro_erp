/**
 * Price label and barcode label generator for shelf/pack labels (M24-03).
 *
 * Pure and dependency-free: formats label data and generates a self-contained
 * printable HTML document with a deterministic Code-128B SVG barcode so labels
 * print cleanly on thermal label printers without external font dependencies.
 */
import { formatMoney, type CurrencyFormat } from './money'

export interface PriceLabelInput {
  storeName: string
  productName: string
  variantName: string | null
  sku: string
  barcode: string | null
  unitCode: string
  sellingPriceMinor: number
  mrpMinor: number | null
  currency: CurrencyFormat
  /** Optional packed-on date (YYYY-MM-DD) for grocery pre-packs. */
  packedDate?: string | null | undefined
  /** Number of copies to render on the print job (1..50). Default 1. */
  copies?: number | undefined
}

export interface PriceLabelPreview {
  title: string
  storeName: string
  codeText: string
  priceText: string
  mrpText: string | null
  unitCode: string
  packedDate: string | null
  copies: number
  svgBarcode: string
  html: string
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Code-128 Set B bar patterns (values 0..106). Each entry is a 6-digit string
 * of bar/space module widths summing to 11 modules (stop code 106 has 7 bars = 13 modules).
 */
const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112'
]

/** Renders an inline SVG Code-128B barcode for printable ASCII strings (`0x20`..`0x7e`). */
export function renderCode128Svg(value: string, heightPx = 36): string {
  const clean = value.trim().replace(/[^\x20-\x7e]/g, '') || 'ITEM'
  const codes: number[] = [104] // Start Code B
  let checksum = 104

  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i) - 32
    codes.push(code)
    checksum += code * (i + 1)
  }
  codes.push(checksum % 103)
  codes.push(106) // Stop

  const quietZone = 10
  let x = quietZone
  const rects: string[] = []

  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code] ?? '212222'
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern.charCodeAt(i) - 48
      if (i % 2 === 0) {
        rects.push(`<rect x="${x}" y="0" width="${width}" height="${heightPx}" fill="#000" />`)
      }
      x += width
    }
  }

  const totalWidth = x + quietZone
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${heightPx}" role="img" aria-label="Barcode ${escapeHtml(clean)}" style="width:100%;max-width:180px;height:${heightPx}px;display:block;margin:0 auto;">${rects.join('')}</svg>`
}

/** Builds a `PriceLabelPreview` (including print-ready HTML for 1..50 copies) (M24-03). */
export function buildPriceLabel(input: PriceLabelInput): PriceLabelPreview {
  const title = input.variantName
    ? `${input.productName} · ${input.variantName}`
    : input.productName
  const codeText = input.barcode ?? input.sku
  const priceText = formatMoney(input.sellingPriceMinor, input.currency)
  const mrpText =
    input.mrpMinor !== null && input.mrpMinor > input.sellingPriceMinor
      ? formatMoney(input.mrpMinor, input.currency)
      : null
  const packedDate = input.packedDate?.trim() ? input.packedDate.trim() : null
  const copies = Math.min(50, Math.max(1, Math.trunc(input.copies ?? 1)))
  const svgBarcode = renderCode128Svg(codeText, 34)

  const singleLabelHtml = `<div class="label">
  <div class="store">${escapeHtml(input.storeName)}</div>
  <div class="title">${escapeHtml(title)}</div>
  <div class="prices">
    <span class="price">${escapeHtml(priceText)}</span>
    ${mrpText ? `<span class="mrp">MRP ${escapeHtml(mrpText)}</span>` : `<span class="unit">/ ${escapeHtml(input.unitCode)}</span>`}
  </div>
  ${packedDate ? `<div class="meta">Packed: ${escapeHtml(packedDate)}</div>` : ''}
  <div class="barcode">${svgBarcode}</div>
  <div class="code">${escapeHtml(codeText)}</div>
</div>`

  const allLabels = Array.from({ length: copies }, () => singleLabelHtml).join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Label ${escapeHtml(title)}</title>
<style>
  @page {
    size: 50mm 30mm;
    margin: 1.5mm;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #000000;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .label {
    width: 47mm;
    box-sizing: border-box;
    padding: 1mm;
    text-align: center;
    page-break-after: always;
  }
  .label:last-child {
    page-break-after: auto;
  }
  .store {
    font-size: 7pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .title {
    font-size: 8.5pt;
    font-weight: 700;
    margin-top: 0.5mm;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .prices {
    margin-top: 0.8mm;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 2mm;
  }
  .price {
    font-size: 11pt;
    font-weight: 800;
  }
  .mrp {
    font-size: 7.5pt;
    text-decoration: line-through;
  }
  .unit {
    font-size: 7.5pt;
  }
  .meta {
    font-size: 6.5pt;
    margin-top: 0.4mm;
  }
  .barcode {
    margin-top: 0.8mm;
  }
  .code {
    font-family: "Consolas", "Courier New", monospace;
    font-size: 7pt;
    letter-spacing: 0.06em;
  }
</style>
</head>
<body>
${allLabels}
</body>
</html>`

  return {
    title,
    storeName: input.storeName,
    codeText,
    priceText,
    mrpText,
    unitCode: input.unitCode,
    packedDate,
    copies,
    svgBarcode,
    html
  }
}
