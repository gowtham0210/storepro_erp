import { app, protocol, shell, type Session } from 'electron'
import type { Logger } from '../logging/logger'
import { createAppProtocolHandler } from './appProtocol'
import { developmentCsp } from './csp'
import { APP_SCHEME, isAllowedOrigin, isSafeExternalUrl, originOf } from './origins'

/** Must run before the `ready` event. */
export function registerAppSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

export function serveRendererFromAppScheme(rendererDir: string): void {
  protocol.handle(APP_SCHEME, createAppProtocolHandler(rendererDir))
}

export interface SessionHardeningOptions {
  /** Origin of the Vite dev server; set only in development. */
  devServerOrigin: string | null
  logger: Logger
}

export function hardenSession(
  ses: Session,
  { devServerOrigin, logger }: SessionHardeningOptions
): void {
  // StorePro needs no browser permissions (camera, geolocation, notifications, …).
  // Hardware such as serial weighing scales will be granted explicitly when added.
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    logger.warn('Denied permission request', { permission })
    callback(false)
  })
  ses.setPermissionCheckHandler(() => false)
  // Also stops Chromium downloading spell-check dictionaries: no unexpected network traffic.
  ses.setSpellCheckerEnabled(false)

  if (devServerOrigin !== null) {
    const csp = developmentCsp(devServerOrigin)
    ses.webRequest.onHeadersReceived((details, callback) => {
      if (originOf(details.url) !== devServerOrigin) return callback({})
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
      })
    })
  }
}

/**
 * Locks down every WebContents the app creates: no navigation away from the
 * app, no new windows, no <webview>. Safe https links open in the system browser.
 */
export function hardenWebContents(allowedOrigins: readonly string[], logger: Logger): void {
  app.on('web-contents-created', (_event, contents) => {
    const blockForeignNavigation = (event: Electron.Event, url: string): void => {
      if (isAllowedOrigin(url, allowedOrigins)) return
      event.preventDefault()
      logger.warn('Blocked navigation', { url })
    }
    contents.on('will-navigate', blockForeignNavigation)
    contents.on('will-redirect', blockForeignNavigation)
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
      logger.warn('Blocked <webview> attachment')
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      } else {
        logger.warn('Blocked window.open', { url })
      }
      return { action: 'deny' }
    })
  })
}
