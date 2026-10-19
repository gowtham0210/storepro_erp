import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { IPC_CHANNELS } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import type { Actor } from '../auth/access'
import type { Authorizer, HandlerMap } from './serviceHost'
import { createIpcHarness, fakeEvent } from './test/harness'

const appInfo = {
  name: 'StorePro',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  isPackaged: true,
  versions: { electron: '1', chrome: '1', node: '1' }
}

const actor: Actor = {
  userId: 3,
  username: 'meena',
  displayName: 'Meena',
  roleCode: 'cashier',
  permissions: new Set(['sale.create']),
  override: null
}

function handlers(overrides: Partial<HandlerMap> = {}): HandlerMap {
  // Every channel gets a do-nothing handler; the tests below override the ones they use.
  const defaults = Object.fromEntries(
    IPC_CHANNELS.map((channel) => [
      channel,
      { access: 'public', input: z.unknown(), handle: () => undefined }
    ])
  ) as unknown as HandlerMap
  return {
    ...defaults,
    'app:get-info': { access: 'public', input: z.void(), handle: () => appInfo },
    'log:write': {
      access: 'public',
      input: z.object({
        level: z.enum(['debug', 'info', 'warn', 'error']),
        message: z.string().min(1)
      }),
      handle: () => undefined
    },
    ...overrides
  }
}

/** A guarded stand-in: `users:list` needs `user.manage`, which `authorizer` decides about. */
function guarded(
  decide: Authorizer['authorize'],
  extra: { overridable?: true } = {},
  handle = vi.fn(() => [])
) {
  const authorize = vi.fn(decide)
  const harness = createIpcHarness(
    handlers({
      'users:list': {
        access: 'user.manage',
        ...extra,
        input: z.object({ overrideId: z.string().optional() }).optional() as never,
        handle
      }
    }),
    { authorizer: { authorize } }
  )
  return { ...harness, handle, authorize }
}

describe('registerIpcHandlers', () => {
  it('registers every contract channel and can unregister them', () => {
    const { ipc, unregister } = createIpcHarness(handlers())
    expect([...ipc.listeners.keys()].sort()).toEqual([...IPC_CHANNELS].sort())
    unregister()
    expect(ipc.listeners.size).toBe(0)
  })

  it('wraps handler results in an ok envelope', async () => {
    const { send } = createIpcHarness(handlers())
    await expect(send('app:get-info')).resolves.toEqual({ ok: true, data: appInfo })
  })

  it('passes the sender id to the handler', async () => {
    let seenId: number | undefined
    const { send } = createIpcHarness(
      handlers({
        'app:get-info': {
          access: 'public',
          input: z.void(),
          handle: (_input, context) => {
            seenId = context.webContentsId
            return appInfo
          }
        }
      })
    )
    await send('app:get-info')
    expect(seenId).toBe(7)
  })

  it('rejects invalid input before the handler runs', async () => {
    const { send } = createIpcHarness(handlers())
    const result = await send('log:write', { level: 'fatal', message: '' })
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    const details = (result as { error: { details: { path: string }[] } }).error.details
    expect(details.map((issue) => issue.path).sort()).toEqual(['level', 'message'])
  })

  it('rejects calls from untrusted senders', async () => {
    const { send, logger } = createIpcHarness(handlers(), { trusted: false })
    await expect(
      send('app:get-info', undefined, fakeEvent('https://evil.example'))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' }
    })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('returns AppError details to the renderer', async () => {
    const { send } = createIpcHarness(
      handlers({
        'app:get-info': {
          access: 'public',
          input: z.void(),
          handle: () => {
            throw new AppError('NOT_FOUND', 'Nothing here', { id: 1 })
          }
        }
      })
    )
    await expect(send('app:get-info')).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Nothing here', details: { id: 1 } }
    })
  })

  it('hides unexpected errors from the renderer but logs them', async () => {
    const { send, logger } = createIpcHarness(
      handlers({
        'app:get-info': {
          access: 'public',
          input: z.void(),
          handle: async () => {
            throw new Error('SQLITE_CORRUPT at C:\\secret\\path')
          }
        }
      })
    )
    const result = await send('app:get-info')
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    expect(JSON.stringify(result)).not.toContain('SQLITE_CORRUPT')
    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled error in IPC handler',
      expect.objectContaining({ channel: 'app:get-info' })
    )
  })
})

describe('the permission guard', () => {
  it('runs a guarded handler as the authorized actor', async () => {
    const { send, handle } = guarded(() => actor)
    await expect(send('users:list')).resolves.toEqual({ ok: true, data: [] })
    expect(handle).toHaveBeenCalledWith(undefined, { webContentsId: 7, actor })
  })

  it('never runs the handler when authorization fails', async () => {
    const { send, handle } = guarded(() => {
      throw new AppError('FORBIDDEN', 'No', { permission: 'user.manage', overridable: false })
    })
    await expect(send('users:list')).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', details: { permission: 'user.manage' } }
    })
    expect(handle).not.toHaveBeenCalled()
  })

  it('does not consult the authorizer for public channels', async () => {
    const authorize = vi.fn(() => actor)
    const { send } = createIpcHarness(handlers(), { authorizer: { authorize } })
    await send('app:get-info')
    expect(authorize).not.toHaveBeenCalled()
  })

  it('passes the declared access, and an approval id only for overridable channels', async () => {
    const plain = guarded(() => actor)
    await plain.send('users:list', { overrideId: 'abc' })
    const overridable = guarded(() => actor, { overridable: true })
    await overridable.send('users:list', { overrideId: 'abc' })
    await overridable.send('users:list', {})

    expect(plain.authorize.mock.calls).toEqual([['user.manage', { overridable: false }]])
    expect(overridable.authorize.mock.calls).toEqual([
      ['user.manage', { overridable: true, overrideId: 'abc' }],
      ['user.manage', { overridable: true }]
    ])
  })

  it('fails safe if the authorizer returns no actor for a guarded channel', async () => {
    const { send, handle } = guarded(() => null)
    await expect(send('users:list')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' }
    })
    expect(handle).not.toHaveBeenCalled()
  })
})
