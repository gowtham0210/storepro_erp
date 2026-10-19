import { describe, expect, it } from 'vitest'
import { insertProduct, insertTaxClass } from './dev/builders'
import { buildPrefixMatchQuery } from './search'
import { useMigratedDb } from './test/testDb'

describe('buildPrefixMatchQuery', () => {
  it('quotes each word as a prefix term', () => {
    expect(buildPrefixMatchQuery('toor dal')).toBe('"toor"* "dal"*')
    expect(buildPrefixMatchQuery('SKU-123')).toBe('"SKU"* "123"*')
    expect(buildPrefixMatchQuery('  "a" OR b*:  ')).toBe('"a"* "OR"* "b"*')
    expect(buildPrefixMatchQuery('-*"')).toBeNull()
  })

  const getDb = useMigratedDb()

  it('produces queries FTS5 accepts for hostile input', () => {
    const db = getDb()
    const tax = insertTaxClass(db, 'GST 5%', 500)
    insertProduct(db, {
      name: 'Toor Dal',
      taxClassId: tax,
      variants: [{ sku: 'SKU-123', priceMinor: 100 }]
    })
    const run = (input: string) =>
      db.all('SELECT rowid FROM variant_search WHERE variant_search MATCH ?', [
        buildPrefixMatchQuery(input) ?? '""'
      ])
    expect(run('SKU-12')).toHaveLength(1)
    expect(run('toor da')).toHaveLength(1)
    for (const input of [
      'NOT',
      'a AND',
      '(',
      'name:',
      '"unterminated',
      'NEAR(a b',
      '^x',
      'x + y'
    ]) {
      expect(() => run(input)).not.toThrow()
    }
  })
})
