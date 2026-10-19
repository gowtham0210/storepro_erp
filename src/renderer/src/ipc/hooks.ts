import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import type { IpcArgs, IpcChannel, IpcInput, IpcOutput } from '@shared/ipc/contract'
import type { AppError } from '@shared/ipc/errors'
import { invoke } from './client'

/**
 * Read data from the main process, cached by channel + input. Errors are
 * AppError instances; render them with describeError().
 */
export function useIpcQuery<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): UseQueryResult<IpcOutput<C>, AppError> {
  return useQuery<IpcOutput<C>, AppError>({
    queryKey: [channel, ...args],
    queryFn: () => invoke(channel, ...args)
  })
}

/** Change data in the main process. Invalidate affected queries in onSuccess. */
export function useIpcMutation<C extends IpcChannel>(
  channel: C
): UseMutationResult<IpcOutput<C>, AppError, IpcInput<C>> {
  return useMutation<IpcOutput<C>, AppError, IpcInput<C>>({
    mutationFn: (input) => invoke(channel, ...([input] as unknown as IpcArgs<C>))
  })
}
