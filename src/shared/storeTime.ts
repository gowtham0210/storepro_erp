/**
 * Dates and times in the store's time zone (M03-05).
 *
 * Timestamps are stored as UTC epoch milliseconds (`*_at`). What counts as
 * "today", which day a sale belongs to, and the times printed on invoices all
 * depend on where the store is, not on the computer's clock settings. These
 * helpers do that conversion for reports, invoices and filters, and handle
 * daylight-saving days (23 or 25 hours long) and half-hour offsets.
 *
 * A business date is a calendar date string, YYYY-MM-DD, like the schema's
 * `*_date` columns.
 *
 * Runtime-dependency free (Intl only): used by both processes.
 */

export type BusinessDate = string

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    partsFormatters.set(timeZone, formatter)
  }
  return formatter
}

/**
 * Zones that were renamed in the IANA database. Chromium and Node still report
 * some by their old names ("Asia/Calcutta"), which people no longer recognise.
 */
const RENAMED_ZONES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Asia/Ujung_Pandang': 'Asia/Makassar',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Enderbury': 'Pacific/Kanton'
}

/** The current IANA name of a zone ("Asia/Kolkata" for "Asia/Calcutta"), if this runtime knows it. */
export function canonicalTimeZone(timeZone: string): string {
  const renamed = RENAMED_ZONES[timeZone]
  return renamed !== undefined && isValidTimeZone(renamed) ? renamed : timeZone
}

/** True if this runtime knows the IANA time zone, e.g. "Asia/Kolkata". */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0 || timeZone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** The wall-clock fields of an instant in a time zone. */
function wallClock(epochMs: number, timeZone: string) {
  const parts: Record<string, number> = {}
  for (const part of partsFormatter(timeZone).formatToParts(epochMs)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return {
    year: parts['year'] ?? 0,
    month: parts['month'] ?? 1,
    day: parts['day'] ?? 1,
    hour: parts['hour'] ?? 0,
    minute: parts['minute'] ?? 0,
    second: parts['second'] ?? 0
  }
}

/** Offset of the time zone from UTC at an instant, in milliseconds (IST is +19,800,000). */
export function timeZoneOffsetMs(epochMs: number, timeZone: string): number {
  const w = wallClock(epochMs, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return asUtc - Math.floor(epochMs / 1000) * 1000
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function parse(date: BusinessDate): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(date)
  if (!match) throw new RangeError(`Not a date: ${date}`)
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a date: ${date}`)
  }
  return { year, month, day }
}

export function isBusinessDate(value: string): boolean {
  try {
    parse(value)
    return true
  } catch {
    return false
  }
}

/** The calendar date at the store when this instant happened. */
export function businessDateOf(epochMs: number, timeZone: string): BusinessDate {
  const w = wallClock(epochMs, timeZone)
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`
}

/** The date `days` after (or before, if negative) a business date. */
export function addDays(date: BusinessDate, days: number): BusinessDate {
  const { year, month, day } = parse(date)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/**
 * The first instant of a business date at the store: local midnight, or the
 * first moment after it on a day when the clocks skip midnight.
 */
export function startOfBusinessDay(date: BusinessDate, timeZone: string): number {
  const { year, month, day } = parse(date)
  const midnightAsUtc = Date.UTC(year, month - 1, day)
  // Guess with the offset at UTC midnight, then correct with the offset at
  // the guess; twice covers a DST change near midnight.
  let guess = midnightAsUtc - timeZoneOffsetMs(midnightAsUtc, timeZone)
  for (let i = 0; i < 2; i++) guess = midnightAsUtc - timeZoneOffsetMs(guess, timeZone)
  // If midnight doesn't exist (clocks jumped past it), the guess lands on the
  // previous day: step forward to where the date begins.
  while (businessDateOf(guess, timeZone) < date) guess += 15 * 60_000
  // And never later than the day's first minute.
  for (let i = 0; i < 120 && businessDateOf(guess - 60_000, timeZone) === date; i++) guess -= 60_000
  return guess
}

/** [from, to) instants covering business dates `first` to `last`, both included. */
export function businessDayRange(
  first: BusinessDate,
  last: BusinessDate,
  timeZone: string
): { from: number; to: number } {
  return {
    from: startOfBusinessDay(first, timeZone),
    to: startOfBusinessDay(addDays(last, 1), timeZone)
  }
}

const displayFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * An instant as people at the store read it, e.g. "19 Oct 2026, 10:00 am"
 * (`dateTime`), "19 Oct 2026" (`date`) or "10:00:05 am" (`time`).
 */
export function formatStoreTime(
  epochMs: number,
  timeZone: string,
  style: 'dateTime' | 'dateTimeSeconds' | 'date' | 'time' = 'dateTime',
  locale = 'en-IN'
): string {
  const key = `${locale}|${timeZone}|${style}`
  let formatter = displayFormatters.get(key)
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions =
      style === 'date'
        ? { dateStyle: 'medium' }
        : style === 'time'
          ? { timeStyle: 'medium' }
          : style === 'dateTimeSeconds'
            ? { dateStyle: 'medium', timeStyle: 'medium' }
            : { dateStyle: 'medium', timeStyle: 'short' }
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone })
    displayFormatters.set(key, formatter)
  }
  return formatter.format(epochMs)
}
