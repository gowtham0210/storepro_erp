/** Source of the current time, injectable so tests and services are deterministic. */
export interface Clock {
  /** Unix epoch milliseconds (UTC). */
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }
