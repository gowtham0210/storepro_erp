import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEventPublisher } from '../ipc/events'
import { createTestLogger } from '../test/helpers'
import { ConnectivityMonitor } from './connectivityMonitor'

function setup(initiallyOnline = true) {
  const network = { online: initiallyOnline }
  const clock = { time: 1_000, now: () => clock.time }
  const logger = createTestLogger()
  const monitor = new ConnectivityMonitor({
    isOnline: () => network.online,
    clock,
    logger,
    intervalMs: 1_000
  })
  return { network, clock, logger, monitor }
}

afterEach(() => vi.useRealTimers())

describe('ConnectivityMonitor (M08-01)', () => {
  it('reports the state it starts in', () => {
    expect(setup(false).monitor.status()).toEqual({
      online: false,
      changedAt: 1_000,
      checkedAt: 1_000
    })
  })

  it('tells listeners only when the state changes, and logs it', () => {
    const { network, clock, logger, monitor } = setup()
    const listener = vi.fn()
    monitor.onChange(listener)

    clock.time = 2_000
    monitor.check()
    expect(listener).not.toHaveBeenCalled()
    expect(monitor.status()).toEqual({ online: true, changedAt: 1_000, checkedAt: 2_000 })

    network.online = false
    clock.time = 3_000
    monitor.check()
    expect(listener).toHaveBeenCalledWith({ online: false, changedAt: 3_000, checkedAt: 3_000 })
    expect(logger.info).toHaveBeenCalledWith('Gone offline')

    network.online = true
    monitor.check()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenCalledWith('Back online')
  })

  it('checks on its own while started', () => {
    vi.useFakeTimers()
    const { network, monitor } = setup()
    const listener = vi.fn()
    monitor.onChange(listener)
    monitor.start()
    monitor.start() // idempotent
    network.online = false
    vi.advanceTimersByTime(1_000)
    expect(listener).toHaveBeenCalledTimes(1)
    monitor.stop()
    network.online = true
    vi.advanceTimersByTime(5_000)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('treats an unreadable state as offline', () => {
    const logger = createTestLogger()
    const monitor = new ConnectivityMonitor({
      isOnline: () => {
        throw new Error('no network service')
      },
      clock: { now: () => 0 },
      logger
    })
    expect(monitor.status().online).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('stops telling a listener that unsubscribed', () => {
    const { network, monitor } = setup()
    const listener = vi.fn()
    const stop = monitor.onChange(listener)
    stop()
    network.online = false
    monitor.check()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('createEventPublisher', () => {
  it("sends declared events to the app's windows that are still open", () => {
    const open = { isDestroyed: () => false, send: vi.fn() }
    const closed = { isDestroyed: () => true, send: vi.fn() }
    const publish = createEventPublisher(() => [open, closed])
    const status = { online: false, changedAt: 1, checkedAt: 1 }
    publish('connectivity:changed', status)
    expect(open.send).toHaveBeenCalledWith('connectivity:changed', status)
    expect(closed.send).not.toHaveBeenCalled()
  })
})
