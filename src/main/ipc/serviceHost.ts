import type { IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type { IpcChannel, IpcInput, IpcOutput } from '@shared/ipc/contract'
import { AppError, type IpcResult } from '@shared/ipc/errors'
import type { Logger } from '../logging/logger'

export interface HandlerContext {
  /** Id of the WebContents that sent the request. */
  webContentsId: number
}

export interface HandlerDefinition<C extends IpcChannel> {
  /** Runtime validation for the renderer's input. The renderer is never trusted. */
  input: z.ZodType<IpcInput<C>>
  handle(input: IpcInput<C>, context: HandlerContext): IpcOutput<C> | Promise<IpcOutput<C>>
}

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

export interface ServiceHostOptions {
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  logger: Logger
}

/**
 * Registers every handler on `ipcMain` behind a common pipeline:
 * sender check → input validation → handler → error envelope.
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
  { isTrustedSender, logger }: ServiceHostOptions
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
    const data = await handler.handle(parsed.data, { webContentsId: event.sender.id })
    return { ok: true, data }
  } catch (error) {
    if (error instanceof AppError) return failure(error)
    // Unexpected errors are logged in full but never exposed to the renderer.
    logger.error('Unhandled error in IPC handler', { channel, error })
    return failure(new AppError('INTERNAL', 'An unexpected error occurred. Please try again.'))
  }
}

function failure(error: AppError): IpcResult<never> {
  return { ok: false, error: error.toPayload() }
}
