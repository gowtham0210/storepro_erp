import { AppError } from '@shared/ipc/errors'

export interface FriendlyError {
  title: string
  message: string
}

/**
 * Plain-language copy for any error: what happened, and what the person can
 * do about it. Internal details stay in the log, never on screen.
 */
export function describeError(error: unknown): FriendlyError {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'VALIDATION_FAILED':
        return {
          title: 'Some details need fixing',
          message: 'Check the highlighted fields and try again.'
        }
      case 'FORBIDDEN':
        return {
          title: "You don't have permission to do this",
          message: 'Ask a manager or administrator to do it, or to change your access.'
        }
      case 'NOT_FOUND':
        return {
          title: "We couldn't find that",
          message: 'It may have been removed. Refresh the list and try again.'
        }
      case 'CONFLICT':
        return {
          title: 'This was changed somewhere else',
          message: 'Reload to see the latest details, then make your change again.'
        }
      case 'UNKNOWN_CHANNEL':
      case 'INTERNAL':
        return {
          title: 'Something went wrong',
          message:
            'Please try again. If it keeps happening, contact support. Your saved data is safe.'
        }
    }
  }
  return {
    title: 'Something went wrong',
    message: 'Please try again. If it keeps happening, contact support. Your saved data is safe.'
  }
}

/** Field errors from a VALIDATION_FAILED response, keyed by field path. */
export function fieldErrorsFrom(error: unknown): Record<string, string> | null {
  if (
    !(error instanceof AppError) ||
    error.code !== 'VALIDATION_FAILED' ||
    !Array.isArray(error.details)
  )
    return null
  const errors: Record<string, string> = {}
  for (const issue of error.details as { path?: unknown; message?: unknown }[]) {
    if (
      typeof issue.path === 'string' &&
      typeof issue.message === 'string' &&
      !(issue.path in errors)
    ) {
      errors[issue.path] = issue.message
    }
  }
  return errors
}
