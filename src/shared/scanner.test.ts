import { describe, expect, it } from 'vitest'
import {
  buildWeighBarcode,
  computeEan13CheckDigit,
  isValidEan13,
  parseWeighBarcode,
  ScannerBurstDetector
} from './scanner'

describe('ScannerBurstDetector (M21-01)', () => {
  it('detects rapid hardware scanner keystroke bursts ending in Enter', () => {
    const detector = new ScannerBurstDetector()
    const code = '8901262010016'
    let t = 1000
    for (const ch of code) {
      const step = detector.feed({ key: ch, timestampMs: t })
      expect(step.barcode).toBeNull()
      t += 12 // 12 ms per keystroke (typical USB HID scanner speed)
    }
    const done = detector.feed({ key: 'Enter', timestampMs: t })
    expect(done).toEqual({
      barcode: '8901262010016',
      consumedTerminator: true
    })
  })

  it('ignores slow human typing and resets on modifier keys', () => {
    const detector = new ScannerBurstDetector()
    let t = 1000
    for (const ch of '89012620') {
      detector.feed({ key: ch, timestampMs: t })
      t += 120 // 120 ms between keys = manual typing
    }
    const result = detector.feed({ key: 'Enter', timestampMs: t })
    expect(result).toEqual({ barcode: null, consumedTerminator: false })

    // Modifier keys clear buffer
    detector.feed({ key: '1', timestampMs: 2000 })
    detector.feed({ key: '2', timestampMs: 2010 })
    detector.feed({ key: 'v', timestampMs: 2020, ctrlKey: true })
    detector.feed({ key: '3', timestampMs: 2030 })
    detector.feed({ key: '4', timestampMs: 2040 })
    expect(detector.feed({ key: 'Enter', timestampMs: 2050 }).barcode).toBeNull()
  })
})

describe('Variable-weight EAN-13 barcode parsing (M24-02)', () => {
  it('computes EAN-13 check digits and round-trips weight and price scale barcodes', () => {
    // Prefix 20 (weight), item 00007, 750 g (00750 milli-units)
    const weightCode = buildWeighBarcode('20', 7, 750)
    expect(weightCode).toHaveLength(13)
    expect(isValidEan13(weightCode)).toBe(true)
    expect(computeEan13CheckDigit(weightCode.slice(0, 12))).toBe(Number(weightCode[12]))

    const parsedWeight = parseWeighBarcode(weightCode)
    expect(parsedWeight).toEqual({
      kind: 'weight',
      rawBarcode: weightCode,
      prefix: '20',
      itemCode: '00007',
      quantityMilli: 750
    })

    // Prefix 21 (price), item 00012, 18500 minor units (₹185.00)
    const priceCode = buildWeighBarcode('21', 'ITEM-00012', 18_500)
    expect(isValidEan13(priceCode)).toBe(true)
    const parsedPrice = parseWeighBarcode(priceCode)
    expect(parsedPrice).toEqual({
      kind: 'price',
      rawBarcode: priceCode,
      prefix: '21',
      itemCode: '00012',
      amountMinor: 18_500
    })
  })

  it('rejects invalid check digits, regular EAN-13 barcodes, or disabled config', () => {
    const valid = buildWeighBarcode('20', 3, 1250)
    const corrupted = valid.slice(0, 12) + String((Number(valid[12]) + 1) % 10)
    expect(parseWeighBarcode(corrupted)).toBeNull()
    expect(parseWeighBarcode('8901052001012')).toBeNull()
    expect(
      parseWeighBarcode(valid, { enabled: false, weightPrefix: '20', pricePrefix: '21' })
    ).toBeNull()
  })
})
