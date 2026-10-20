import { describe, expect, it } from 'vitest'
import {
  checkRefunds,
  quoteReturn,
  ReturnError,
  type ReturnableItemFacts,
  type ReturnLineRequest
} from './returns'

const GST = (amountMinor: number) => [
  { code: 'CGST', rateBp: 250, amountMinor: Math.floor(amountMinor / 2) },
  { code: 'SGST', rateBp: 250, amountMinor: amountMinor - Math.floor(amountMinor / 2) }
]

/** 3 units at ₹100.00 with ₹10 off, tax-inclusive: net ₹290.00, of which ₹13.81 is GST. */
const SOAP: ReturnableItemFacts = {
  saleItemId: 1,
  soldMilli: 3000,
  netMinor: 29_000,
  taxes: GST(1381),
  priorReturnedMilli: 0
}

const request = (
  quantityMilli: number,
  disposition: ReturnLineRequest['disposition'] = 'restock',
  saleItemId = 1
): ReturnLineRequest => ({ saleItemId, quantityMilli, disposition })

describe('quoteReturn (M16-02, M16-04)', () => {
  it('credits the share of what was paid, after discounts, not the list price', () => {
    const quote = quoteReturn([SOAP], [request(1000)], true)
    // One of three units from a ₹290.00 line: ₹96.67 (not ₹100.00).
    expect(quote.lines[0]?.creditMinor).toBe(9667)
    expect(quote.creditMinor).toBe(9667)
    expect(quote.refundDueMinor).toBe(9667)
  })

  it('credits exactly what was paid once everything is back, however it comes back', () => {
    const oneByOne = [1, 2, 3].map((n) => {
      const facts = { ...SOAP, priorReturnedMilli: (n - 1) * 1000 }
      return quoteReturn([facts], [request(1000)], true)
    })
    expect(oneByOne.map((q) => q.creditMinor)).toEqual([9667, 9666, 9667])
    expect(oneByOne.reduce((sum, q) => sum + q.creditMinor, 0)).toBe(29_000)
    expect(oneByOne.reduce((sum, q) => sum + q.taxMinor, 0)).toBe(1381)

    // Or all at once, or split across dispositions in one return.
    expect(quoteReturn([SOAP], [request(3000)], true).creditMinor).toBe(29_000)
    const split = quoteReturn([SOAP], [request(1000, 'restock'), request(2000, 'write_off')], true)
    expect(split.creditMinor).toBe(29_000)
    expect(split.taxMinor).toBe(1381)
    expect(split.lines.map((l) => l.disposition)).toEqual(['restock', 'write_off'])
  })

  it('splits tax by component with no paisa lost', () => {
    const quote = quoteReturn([SOAP], [request(3000)], true)
    expect(quote.lines[0]?.taxes).toEqual([
      { code: 'CGST', rateBp: 250, amountMinor: 690 },
      { code: 'SGST', rateBp: 250, amountMinor: 691 }
    ])
  })

  it('refunds the credit when prices include tax, and credit plus tax when they do not', () => {
    // Tax-exclusive: net ₹290.00 before GST of ₹14.50 (5%).
    const exclusive: ReturnableItemFacts = { ...SOAP, netMinor: 29_000, taxes: GST(1450) }
    const quote = quoteReturn([exclusive], [request(3000)], false)
    expect(quote.creditMinor).toBe(29_000)
    expect(quote.taxMinor).toBe(1450)
    expect(quote.refundDueMinor).toBe(30_450)
    // The same facts on an inclusive invoice refund only the credit.
    expect(quoteReturn([exclusive], [request(3000)], true).refundDueMinor).toBe(29_000)
  })

  it('handles fractional quantities', () => {
    const rice: ReturnableItemFacts = {
      saleItemId: 2,
      soldMilli: 2500,
      netMinor: 12_000,
      taxes: [],
      priorReturnedMilli: 0
    }
    // 0.5 kg of 2.5 kg at ₹120.00 total
    expect(quoteReturn([rice], [request(500, 'restock', 2)], true).creditMinor).toBe(2400)
  })

  it('takes earlier returns into account, and refuses more than is left', () => {
    const earlier: ReturnableItemFacts = { ...SOAP, priorReturnedMilli: 2000 }
    expect(() => quoteReturn([earlier], [request(2000)], true)).toThrow(ReturnError)
    expect(quoteReturn([earlier], [request(1000)], true).creditMinor).toBe(9667)

    const allBack: ReturnableItemFacts = { ...SOAP, priorReturnedMilli: 3000 }
    expect(() => quoteReturn([allBack], [request(1)], true)).toThrow(/already been returned/)
  })

  it('counts the lines of one request together against what was sold', () => {
    try {
      quoteReturn([SOAP], [request(2000), request(2000, 'write_off')], true)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ReturnError)
      expect((error as ReturnError).line).toBe(1)
    }
  })

  it('rejects an empty return, a zero quantity and an item from another invoice', () => {
    expect(() => quoteReturn([SOAP], [], true)).toThrow('Choose at least one item')
    expect(() => quoteReturn([SOAP], [request(0)], true)).toThrow('above zero')
    expect(() => quoteReturn([SOAP], [request(1000, 'restock', 99)], true)).toThrow(
      'not on this invoice'
    )
  })

  it('quotes several items together', () => {
    const rice: ReturnableItemFacts = {
      saleItemId: 2,
      soldMilli: 1000,
      netMinor: 6000,
      taxes: GST(286),
      priorReturnedMilli: 0
    }
    const quote = quoteReturn([SOAP, rice], [request(1000), request(1000, 'quarantine', 2)], true)
    expect(quote.creditMinor).toBe(9667 + 6000)
    expect(quote.lines.map((l) => l.saleItemId)).toEqual([1, 2])
  })
})

describe('checkRefunds', () => {
  it('reports what is allocated and what is still to give back', () => {
    expect(checkRefunds(10_000, [{ amountMinor: 6000 }, { amountMinor: 3000 }])).toEqual({
      allocatedMinor: 9000,
      remainingMinor: 1000
    })
    expect(checkRefunds(10_000, [{ amountMinor: 11_000 }]).remainingMinor).toBe(-1000)
  })
})
