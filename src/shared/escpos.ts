/**
 * ESC/POS raw byte-stream builder for thermal receipt printers (M21-04).
 *
 * Encodes a `ReceiptDocument` into standard Epson ESC/POS commands, including
 * optional RJ11/RJ12 cash-drawer kick (`ESC p`) and partial paper cut (`GS V`).
 */
import type { ReceiptDocument } from './receipt'

export interface EscPosOptions {
  /** Kick the cash drawer attached to the receipt printer (ESC p 0). */
  openCashDrawer?: boolean
  /** Feed and cut paper at the end of the receipt (GS V 66 3). Default true. */
  cutPaper?: boolean
}

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

/** Normalizes non-ASCII characters (like ₹ or “ ”) to printable ASCII for standard 7/8-bit ESC/POS codepages. */
export function toEscPosAscii(line: string): string {
  return line
    .replaceAll('₹', 'Rs.')
    .replaceAll('€', 'EUR ')
    .replaceAll('£', 'GBP ')
    .replaceAll('“', '"')
    .replaceAll('”', '"')
    .replaceAll('‘', "'")
    .replaceAll('’', "'")
    .replaceAll('–', '-')
    .replaceAll('—', '-')
    .replaceAll('·', '-')
    .replace(/[^\x20-\x7e]/g, '?')
}

export function encodeEscPosReceipt(
  doc: ReceiptDocument,
  options: EscPosOptions = {}
): Uint8Array {
  const bytes: number[] = []
  const pushBytes = (...vals: number[]): void => {
    for (const v of vals) bytes.push(v & 0xff)
  }
  const pushAsciiLine = (text: string): void => {
    const clean = toEscPosAscii(text)
    for (let i = 0; i < clean.length; i++) {
      bytes.push(clean.charCodeAt(i) & 0x7f)
    }
    bytes.push(LF)
  }

  // 1. Initialize printer (ESC @)
  pushBytes(ESC, 0x40)

  // 2. Optional cash-drawer kick pulse on pin 2 (ESC p 0 25 250)
  if (options.openCashDrawer) {
    pushBytes(ESC, 0x70, 0x00, 0x19, 0xfa)
  }

  // 3. Left align (ESC a 0), normal font
  pushBytes(ESC, 0x61, 0x00)

  // 4. Print each formatted line; bold the store name (first line) and TOTAL PAYABLE / DUPLICATE banners
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i] ?? ''
    const isBoldLine =
      i === 0 ||
      line.includes('TOTAL PAYABLE') ||
      line.includes('DUPLICATE / REPRINT') ||
      line.includes('VOIDED INVOICE')

    if (isBoldLine) {
      pushBytes(ESC, 0x45, 0x01) // Emphasized ON
      pushAsciiLine(line)
      pushBytes(ESC, 0x45, 0x00) // Emphasized OFF
    } else {
      pushAsciiLine(line)
    }
  }

  // 5. Feed 3 trailing lines and partial paper cut (GS V 66 3)
  if (options.cutPaper !== false) {
    pushBytes(LF, LF, LF)
    pushBytes(GS, 0x56, 0x42, 0x03)
  }

  return Uint8Array.from(bytes)
}
