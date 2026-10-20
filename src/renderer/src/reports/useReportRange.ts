import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { MAX_REPORT_DAYS } from '@shared/reports'
import { addDays, businessDateOf, isBusinessDate } from '@shared/storeTime'
import { useStoreTimeZone } from '../store/storeContext'

export interface ReportRangeState {
  from: string
  to: string
  /** What is wrong with the dates, or null when they can be asked for. */
  error: string | null
  setRange: (from: string, to: string) => void
  /** Today at the store, for presets. */
  today: string
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * The period a report covers, kept in the address (`?from=&to=`) so it
 * survives a reload and a tab change. It starts as today at the store.
 */
export function useReportRange(): ReportRangeState {
  const timeZone = useStoreTimeZone()
  const [params, setParams] = useSearchParams()
  const [today] = useState(() => businessDateOf(Date.now(), timeZone))
  const from = params.get('from') ?? today
  const to = params.get('to') ?? from

  let error: string | null = null
  if (!isBusinessDate(from) || !isBusinessDate(to)) error = 'Enter both dates'
  else if (from > to) error = 'The end date is before the start date'
  else if (daysBetween(from, to) + 1 > MAX_REPORT_DAYS) {
    error = `Choose at most ${MAX_REPORT_DAYS} days at a time`
  }

  const setRange = (nextFrom: string, nextTo: string): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('from', nextFrom)
        next.set('to', nextTo)
        next.delete('page')
        return next
      },
      { replace: true }
    )
  }
  return { from, to, error, setRange, today }
}

/** Common periods, as store dates. */
export function presets(today: string): { id: string; label: string; from: string; to: string }[] {
  const firstOfMonth = `${today.slice(0, 8)}01`
  const lastMonthEnd = addDays(firstOfMonth, -1)
  return [
    { id: 'today', label: 'Today', from: today, to: today },
    { id: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { id: 'week', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { id: 'month', label: 'This month', from: firstOfMonth, to: today },
    {
      id: 'last-month',
      label: 'Last month',
      from: `${lastMonthEnd.slice(0, 8)}01`,
      to: lastMonthEnd
    }
  ]
}
