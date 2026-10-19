/**
 * Tax classes: the rates products are taxed at (M09, M10).
 *
 * The Indian defaults are the GST slabs in force since 22 September 2025
 * (GST 2.0: 5% and 18%, 40% for luxury and sin goods, plus exempt goods).
 * They are PROVISIONAL until a GST practitioner confirms them (M10-07, PRD
 * §15); docs/pricing-and-tax.md records the open questions. Administrators
 * can add, change and archive classes in Settings → Tax rates.
 *
 * Migration 0005 seeds the same classes for stores set up before it.
 *
 * Runtime-dependency free: used by both processes.
 */

export interface DefaultTaxClass {
  name: string
  rateBp: number
  cessRateBp: number
}

const INDIA: readonly DefaultTaxClass[] = [
  { name: 'GST 0% (exempt)', rateBp: 0, cessRateBp: 0 },
  { name: 'GST 5%', rateBp: 500, cessRateBp: 0 },
  { name: 'GST 18%', rateBp: 1800, cessRateBp: 0 },
  { name: 'GST 40%', rateBp: 4000, cessRateBp: 0 }
]

const ELSEWHERE: readonly DefaultTaxClass[] = [{ name: 'No tax', rateBp: 0, cessRateBp: 0 }]

/** The classes a new store starts with. Every store needs at least one: products must have a class. */
export function defaultTaxClasses(countryCode: string): readonly DefaultTaxClass[] {
  return countryCode === 'IN' ? INDIA : ELSEWHERE
}

/** A rate in basis points as people write it: 1800 → "18%", 250 → "2.5%". */
export function formatRate(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100)
  const fraction = Math.abs(rateBp % 100)
    .toString()
    .padStart(2, '0')
    .replace(/0+$/, '')
  return `${rateBp < 0 && whole === 0 ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}%`
}
