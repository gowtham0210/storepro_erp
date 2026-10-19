import type { IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type { IpcChannel, IpcInput, IpcOutput } from '@shared/ipc/contract'
import { AppError, type IpcResult } from '@shared/ipc/errors'
import type { Actor, HandlerAccess } from '../auth/access'
import type { Logger } from '../logging/logger'

export interface HandlerContext {
  /** Id of the WebContents that sent the request. */
  webContentsId: number
}

/** Context for a guarded handler: who the request runs as. */
export interface ActorContext extends HandlerContext {
  actor: Actor
}

type Result<C extends IpcChannel> = IpcOutput<C> | Promise<IpcOutput<C>>

interface PublicHandler<C extends IpcChannel> {
  access: 'public'
  /** Runtime validation for the renderer's input. The renderer is never trusted. */
  input: z.ZodType<IpcInput<C>>
  handle(input: IpcInput<C>, context: HandlerContext): Result<C>
}

interface GuardedHandler<C extends IpcChannel> {
  /** Checked by the service host before the handler runs (M06-03). */
  access: Exclude<HandlerAccess, 'public'>
  /**
   * A manager approval can unlock this request for someone whose role lacks
   * the permission (M06-05). The input must then accept an optional
   * `overrideId` (see `overrideId` in @shared/schemas/users).
   */
  overridable?: true
  /**
   * Allowed before the store is set up. Every other guarded channel is
   * refused with SETUP_REQUIRED until then (M03-03, FR-005), so a new
   * screen's requests are blocked by default.
   */
  beforeSetup?: true
  input: z.ZodType<IpcInput<C>>
  handle(input: IpcInput<C>, context: ActorContext): Result<C>
}

/** Every handler declares who may call it; there is no default. */
export type HandlerDefinition<C extends IpcChannel> = PublicHandler<C> | GuardedHandler<C>

/** One handler per channel; a missing channel is a compile error. */
export type HandlerMap = { [C in IpcChannel]: HandlerDefinition<C> }

/** The subset of `ipcMain` the service host needs, so it can be tested without Electron. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void
  removeHandler(channel: string): void
}

/** Resolves who a request runs as, or throws UNAUTHENTICATED / FORBIDDEN. AuthService implements it. */
export interface Authorizer {
  authorize(
    access: HandlerAccess,
    options: { overridable?: boolean; overrideId?: string }
  ): Actor | null
}

export interface ServiceHostOptions {
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  authorizer: Authorizer
  /** Whether first-run setup has been completed. */
  isSetupComplete(): boolean
  logger: Logger
}

/**
 * Registers every handler on `ipcMain` behind a common pipeline:
 * sender check → input validation → permission guard → setup guard → handler → error envelope.
 *
 * Returns a function that unregisters all handlers.
 */
export function registerIpcHandlers(
  ipc: IpcMainLike,
  handlers: HandlerMap,
  options: ServiceHostOptions
): () => void {
  const channels = Object.keys(handlers) as IpcChannel[]
  for (const channel of channels) {
    ipc.handle(channel, (event, rawInput) =>
      dispatch(
        channel,
        handlers[channel] as HandlerDefinition<IpcChannel>,
        event,
        rawInput,
        options
      )
    )
  }
  return () => {
    for (const channel of channels) ipc.removeHandler(channel)
  }
}

async function dispatch(
  channel: IpcChannel,
  handler: HandlerDefinition<IpcChannel>,
  event: IpcMainInvokeEvent,
  rawInput: unknown,
  { isTrustedSender, authorizer, isSetupComplete, logger }: ServiceHostOptions
): Promise<IpcResult<unknown>> {
  if (!isTrustedSender(event)) {
    logger.warn('Rejected IPC call from untrusted sender', {
      channel,
      senderUrl: event.senderFrame?.url ?? null
    })
    return failure(new AppError('FORBIDDEN', 'This request is not allowed.'))
  }

  const parsed = handler.input.safeParse(rawInput)
  if (!parsed.success) {
    return failure(
      new AppError(
        'VALIDATION_FAILED',
        'The request contained invalid data.',
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message
        }))
      )
    )
  }

  try {
    const context = { webContentsId: event.sender.id }
    let data: unknown
    if (handler.access === 'public') {
      data = await handler.handle(parsed.data, context)
    } else {
      const overrideId = handler.overridable ? overrideIdOf(parsed.data) : undefined
      const actor = authorizer.authorize(handler.access, {
        overridable: handler.overridable === true,
        ...(overrideId === undefined ? {} : { overrideId })
      })
      if (!actor) throw new Error(`No actor for guarded channel ${channel}`)
      if (!handler.beforeSetup && !isSetupComplete()) {
        throw new AppError('SETUP_REQUIRED', 'Finish setting up the store first.')
      }
      data = await handler.handle(parsed.data, { ...context, actor })
    }
    return { ok: true, data }
  } catch (error) {
    if (error instanceof AppError) return failure(error)
    // Unexpected errors are logged in full but never exposed to the renderer.
    logger.error('Unhandled error in IPC handler', { channel, error })
    return failure(new AppError('INTERNAL', 'An unexpected error occurred. Please try again.'))
  }
}

function overrideIdOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const { overrideId } = input as { overrideId?: unknown }
  return typeof overrideId === 'string' ? overrideId : undefined
}

function failure(error: AppError): IpcResult<never> {
  return { ok: false, error: error.toPayload() }
}
