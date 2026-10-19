import { useCallback, useEffect, useState } from 'react'

/**
 * A whole-second countdown: `start(ms)` begins it, the first value is the
 * number of seconds left, and it ticks down to 0.
 */
export function useCountdown(): [seconds: number, start: (ms: number) => void] {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])
  const start = useCallback((ms: number) => setSeconds(Math.max(0, Math.ceil(ms / 1000))), [])
  return [seconds, start]
}

export function formatWait(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60)
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}
