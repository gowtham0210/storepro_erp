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

function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return ''
  let text = typeof cell === 'number' ? String(cell) : cell
  if (typeof cell === 'string' && FORMULA_START.test(text) && !NUMBER.test(text)) {
    text = `'${text}`
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return BOM + rows.map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n'
}

/** Reads CSV text back into rows (the inverse of `toCsv`, used by tests and by import). */
export function parseCsv(text: string): string[][] {
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
