/**
 * Money is always an integer number of minor units (paise for INR). Floating
 * point is never used for amounts.
 *
 * Rounding rule everywhere: half away from zero (₹0.005 → ₹0.01). The database
 * views use the same rule for line amounts; keep them in sync.
 */

export interface CurrencyFormat {
  currencyCode: string
  minorUnits: number
}

/** Until the store is set up, amounts are shown in rupees. */
export const DEFAULT_CURRENCY: CurrencyFormat = { currencyCode: 'INR', minorUnits: 2 }

export const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER

export function assertMinorUnits(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a whole number of minor units, got ${value}`)
  }
}

/** Integer division of BigInts, rounding half away from zero. */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero')
  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const quotient = (n * 2n + d) / (d * 2n)
  return negative ? -quotient : quotient
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(MAX_SAFE_MINOR) || value < -BigInt(MAX_SAFE_MINOR)) {
    throw new RangeError(`${label} is too large`)
  }
  return Number(value)
}

/**
 * Parse a user-entered amount ("1,250.5", "₹ 99", "-10") into minor units.
 * Rejects more decimal places than the currency has, rather than rounding.
 */
export function parseMoney(input: string, minorUnits: number): number {
  const cleaned = input.replace(/[\s,₹$]/g, '')
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(cleaned)
  if (!match) throw new RangeError(`Not a valid amount: "${input}"`)
  const [, sign, whole = '', fraction = ''] = match
  if (fraction.length > minorUnits) {
    throw new RangeError(`At most ${minorUnits} decimal places are allowed: "${input}"`)
  }
  const digits = whole + fraction.padEnd(minorUnits, '0')
  const value = toSafeNumber(BigInt(digits), 'Amount')
  return sign && value !== 0 ? -value : value
}

/** Plain decimal string without grouping or symbol, e.g. 123450 → "1234.50". */
export function toDecimalString(minor: number, minorUnits: number): string {
  assertMinorUnits(minor)
  const negative = minor < 0
  const digits = Math.abs(minor)
    .toString()
    .padStart(minorUnits + 1, '0')
  const whole = minorUnits === 0 ? digits : digits.slice(0, -minorUnits)
  const fraction = minorUnits === 0 ? '' : `.${digits.slice(-minorUnits)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** Localised display string, e.g. 123450 → "₹1,234.50" for en-IN. */
export function formatMoney(minor: number, currency: CurrencyFormat, locale = 'en-IN'): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.currencyCode,
    minimumFractionDigits: currency.minorUnits,
    maximumFractionDigits: currency.minorUnits
  })
  // Intl accepts decimal strings exactly, avoiding float conversion.
  return formatter.format(toDecimalString(minor, currency.minorUnits) as unknown as number)
}

/** unit price × quantity (in thousandths), rounded to the minor unit. */
export function multiplyByQuantity(unitPriceMinor: number, quantityMilli: number): number {
  assertMinorUnits(unitPriceMinor, 'unit price')
  if (!Number.isSafeInteger(quantityMilli)) throw new RangeError('quantity must be an integer')
  return toSafeNumber(
    divideRounded(BigInt(unitPriceMinor) * BigInt(quantityMilli), 1000n),
    'Line amount'
  )
}

/** A percentage of an amount; the rate is in basis points (18% = 1800). */
export function applyRate(amountMinor: number, rateBp: number): number {
  assertMinorUnits(amountMinor)
  if (!Number.isSafeInteger(rateBp))
    throw new RangeError('rate must be an integer number of basis points')
  return toSafeNumber(divideRounded(BigInt(amountMinor) * BigInt(rateBp), 10_000n), 'Amount')
}

/**
 * The tax contained in a tax-inclusive amount: amount × rate / (1 + rate).
 * E.g. ₹118.00 at 18% contains ₹18.00.
 */
export function taxIncludedIn(amountMinor: number, rateBp: number): number {
  assertMinorUnits(amountMinor)
  return toSafeNumber(
    divideRounded(BigInt(amountMinor) * BigInt(rateBp), 10_000n + BigInt(rateBp)),
    'Amount'
  )
}

/**
 * Split an amount in proportion to weights so the parts always add up to the
 * total exactly (largest-remainder method). Used to spread a bill discount
 * over its lines. Ties go to the earlier weight.
 */
export function allocate(totalMinor: number, weights: readonly number[]): number[] {
  assertMinorUnits(totalMinor)
  if (weights.length === 0) throw new RangeError('allocate needs at least one weight')
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    throw new RangeError('weights must be non-negative integers')
  }
  const weightSum = weights.reduce((sum, w) => sum + BigInt(w), 0n)
  if (weightSum === 0n) throw new RangeError('weights must not all be zero')

  const total = BigInt(Math.abs(totalMinor))
  const shares = weights.map((w) => (total * BigInt(w)) / weightSum)
  const remainders = weights.map((w, index) => ({
    index,
    remainder: (total * BigInt(w)) % weightSum
  }))
  let left = total - shares.reduce((sum, share) => sum + share, 0n)
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
  )
  for (const { index } of remainders) {
    if (left === 0n) break
    shares[index] = (shares[index] ?? 0n) + 1n
    left--
  }
  const sign = totalMinor < 0 ? -1 : 1
  return shares.map((share) => sign * Number(share))
}
