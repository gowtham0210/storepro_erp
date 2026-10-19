import { useEffect, useState } from 'react'

const format = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit'
})

/** Date and time at the counter; bills are often checked against it. */
export function Clock(): React.JSX.Element {
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
