import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type StoreProBridge } from '@shared/ipc/contract'
import type { IpcResult } from '@shared/ipc/errors'

const allowedChannels = new Set<string>(IPC_CHANNELS)
const allowedEvents = new Set<string>(IPC_EVENTS)

/**
 * The only surface the renderer gets: `invoke` restricted to the channels
 * declared in the shared contract, and `on` restricted to the declared
 * main → renderer events. `ipcRenderer` itself is never exposed, so the page
 * cannot send arbitrary messages or listen on any other channel.
 */
const bridge: StoreProBridge = {
  invoke(channel, ...args) {
    if (!allowedChannels.has(channel)) {
      const result: IpcResult<never> = {
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL', message: `Unknown channel: ${String(channel)}` }
      }
      return Promise.resolve(result)
    }
    return ipcRenderer.invoke(channel, args[0])
  },
  on(event, listener) {
    if (!allowedEvents.has(event)) throw new Error(`Unknown event: ${String(event)}`)
    // Only the payload is passed on: the page never sees the Electron event object.
    const forward = (_event: IpcRendererEvent, payload: unknown): void =>
      listener(payload as Parameters<typeof listener>[0])
    ipcRenderer.on(event, forward)
    return () => {
      ipcRenderer.removeListener(event, forward)
    }
  }
}

contextBridge.exposeInMainWorld('storepro', bridge)
