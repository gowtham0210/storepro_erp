import { describe, expect, it } from 'vitest'
import { parseCsvRows as parseCsv, toCsv } from './csv'

describe('CSV (M22-03)', () => {
  it('quotes cells that need it and reads them back exactly', () => {
    const rows = [
      ['Item', 'Note', 'Amount'],
      ['Rice, 5 kg', 'He said "fresh"', '320.00'],
      ['Two\nlines', '', null]
    ]
    const csv = toCsv(rows)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('"Rice, 5 kg","He said ""fresh""",320.00\r\n')
    expect(parseCsv(csv)).toEqual([
      ['Item', 'Note', 'Amount'],
      ['Rice, 5 kg', 'He said "fresh"', '320.00'],
      ['Two\nlines', '', '']
    ])
  })

  it('keeps text that looks like a formula as text', () => {
    const csv = toCsv([['=HYPERLINK("http://x","click")', '+91 98400', '-note', '@SUM(A1)', ' ok']])
    const [row] = parseCsv(csv)
    expect(row).toEqual([
      `'=HYPERLINK("http://x","click")`,
      "'+91 98400",
      "'-note",
      "'@SUM(A1)",
      ' ok'
    ])
  })

  it('leaves numbers and amounts alone, including negative ones', () => {
    const csv = toCsv([[-5, 12.5, '-1250.50', '320.00', '0', '1e3']])
    // The last is text that is not a plain number, so it is just text and safe as it is.
    expect(parseCsv(csv)).toEqual([['-5', '12.5', '-1250.50', '320.00', '0', '1e3']])
  })

  it('keeps non-English text and the rupee sign', () => {
    const csv = toCsv([['அரிசி 5 கிலோ', '₹320.00']])
    expect(parseCsv(csv)).toEqual([['அரிசி 5 கிலோ', '₹320.00']])
  })

  it('writes an empty table as just the line break, and reads empty text as no rows', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv(toCsv([['A']]))).toEqual([['A']])
  })
})
