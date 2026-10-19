import { describe, expect, it } from 'vitest'
import { createTestLogger } from '../test/helpers'
import { ShutdownCoordinator } from './shutdown'

describe('ShutdownCoordinator', () => {
  it('runs hooks in reverse registration order', async () => {
    const order: string[] = []
    const shutdown = new ShutdownCoordinator({ logger: createTestLogger() })
    shutdown.register('marker', () => void order.push('marker'))
    shutdown.register('database', async () => void order.push('database'))
    shutdown.register('ipc', () => void order.push('ipc'))
    await shutdown.run('test')
    expect(order).toEqual(['ipc', 'database', 'marker'])
  })

  it('continues after a hook fails or times out', async () => {
    const order: string[] = []
    const logger = createTestLogger()
    const shutdown = new ShutdownCoordinator({ logger, hookTimeoutMs: 20 })
    shutdown.register('last', () => void order.push('last'))
    shutdown.register('hangs', () => new Promise(() => {}))
    shutdown.register('throws', () => {
      throw new Error('boom')
    })
    await shutdown.run('test')
    expect(order).toEqual(['last'])
    expect(logger.error).toHaveBeenCalledTimes(2)
  })

  it('runs hooks only once even if triggered repeatedly', async () => {
    let runs = 0
    const shutdown = new ShutdownCoordinator({ logger: createTestLogger() })
    shutdown.register('count', () => void runs++)
    await Promise.all([shutdown.run('quit'), shutdown.run('session-end')])
    await shutdown.run('quit')
    expect(runs).toBe(1)
    expect(shutdown.isShuttingDown).toBe(true)
    expect(() => shutdown.register('late', () => {})).toThrow()
  })
})
