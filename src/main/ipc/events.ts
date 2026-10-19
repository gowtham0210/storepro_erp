import type { IpcEvent, IpcEvents } from '@shared/ipc/contract'

/** Where events go: the app's window(s). Abstract so it can be tested without Electron. */
export interface EventTarget {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

/**
 * Pushes typed main → renderer events (see `IpcEvents`). Only declared events
 * can be sent, and only to the targets given (the main window's webContents).
 */
export function createEventPublisher(targets: () => readonly EventTarget[]) {
  return function publish<E extends IpcEvent>(event: E, payload: IpcEvents[E]): void {
    for (const target of targets()) if (!target.isDestroyed()) target.send(event, payload)
  }
}
