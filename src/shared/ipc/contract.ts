/* eslint-disable @typescript-eslint/no-invalid-void-type -- `void` marks channels without input or output. */

/**
 * The typed IPC contract between the renderer and the main process.
 *
 * Every renderer → main call is declared here once. The preload bridge only
 * forwards channels listed in `IPC_CHANNELS`, and the main process must
 * register a handler (with an input schema) for every channel, which the
 * compiler enforces through `HandlerMap` in `src/main/ipc/serviceHost.ts`.
 *
 * This file must stay free of runtime dependencies: it is bundled into the
 * sandboxed preload script.
 */

import type { IpcResult } from './errors'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  isPackaged: boolean
  versions: {
    electron: string
    chrome: string
    node: string
  }
}

export interface StartupStatus {
  /** True when the previous session did not shut down cleanly (crash, power loss, forced kill). */
  recoveredFromUncleanShutdown: boolean
  /** ISO timestamp of when the previous, uncleanly ended session started. */
  previousSessionStartedAt: string | null
}

export interface RendererLogEntry {
  level: LogLevel
  message: string
  context?: Record<string, unknown> | undefined
}

export interface IpcContract {
  'app:get-info': { input: void; output: AppInfo }
  'app:get-startup-status': { input: void; output: StartupStatus }
  'log:write': { input: RendererLogEntry; output: void }
}

export type IpcChannel = keyof IpcContract
export type IpcInput<C extends IpcChannel> = IpcContract[C]['input']
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output']

/** Arguments after the channel name: none for `void` inputs, otherwise exactly one. */
export type IpcArgs<C extends IpcChannel> = IpcInput<C> extends void ? [] : [input: IpcInput<C>]

// A record keyed by IpcChannel makes the compiler reject a missing or extra channel.
const channelRegistry: Record<IpcChannel, true> = {
  'app:get-info': true,
  'app:get-startup-status': true,
  'log:write': true
}

export const IPC_CHANNELS = Object.keys(channelRegistry) as IpcChannel[]

/** The API the preload script exposes on `window.storepro`. */
export interface StoreProBridge {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<IpcOutput<C>>>
}
