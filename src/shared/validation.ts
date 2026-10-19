/**
 * Zod building blocks shared by renderer forms and main-process handlers, so
 * a rule (and its wording) is written once.
 *
 * Numeric fields accept either the text a person typed ("12.50") or the
 * number the renderer sends over IPC (1250), and always produce the domain
 * value: minor units for money, thousandths for quantities. The renderer
 * validates the typed text with the same schema the handler applies again.
 *
 * Messages are written for the person at the counter: what to do, not what failed.
 */
import { z } from 'zod'
import { parseMoney } from './money'
import { parseQuantity, assertQuantity, type QuantityRules } from './quantity'

export function requiredText(label: string, maxLength = 200) {
  return z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .max(maxLength, `${capitalise(label)} must be ${maxLength} characters or fewer`)
}

export function optionalText(label: string, maxLength = 500) {
  return z
    .string()
    .trim()
    .max(maxLength, `${capitalise(label)} must be ${maxLength} characters or fewer`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
}

interface MoneyRules {
  minorUnits?: number
  /** Inclusive bounds, in minor units. */
  min?: number
  max?: number
}

export function money(
  label: string,
  { minorUnits = 2, min = 0, max = 1_000_000_000 }: MoneyRules = {}
) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      if (typeof value === 'number') {
        if (Number.isSafeInteger(value)) return value
        ctx.addIssue({
          code: 'custom',
          message: `${capitalise(label)} must be a whole number of minor units`
        })
        return z.NEVER
      }
      if (value.trim() === '') {
        ctx.addIssue({ code: 'custom', message: `Enter ${label}` })
        return z.NEVER
      }
      try {
        return parseMoney(value, minorUnits)
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: `Enter ${label} as an amount, e.g. ${minorUnits > 0 ? `12.${'5'.padEnd(minorUnits, '0')}` : '12'}`
        })
        return z.NEVER
      }
    })
    .pipe(
      z
        .number()
        .min(min, `${capitalise(label)} can't be less than ${formatPlain(min, minorUnits)}`)
        .max(max, `${capitalise(label)} can't be more than ${formatPlain(max, minorUnits)}`)
    )
}

/** Money that may be left empty: '' and null both mean "none". */
export function optionalMoney(label: string, rules: MoneyRules = {}) {
  return z.union([z.null(), z.literal('').transform(() => null), money(label, rules)])
}

/** A quantity that may be left empty: '' and null both mean "none". */
export function optionalQuantity(label: string, rules: QuantityRules) {
  return z.union([z.null(), z.literal('').transform(() => null), quantity(label, rules)])
}

export function quantity(label: string, rules: QuantityRules) {
  return z.union([z.string(), z.number()]).transform((value, ctx) => {
    try {
      if (typeof value === 'number') {
        assertQuantity(value, rules)
        return value
      }
      if (value.trim() === '') throw new RangeError(`Enter ${label}`)
      return parseQuantity(value, rules)
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof RangeError ? error.message : `Check ${label}`
      })
      return z.NEVER
    }
  })
}

export function optionalEmail() {
  return z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .pipe(z.email('Enter an email address like name@example.com').nullable())
}

/** Indian and international numbers: digits, spaces, +, - and brackets; 7–15 digits. */
export function phone(label = 'a phone number') {
  return z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .refine((value) => /^[+()\d\s-]+$/.test(value), 'Use digits, spaces, + and - only')
    .refine((value) => {
      const digits = value.replace(/\D/g, '').length
      return digits >= 7 && digits <= 15
    }, 'Phone numbers have 7 to 15 digits')
}

function capitalise(text: string): string {
  const stripped = text.replace(/^(a|an|the) /, '')
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

function formatPlain(minor: number, minorUnits: number): string {
  return minorUnits === 0 ? String(minor) : (minor / 10 ** minorUnits).toFixed(minorUnits)
}
