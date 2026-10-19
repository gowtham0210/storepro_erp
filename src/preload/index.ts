import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type StoreProBridge } from '@shared/ipc/contract'
import type { IpcResult } from '@shared/ipc/errors'

const allowedChannels = new Set<string>(IPC_CHANNELS)

/**
 * The only surface the renderer gets: a single `invoke` restricted to the
 * channels declared in the shared contract. `ipcRenderer` itself is never
 * exposed, so the page cannot send arbitrary messages or listen on any channel.
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
  }
}

contextBridge.exposeInMainWorld('storepro', bridge)
