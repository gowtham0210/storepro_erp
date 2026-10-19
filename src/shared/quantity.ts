/**
 * Quantities are integers in thousandths of the unit (`*_milli`):
 * 1.250 kg = 1250, 3 pcs = 3000. Three decimal places cover grams in a
 * kilogram and millilitres in a litre.
 */

export const QUANTITY_SCALE = 1000
const MAX_QUANTITY_MILLI = 1_000_000_000

export interface QuantityRules {
  /** Whether the unit can be sold in fractions (kg: yes, pcs: no). */
  allowsFraction: boolean
}

export function assertQuantity(milli: number, rules: QuantityRules): void {
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli > MAX_QUANTITY_MILLI) {
    throw new RangeError(
      `Quantity must be greater than zero and at most ${MAX_QUANTITY_MILLI / QUANTITY_SCALE}`
    )
  }
  if (!rules.allowsFraction && milli % QUANTITY_SCALE !== 0) {
    throw new RangeError('This unit can only be sold in whole numbers')
  }
}

/** Parse user input ("1.25", "2", "0.5") into thousandths. Validates against the unit's rules. */
export function parseQuantity(input: string, rules: QuantityRules): number {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(input.trim())
  if (!match) throw new RangeError(`Not a valid quantity: "${input}"`)
  const [, whole = '', fraction = ''] = match
  if (fraction.length > 3) throw new RangeError('At most 3 decimal places are allowed')
  const milli = Number(whole) * QUANTITY_SCALE + Number(fraction.padEnd(3, '0'))
  assertQuantity(milli, rules)
  return milli
}

/** Whole units → thousandths: 3 → 3000. */
export function fromWholeUnits(units: number): number {
  if (!Number.isSafeInteger(units)) throw new RangeError('units must be an integer')
  return units * QUANTITY_SCALE
}

/** Display form without trailing zeros: 1250 → "1.25", 3000 → "3", -500 → "-0.5". */
export function formatQuantity(milli: number): string {
  if (!Number.isSafeInteger(milli)) throw new RangeError('quantity must be an integer')
  const sign = milli < 0 ? '-' : ''
  const abs = Math.abs(milli)
  const whole = Math.floor(abs / QUANTITY_SCALE)
  const fraction = (abs % QUANTITY_SCALE).toString().padStart(3, '0').replace(/0+$/, '')
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`
}
