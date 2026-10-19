import { useEffect, useMemo, useState } from 'react'
import { useStoreTimeZone } from '../store/storeContext'

/**
 * Date and time at the store, in its time zone (not the computer's), the
 * same time bills will show. Bills are often checked against it.
 */
export function Clock(): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone
      }),
    [timeZone]
  )
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <time dateTime={now.toISOString()} className="text-sm text-fg-muted tabular">
      {format.format(now)}
    </time>
  )
}
