import { app, dialog, type BrowserWindow } from 'electron'
import type { Logger } from '../logging/logger'
import type { CrashHistory, RendererCrashGuard } from './crashRecovery'

/**
 * Last-resort handling for errors that escape the main process. The process
 * state is unknown after an uncaught exception, so the app logs it, tells the
 * user, and relaunches unless it has been crashing repeatedly.
 *
 * `app.exit` skips the graceful shutdown on purpose, leaving the session
 * marker in place so the next start knows to run recovery.
 */
export function installMainProcessCrashHandlers(logger: Logger, crashHistory: CrashHistory): void {
  let handlingFatalError = false

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception in main process', { error })
    if (handlingFatalError) return
    handlingFatalError = true

    const { shouldRelaunch, recentCrashes } = crashHistory.recordCrash()
    logger.error('Exiting after fatal error', { shouldRelaunch, recentCrashes })
    if (app.isReady()) {
      dialog.showErrorBox(
        'StorePro needs to restart',
        shouldRelaunch
          ? 'StorePro ran into an unexpected problem and will restart now. Details were saved to the log file.'
          : 'StorePro keeps running into an unexpected problem and will not restart automatically. ' +
              'Please contact support and share the log files.'
      )
    }
    if (shouldRelaunch) app.relaunch()
    app.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection in main process', { reason })
  })

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    logger.error('Child process exited unexpectedly', { ...details })
  })
}

/** Reload the window when its renderer crashes, and stop if it keeps crashing. */
export function watchRendererHealth(
  window: BrowserWindow,
  logger: Logger,
  guard: RendererCrashGuard
): void {
  const { webContents } = window

  webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    logger.error('Renderer process gone', { ...details })
    if (window.isDestroyed()) return

    if (guard.onCrash() === 'reload') {
      logger.info('Reloading window after renderer crash')
      webContents.reload()
      return
    }

    const choice = dialog.showMessageBoxSync(window, {
      type: 'error',
      title: 'StorePro',
      message: 'StorePro stopped working several times in a row.',
      detail: 'Restart StorePro to continue. If this keeps happening, contact support.',
      buttons: ['Restart StorePro', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (choice === 0) app.relaunch()
    app.quit()
  })

  webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.error('Preload script failed', { preloadPath, error })
  })
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
    if (isMainFrame) logger.error('Window failed to load', { errorCode, errorDescription, url })
  })
  window.on('unresponsive', () => logger.warn('Window became unresponsive'))
  window.on('responsive', () => logger.info('Window became responsive again'))
}
