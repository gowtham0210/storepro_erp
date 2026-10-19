import type {
  AuthState,
  IpcChannel,
  IpcInput,
  IpcOutput,
  SessionUser,
  StoreProBridge
} from '@shared/ipc/contract'
import { AppError, type IpcResult } from '@shared/ipc/errors'

export const ADMIN: SessionUser = {
  userId: 1,
  username: 'owner',
  displayName: 'Ravi Kumar',
  roleCode: 'administrator',
  roleName: 'Administrator',
  mustChangePassword: false
}

type Handler<C extends IpcChannel> = (input: IpcInput<C>) => IpcOutput<C> | Promise<IpcOutput<C>>
type Handlers = { [C in IpcChannel]?: Handler<C> }

/**
 * A stand-in for the main process in renderer tests. Defaults to a signed-in
 * administrator; tests override channels with `fakeBackend.on(...)`. A
 * handler that throws an AppError produces the same failure envelope the real
 * service host sends.
 */
class FakeBackend {
  authState: AuthState = { status: 'signed-in', user: ADMIN }
  calls: { channel: IpcChannel; input: unknown }[] = []
  private handlers: Handlers = {}

  reset(): void {
    this.authState = { status: 'signed-in', user: ADMIN }
    this.calls = []
    this.handlers = {}
  }

  on<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
    ;(this.handlers as Record<string, unknown>)[channel] = handler
  }

  callsTo(channel: IpcChannel): unknown[] {
    return this.calls.filter((call) => call.channel === channel).map((call) => call.input)
  }

  readonly bridge: StoreProBridge = {
    invoke: (async (channel: IpcChannel, input?: unknown): Promise<IpcResult<unknown>> => {
      this.calls.push({ channel, input })
      try {
        const handler = (
          this.handlers as Record<string, ((input: unknown) => unknown) | undefined>
        )[channel]
        const data = handler ? await handler(input) : this.defaultResponse(channel)
        return { ok: true, data }
      } catch (error) {
        if (error instanceof AppError) return { ok: false, error: error.toPayload() }
        throw error
      }
    }) as StoreProBridge['invoke']
  }

  private defaultResponse(channel: IpcChannel): unknown {
    switch (channel) {
      case 'app:get-info':
        return {
          name: 'StorePro',
          version: '0.1.0-test',
          platform: 'win32',
          arch: 'x64',
          isPackaged: false,
          versions: { electron: '44', chrome: '152', node: '24' }
        }
      case 'app:get-startup-status':
        return { recoveredFromUncleanShutdown: false, previousSessionStartedAt: null }
      case 'auth:get-state':
        return this.authState
      case 'users:list':
      case 'users:list-roles':
        return []
      default:
        return undefined
    }
  }
}

export const fakeBackend = new FakeBackend()
