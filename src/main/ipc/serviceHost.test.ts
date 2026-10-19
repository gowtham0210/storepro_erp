import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { IPC_CHANNELS } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { createTestLogger } from '../test/helpers'
import { registerIpcHandlers, type HandlerMap, type IpcMainLike } from './serviceHost'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function fakeIpcMain(): IpcMainLike & { listeners: Map<string, Listener> } {
  const listeners = new Map<string, Listener>()
  return {
    listeners,
    handle: (channel, listener) => listeners.set(channel, listener),
    removeHandler: (channel) => listeners.delete(channel)
  }
}

function fakeEvent(url = 'app://storepro/index.html'): IpcMainInvokeEvent {
  return { sender: { id: 7 }, senderFrame: { url } } as unknown as IpcMainInvokeEvent
}

const appInfo = {
  name: 'StorePro',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  isPackaged: true,
  versions: { electron: '1', chrome: '1', node: '1' }
}

function handlers(overrides: Partial<HandlerMap> = {}): HandlerMap {
  // Every channel gets a do-nothing handler; the tests below override the ones they use.
  const defaults = Object.fromEntries(
    IPC_CHANNELS.map((channel) => [channel, { input: z.unknown(), handle: () => undefined }])
  ) as unknown as HandlerMap
  return {
    ...defaults,
    'app:get-info': { input: z.void(), handle: () => appInfo },
    'app:get-startup-status': {
      input: z.void(),
      handle: () => ({ recoveredFromUncleanShutdown: false, previousSessionStartedAt: null })
    },
    'log:write': {
      input: z.object({
        level: z.enum(['debug', 'info', 'warn', 'error']),
        message: z.string().min(1)
      }),
      handle: () => undefined
    },
    ...overrides
  }
}

function setup(map = handlers(), trusted = true) {
  const ipc = fakeIpcMain()
  const logger = createTestLogger()
  const unregister = registerIpcHandlers(ipc, map, { isTrustedSender: () => trusted, logger })
  const call = (channel: string, input?: unknown, event = fakeEvent()) => {
    const listener = ipc.listeners.get(channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return listener(event, input)
  }
  return { ipc, logger, unregister, call }
}

describe('registerIpcHandlers', () => {
  it('registers every contract channel and can unregister them', () => {
    const { ipc, unregister } = setup()
    expect([...ipc.listeners.keys()].sort()).toEqual([...IPC_CHANNELS].sort())
    unregister()
    expect(ipc.listeners.size).toBe(0)
  })

  it('wraps handler results in an ok envelope', async () => {
    const { call } = setup()
    await expect(call('app:get-info')).resolves.toEqual({ ok: true, data: appInfo })
  })

  it('passes the sender id to the handler', async () => {
    let seenId: number | undefined
    const { call } = setup(
      handlers({
        'app:get-info': {
          input: z.void(),
          handle: (_input, context) => {
            seenId = context.webContentsId
            return appInfo
          }
        }
      })
    )
    await call('app:get-info')
    expect(seenId).toBe(7)
  })

  it('rejects invalid input before the handler runs', async () => {
    const { call } = setup()
    const result = await call('log:write', { level: 'fatal', message: '' })
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    const details = (result as { error: { details: { path: string }[] } }).error.details
    expect(details.map((issue) => issue.path).sort()).toEqual(['level', 'message'])
  })

  it('rejects calls from untrusted senders', async () => {
    const { call, logger } = setup(handlers(), false)
    await expect(
      call('app:get-info', undefined, fakeEvent('https://evil.example'))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' }
    })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('returns AppError details to the renderer', async () => {
    const { call } = setup(
      handlers({
        'app:get-info': {
          input: z.void(),
          handle: () => {
            throw new AppError('NOT_FOUND', 'Nothing here', { id: 1 })
          }
        }
      })
    )
    await expect(call('app:get-info')).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Nothing here', details: { id: 1 } }
    })
  })

  it('hides unexpected errors from the renderer but logs them', async () => {
    const { call, logger } = setup(
      handlers({
        'app:get-info': {
          input: z.void(),
          handle: async () => {
            throw new Error('SQLITE_CORRUPT at C:\\secret\\path')
          }
        }
      })
    )
    const result = await call('app:get-info')
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    expect(JSON.stringify(result)).not.toContain('SQLITE_CORRUPT')
    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled error in IPC handler',
      expect.objectContaining({ channel: 'app:get-info' })
    )
  })
})
