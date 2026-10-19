/**
 * Error envelope shared by the main process and the renderer.
 *
 * Errors thrown inside `ipcMain.handle` lose their type and custom fields when
 * they cross the IPC boundary, so handlers never throw across it. Instead every
 * call resolves to an `IpcResult`, and the renderer client turns failures back
 * into `AppError` instances.
 */

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNKNOWN_CHANNEL',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface AppErrorPayload {
  code: ErrorCode
  message: string
  details?: unknown
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload }

export class AppError extends Error {
  readonly code: ErrorCode
  readonly details: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }

  static fromPayload(payload: AppErrorPayload): AppError {
    return new AppError(payload.code, payload.message, payload.details)
  }

  toPayload(): AppErrorPayload {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details }
  }
}
