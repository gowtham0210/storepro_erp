import { useEffect, useState } from 'react'

/** A value that follows `value` after it has stopped changing, e.g. to search once typing pauses. */
export function useSettled<T>(value: T, delayMs = 200): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}
