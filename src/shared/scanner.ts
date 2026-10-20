/**
 * Barcode scanner input detection (M21-01) and variable-weight EAN-13 barcode
 * parsing for grocery scales (M24-02).
 *
 * Pure and dependency-free so both main and renderer can import it.
 */

export interface ScannerBurstOptions {
  /** Maximum gap (ms) between consecutive keystrokes in a scanner burst. Default 45 ms. */
  maxInterKeyMs?: number
  /** Maximum total duration (ms) for an entire barcode burst. Default 600 ms. */
  maxTotalBurstMs?: number
  /** Minimum character count to qualify as a scanned barcode. Default 4. */
  minLength?: number
}

export interface KeystrokeSample {
  key: string
  timestampMs: number
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

export interface BurstDetectionResult {
  /** Non-null when a terminator key completed a valid scanner burst. */
  barcode: string | null
  /** True when the keystroke was part of a rapid burst terminator and should be consumed. */
  consumedTerminator: boolean
}

/**
 * Stateful detector that distinguishes a hardware keyboard-wedge barcode
 * scanner (fast burst of printable ASCII characters ending in Enter/Tab) from
 * ordinary human typing (M21-01).
 */
export class ScannerBurstDetector {
  private readonly maxInterKeyMs: number
  private readonly maxTotalBurstMs: number
  private readonly minLength: number
  private buffer = ''
  private firstKeyAtMs = 0
  private lastKeyAtMs = 0

  constructor(options: ScannerBurstOptions = {}) {
    this.maxInterKeyMs = options.maxInterKeyMs ?? 45
    this.maxTotalBurstMs = options.maxTotalBurstMs ?? 600
    this.minLength = options.minLength ?? 4
  }

  reset(): void {
    this.buffer = ''
    this.firstKeyAtMs = 0
    this.lastKeyAtMs = 0
  }

  feed(sample: KeystrokeSample): BurstDetectionResult {
    if (sample.ctrlKey || sample.altKey || sample.metaKey) {
      this.reset()
      return { barcode: null, consumedTerminator: false }
    }

    const { key, timestampMs } = sample
    const gap = timestampMs - this.lastKeyAtMs

    if (key === 'Enter' || key === 'Tab') {
      const totalDuration = timestampMs - this.firstKeyAtMs
      if (
        this.buffer.length >= this.minLength &&
        gap <= this.maxInterKeyMs &&
        totalDuration <= this.maxTotalBurstMs
      ) {
        const scanned = this.buffer.trim()
        this.reset()
        if (scanned.length >= this.minLength) {
          return { barcode: scanned, consumedTerminator: true }
        }
      }
      this.reset()
      return { barcode: null, consumedTerminator: false }
    }

    // Ignore non-printable keys like Shift, CapsLock, F-keys, Arrow keys.
    if (key.length !== 1 || key < ' ' || key > '~') {
      return { barcode: null, consumedTerminator: false }
    }

    if (this.buffer.length === 0 || gap > this.maxInterKeyMs) {
      this.buffer = key
      this.firstKeyAtMs = timestampMs
      this.lastKeyAtMs = timestampMs
      return { barcode: null, consumedTerminator: false }
    }

    this.buffer += key
    this.lastKeyAtMs = timestampMs
    return { barcode: null, consumedTerminator: false }
  }
}

// ===========================================================================
// Variable-weight / embedded-price EAN-13 barcodes (M24-02)
// ===========================================================================

export interface WeighBarcodeConfig {
  enabled: boolean
  /** 2-digit prefix for barcodes embedding weight in grams/millilitres (default "20"). */
  weightPrefix: string
  /** 2-digit prefix for barcodes embedding total line price in whole currency units or minor units (default "21"). */
  pricePrefix: string
}

export const DEFAULT_WEIGH_BARCODE_CONFIG: WeighBarcodeConfig = {
  enabled: true,
  weightPrefix: '20',
  pricePrefix: '21'
}

export type ParsedWeighBarcode =
  | {
      kind: 'weight'
      rawBarcode: string
      prefix: string
      /** 5-digit item code from positions 3..7 (e.g. "00001"). */
      itemCode: string
      /** Embedded weight/volume in milli-units (e.g. 750 = 0.750 kg). */
      quantityMilli: number
    }
  | {
      kind: 'price'
      rawBarcode: string
      prefix: string
      /** 5-digit item code from positions 3..7 (e.g. "00001"). */
      itemCode: string
      /** Embedded value (5 digits, interpreted as minor units of currency, e.g. 15000 = ₹150.00). */
      amountMinor: number
    }

/** Computes the modulo-10 check digit for the first 12 digits of an EAN-13 barcode. */
export function computeEan13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) {
    throw new Error('EAN-13 check digit requires exactly 12 digits')
  }
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const digit = first12.charCodeAt(i) - 48
    sum += i % 2 === 0 ? digit : digit * 3
  }
  return (10 - (sum % 10)) % 10
}

/** Validates the check digit of a 13-digit EAN-13 barcode. */
export function isValidEan13(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false
  const expected = computeEan13CheckDigit(barcode.slice(0, 12))
  const actual = barcode.charCodeAt(12) - 48
  return expected === actual
}

/**
 * Builds a 13-digit variable-weight or embedded-price EAN-13 barcode with a
 * valid modulo-10 check digit: `PP IIIII VVVVV C`.
 */
export function buildWeighBarcode(
  prefix: string,
  itemCode: string | number,
  embeddedValue: number
): string {
  if (!/^\d{2}$/.test(prefix)) {
    throw new Error('Weigh barcode prefix must be 2 digits')
  }
  const normalizedItem = String(itemCode).replace(/\D/g, '').padStart(5, '0').slice(-5)
  if (normalizedItem.length !== 5 || Number(normalizedItem) <= 0) {
    throw new Error('Item code must be a positive 1–5 digit number')
  }
  if (!Number.isInteger(embeddedValue) || embeddedValue <= 0 || embeddedValue > 99_999) {
    throw new Error('Embedded value must be an integer between 1 and 99999')
  }
  const valuePart = String(embeddedValue).padStart(5, '0')
  const first12 = `${prefix}${normalizedItem}${valuePart}`
  const check = computeEan13CheckDigit(first12)
  return `${first12}${check}`
}

/**
 * Parses a 13-digit EAN-13 barcode against the store's variable-weight prefix
 * rules (M24-02). Returns `null` if the barcode is not a valid variable-weight
 * barcode or if variable-weight barcodes are disabled.
 */
export function parseWeighBarcode(
  barcode: string,
  config: WeighBarcodeConfig = DEFAULT_WEIGH_BARCODE_CONFIG
): ParsedWeighBarcode | null {
  if (!config.enabled) return null
  const trimmed = barcode.trim()
  if (!isValidEan13(trimmed)) return null

  const prefix = trimmed.slice(0, 2)
  const itemCode = trimmed.slice(2, 7)
  const valueDigits = Number(trimmed.slice(7, 12))
  if (Number(itemCode) <= 0 || valueDigits <= 0) return null

  if (prefix === config.weightPrefix) {
    return {
      kind: 'weight',
      rawBarcode: trimmed,
      prefix,
      itemCode,
      quantityMilli: valueDigits
    }
  }

  if (prefix === config.pricePrefix) {
    return {
      kind: 'price',
      rawBarcode: trimmed,
      prefix,
      itemCode,
      amountMinor: valueDigits
    }
  }

  return null
}
