import { AppError } from '@shared/ipc/errors'

export interface FriendlyError {
  title: string
  message: string
}

const SOMETHING_WENT_WRONG: FriendlyError = {
  title: 'Something went wrong',
  message: 'Please try again. If it keeps happening, contact support. Your saved data is safe.'
}

/**
 * Plain-language copy for any error: what happened, and what the person can
 * do about it.
 *
 * Errors the services raise on purpose (CONFLICT, NOT_FOUND, ...) carry a
 * message written for the user, e.g. "That username is already taken", which
 * is shown as is. Unexpected errors only ever arrive as INTERNAL with a
 * generic message; their details stay in the log.
 */
export function describeError(error: unknown): FriendlyError {
  if (!(error instanceof AppError)) return SOMETHING_WENT_WRONG
  const specific = (fallback: string): string => error.message || fallback
  switch (error.code) {
    case 'VALIDATION_FAILED':
      return {
        title: 'Some details need fixing',
        message: 'Check the highlighted fields and try again.'
      }
    case 'UNAUTHENTICATED':
      return { title: "You're not signed in", message: specific('Sign in to continue.') }
    case 'RATE_LIMITED':
      return { title: 'Too many attempts', message: specific('Wait a moment, then try again.') }
    case 'FORBIDDEN':
      return {
        title: "You don't have permission to do this",
        message: specific('Ask a manager or administrator to do it, or to change your access.')
      }
    case 'NOT_FOUND':
      return {
        title: "We couldn't find that",
        message: specific('It may have been removed. Refresh and try again.')
      }
    case 'CONFLICT':
      return {
        title: "That can't be done",
        message: specific('Reload to see the latest details, then try again.')
      }
    case 'UNKNOWN_CHANNEL':
    case 'INTERNAL':
      return SOMETHING_WENT_WRONG
  }
}

/** Milliseconds until another attempt is allowed, from a RATE_LIMITED or locking UNAUTHENTICATED error. */
export function retryAfterFrom(error: unknown): number {
  if (!(error instanceof AppError)) return 0
  const value = (error.details as { retryAfterMs?: unknown } | undefined)?.retryAfterMs
  return typeof value === 'number' && value > 0 ? value : 0
}

/** Field errors from a VALIDATION_FAILED or field-level CONFLICT response, keyed by field path. */
export function fieldErrorsFrom(error: unknown): Record<string, string> | null {
  // Validation errors, and conflicts tied to a field (e.g. "That username is
  // already taken"), carry [{ path, message }] details.
  if (
    !(error instanceof AppError) ||
    (error.code !== 'VALIDATION_FAILED' && error.code !== 'CONFLICT') ||
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
