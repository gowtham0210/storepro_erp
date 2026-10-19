import type { LogLevel } from '@shared/ipc/contract'
import { invoke } from '../ipc/client'

/** Send a renderer log entry to the main-process log file. Never throws. */
export function reportToMain(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  invoke('log:write', { level, message, context }).catch(() => {
    // The log channel itself failed; there is nowhere else to report it.
  })
}

export function serialiseError(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { value: String(error) }
}

export function installGlobalErrorReporting(): void {
  window.addEventListener('error', (event) => {
    reportToMain('error', 'Uncaught error in renderer', {
      ...serialiseError(event.error ?? event.message),
      source: event.filename,
      line: event.lineno,
      column: event.colno
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportToMain('error', 'Unhandled promise rejection in renderer', serialiseError(event.reason))
  })
}
