import type { IpcArgs, IpcChannel, IpcOutput } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'

/**
 * Call a main-process service. Resolves with the handler's result or throws an
 * `AppError` carrying the error code from the main process.
 */
export async function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcOutput<C>> {
  const result = await window.storepro.invoke(channel, ...args)
  if (!result.ok) throw AppError.fromPayload(result.error)
  return result.data
}
