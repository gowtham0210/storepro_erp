import { describe, expect, it } from 'vitest'
import {
  addDays,
  businessDateOf,
  businessDayRange,
  canonicalTimeZone,
  formatStoreTime,
  isBusinessDate,
  isValidTimeZone,
  startOfBusinessDay,
  timeZoneOffsetMs
} from './storeTime'

const HOUR = 3_600_000

describe('store time (M03-05)', () => {
  it('uses current zone names', () => {
    expect(canonicalTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata')
    expect(canonicalTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(canonicalTimeZone('Europe/London')).toBe('Europe/London')
  })

  it('knows which zones exist', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true)
    expect(isValidTimeZone('Asia/Calcutta')).toBe(true) // an alias some systems report
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it("puts a sale on the store's date, not the computer's", () => {
    // 19:00 UTC on 18 Oct is 00:30 on 19 Oct in India.
    const lateNightUtc = Date.UTC(2026, 9, 18, 19, 0)
    expect(businessDateOf(lateNightUtc, 'Asia/Kolkata')).toBe('2026-10-19')
    expect(businessDateOf(lateNightUtc, 'UTC')).toBe('2026-10-18')
    expect(businessDateOf(lateNightUtc, 'America/New_York')).toBe('2026-10-18')
  })

  it('starts a business day at local midnight, including half- and quarter-hour offsets', () => {
    expect(startOfBusinessDay('2026-10-19', 'Asia/Kolkata')).toBe(Date.UTC(2026, 9, 18, 18, 30))
    expect(startOfBusinessDay('2026-10-19', 'Asia/Kathmandu')).toBe(Date.UTC(2026, 9, 18, 18, 15))
    expect(startOfBusinessDay('2026-10-19', 'UTC')).toBe(Date.UTC(2026, 9, 19))
    expect(timeZoneOffsetMs(Date.UTC(2026, 9, 19), 'Asia/Kolkata')).toBe(5.5 * HOUR)
  })

  it('handles days that are 23 or 25 hours long', () => {
    // US daylight saving: starts 8 Mar 2026, ends 1 Nov 2026.
    const spring = businessDayRange('2026-03-08', '2026-03-08', 'America/New_York')
    expect(spring.to - spring.from).toBe(23 * HOUR)
    const autumn = businessDayRange('2026-11-01', '2026-11-01', 'America/New_York')
    expect(autumn.to - autumn.from).toBe(25 * HOUR)
    expect(spring.from).toBe(Date.UTC(2026, 2, 8, 5)) // midnight EST
  })

  it("starts a day whose midnight doesn't exist at its first moment", () => {
    // Chile moves its clocks from 00:00 to 01:00 on 6 Sep 2026.
    const start = startOfBusinessDay('2026-09-06', 'America/Santiago')
    expect(businessDateOf(start, 'America/Santiago')).toBe('2026-09-06')
    expect(businessDateOf(start - 60_000, 'America/Santiago')).toBe('2026-09-05')
  })

  it('covers a range of days, both ends included', () => {
    const { from, to } = businessDayRange('2026-10-01', '2026-10-31', 'Asia/Kolkata')
    expect(businessDateOf(from, 'Asia/Kolkata')).toBe('2026-10-01')
    expect(businessDateOf(to - 1, 'Asia/Kolkata')).toBe('2026-10-31')
    expect(businessDateOf(to, 'Asia/Kolkata')).toBe('2026-11-01')
    expect((to - from) / (24 * HOUR)).toBe(31)
  })

  it('does date arithmetic on calendar dates', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(isBusinessDate('2026-02-29')).toBe(false)
    expect(isBusinessDate('2026-10-19')).toBe(true)
    expect(() => addDays('19/10/2026', 1)).toThrow(RangeError)
  })

  it('formats times for people at the store', () => {
    const instant = Date.UTC(2026, 9, 19, 4, 30)
    expect(formatStoreTime(instant, 'Asia/Kolkata', 'date')).toBe('19 Oct 2026')
    expect(formatStoreTime(instant, 'Asia/Kolkata')).toMatch(/^19 Oct 2026, 10:00\s?am$/i)
    expect(formatStoreTime(instant, 'Asia/Kolkata', 'time')).toMatch(/^10:00:00\s?am$/i)
    expect(formatStoreTime(instant, 'Asia/Kolkata', 'dateTimeSeconds')).toMatch(/10:00:00/)
  })
})
