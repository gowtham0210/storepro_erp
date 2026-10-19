import type { IpcMainInvokeEvent } from 'electron'
import type { IpcArgs, IpcChannel, IpcOutput } from '@shared/ipc/contract'
import { AppError, type IpcResult } from '@shared/ipc/errors'
import { createTestLogger } from '../../test/helpers'
import {
  registerIpcHandlers,
  type Authorizer,
  type HandlerMap,
  type IpcMainLike
} from '../serviceHost'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

export function fakeIpcMain(): IpcMainLike & { listeners: Map<string, Listener> } {
  const listeners = new Map<string, Listener>()
  return {
    listeners,
    handle: (channel, listener) => listeners.set(channel, listener),
    removeHandler: (channel) => listeners.delete(channel)
  }
}

export function fakeEvent(url = 'app://storepro/index.html'): IpcMainInvokeEvent {
  return { sender: { id: 7 }, senderFrame: { url } } as unknown as IpcMainInvokeEvent
}

/** Lets public channels through and treats everyone as signed out. */
export const signedOutAuthorizer: Authorizer = {
  authorize: (access) => {
    if (access === 'public') return null
    throw new AppError('UNAUTHENTICATED', 'Sign in to continue.')
  }
}

export interface IpcHarness {
  ipc: ReturnType<typeof fakeIpcMain>
  logger: ReturnType<typeof createTestLogger>
  unregister(): void
  /** Any channel and input, as a compromised renderer could send. */
  send(channel: string, input?: unknown, event?: IpcMainInvokeEvent): Promise<IpcResult<unknown>>
  /** Like the renderer's `invoke`: resolves with the data or throws the AppError. */
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcOutput<C>>
}

/**
 * Handlers registered on a fake `ipcMain` behind the real service host, so
 * tests go through the same sender check, validation and permission guard as
 * the renderer does.
 */
export function createIpcHarness(
  handlers: HandlerMap,
  {
    authorizer = signedOutAuthorizer,
    trusted = true,
    isSetupComplete = () => true
  }: { authorizer?: Authorizer; trusted?: boolean; isSetupComplete?: () => boolean } = {}
): IpcHarness {
  const ipc = fakeIpcMain()
  const logger = createTestLogger()
  const unregister = registerIpcHandlers(ipc, handlers, {
    isTrustedSender: () => trusted,
    authorizer,
    isSetupComplete,
    logger
  })

  const send = async (
    channel: string,
    input?: unknown,
    event = fakeEvent()
  ): Promise<IpcResult<unknown>> => {
    const listener = ipc.listeners.get(channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return (await listener(event, input)) as IpcResult<unknown>
  }

  const invoke = async <C extends IpcChannel>(
    channel: C,
    ...args: IpcArgs<C>
  ): Promise<IpcOutput<C>> => {
    const result = await send(channel, args[0])
    if (!result.ok) throw AppError.fromPayload(result.error)
    return result.data as IpcOutput<C>
  }

  return { ipc, logger, unregister, send, invoke }
}
