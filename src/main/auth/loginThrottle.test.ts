import { describe, expect, it } from 'vitest'
import { useMigratedDb } from '../db/test/testDb'
import { LoginThrottle } from './loginThrottle'

describe('LoginThrottle', () => {
  const getDb = useMigratedDb()

  function setup() {
    const clock = { time: 1_000_000, now: () => clock.time }
    return { throttle: new LoginThrottle(getDb(), clock), clock }
  }

  it('allows five failures, then blocks with doubling waits up to 15 minutes', () => {
    const { throttle } = setup()
    for (let i = 0; i < 4; i++) throttle.recordFailure('cashier1')
    expect(throttle.retryAfterMs('cashier1')).toBe(0)
    throttle.recordFailure('cashier1')
    expect(throttle.retryAfterMs('cashier1')).toBe(30_000)
    throttle.recordFailure('cashier1')
    expect(throttle.retryAfterMs('cashier1')).toBe(60_000)
    for (let i = 0; i < 10; i++) throttle.recordFailure('cashier1')
    expect(throttle.retryAfterMs('cashier1')).toBe(15 * 60_000)
  })

  it('counts down with time and treats usernames case-insensitively', () => {
    const { throttle, clock } = setup()
    for (let i = 0; i < 5; i++) throttle.recordFailure('Cashier1 ')
    clock.time += 10_000
    expect(throttle.retryAfterMs('cashier1')).toBe(20_000)
    clock.time += 20_000
    expect(throttle.retryAfterMs('CASHIER1')).toBe(0)
  })

  it('forgets old failures and clears on success', () => {
    const { throttle, clock } = setup()
    for (let i = 0; i < 4; i++) throttle.recordFailure('owner')
    clock.time += 61 * 60_000
    throttle.recordFailure('owner')
    expect(throttle.retryAfterMs('owner')).toBe(0) // count restarted at 1
    for (let i = 0; i < 6; i++) throttle.recordFailure('owner')
    throttle.clear('owner')
    expect(throttle.retryAfterMs('owner')).toBe(0)
  })

  it('survives a restart because counters are stored', () => {
    const { throttle, clock } = setup()
    for (let i = 0; i < 5; i++) throttle.recordFailure('owner')
    const afterRestart = new LoginThrottle(getDb(), clock)
    expect(afterRestart.retryAfterMs('owner')).toBe(30_000)
  })
})
