import { join } from 'node:path'
import { app, dialog, ipcMain, Menu, session, type BrowserWindow } from 'electron'
import type { AppInfo, StartupStatus } from '@shared/ipc/contract'
import { DatabaseIntegrityError, DatabaseTooNewError, openStoreDatabase } from './db'
import { createHandlers } from './ipc/handlers'
import { systemClock } from './lib/clock'
import { registerIpcHandlers } from './ipc/serviceHost'
import { CrashHistory, RendererCrashGuard, SessionMarker } from './lifecycle/crashRecovery'
import { installMainProcessCrashHandlers, watchRendererHealth } from './lifecycle/processHandlers'
import { ShutdownCoordinator } from './lifecycle/shutdown'
import { createFileLogger, type Logger } from './logging/logger'
import {
  hardenSession,
  hardenWebContents,
  registerAppSchemePrivileged,
  serveRendererFromAppScheme
} from './security/hardening'
import { APP_ENTRY_URL, APP_ORIGIN, isAllowedOrigin, originOf } from './security/origins'
import { createMainWindow } from './window/mainWindow'
import { WindowStateStore } from './window/windowState'

const APP_USER_MODEL_ID = 'com.storepro.desktop'

// electron-vite sets this when running `npm run dev`.
const devServerUrl = app.isPackaged ? null : process.env['ELECTRON_RENDERER_URL'] || null
const devServerOrigin = devServerUrl === null ? null : originOf(devServerUrl)
const allowedOrigins = [devServerOrigin ?? APP_ORIGIN]

// End-to-end tests give every launch its own data folder (database, logs,
// single-instance lock). Never honoured by packaged builds.
const testUserDataDir = app.isPackaged ? undefined : process.env['STOREPRO_USER_DATA_DIR']
if (testUserDataDir) {
  app.setPath('userData', testUserDataDir)
  app.setAppLogsPath(join(testUserDataDir, 'logs'))
}

// These must run before the `ready` event.
// `--no-sandbox` is only needed in development containers running as root; every
// window still sets `sandbox: true` in its webPreferences.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox()
registerAppSchemePrivileged()

if (app.requestSingleInstanceLock()) {
  bootstrap()
} else {
  // Another StorePro window is already open; it will be focused instead.
  app.quit()
}

function bootstrap(): void {
  const userData = app.getPath('userData')
  const logger = createFileLogger({
    dir: app.getPath('logs'),
    minLevel: app.isPackaged ? 'info' : 'debug',
    mirrorToConsole: !app.isPackaged
  })
  installMainProcessCrashHandlers(logger, new CrashHistory(join(userData, 'crash-history.json')))

  logger.info('Starting StorePro', {
    version: app.getVersion(),
    electron: process.versions.electron,
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch
  })

  app.setAppUserModelId(APP_USER_MODEL_ID)
  hardenWebContents(allowedOrigins, logger.child('security'))

  const shutdown = new ShutdownCoordinator({ logger: logger.child('shutdown') })
  let mainWindow: BrowserWindow | null = null

  let readyToQuit = false
  app.on('before-quit', (event) => {
    if (readyToQuit) return
    event.preventDefault()
    void shutdown.run('quit').finally(() => {
      readyToQuit = true
      app.quit()
    })
  })
  app.on('window-all-closed', () => app.quit())
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit())

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app
    .whenReady()
    .then(() => {
      mainWindow = start(logger, shutdown, userData)
    })
    .catch((error: unknown) => {
      logger.error('Startup failed', { error })
      dialog.showErrorBox('StorePro could not start', startupFailureMessage(error))
      app.exit(1)
    })
}

function start(logger: Logger, shutdown: ShutdownCoordinator, userData: string): BrowserWindow {
  const marker = new SessionMarker(join(userData, 'session.lock'))
  const startupStatus: StartupStatus = marker.begin(app.getVersion())
  if (startupStatus.recoveredFromUncleanShutdown) {
    logger.warn('Previous session ended unexpectedly; starting in recovery mode', {
      ...startupStatus
    })
  }
  // Registered first so it runs last: the marker is cleared only after every
  // other hook has finished.
  shutdown.register('session-marker', () => marker.end())

  const { db } = openStoreDatabase({
    path: join(userData, 'data', 'storepro.db'),
    backupDir: join(userData, 'backups'),
    appVersion: app.getVersion(),
    verifyIntegrity: startupStatus.recoveredFromUncleanShutdown,
    clock: systemClock,
    logger: logger.child('db')
  })
  shutdown.register('database', () => {
    db.optimize()
    db.close()
  })

  if (app.isPackaged) Menu.setApplicationMenu(null)
  hardenSession(session.defaultSession, { devServerOrigin, logger: logger.child('security') })
  if (devServerUrl === null) serveRendererFromAppScheme(join(import.meta.dirname, '../renderer'))

  const unregisterIpc = registerIpcHandlers(
    ipcMain,
    createHandlers({ logger, getAppInfo, getStartupStatus: () => startupStatus }),
    {
      isTrustedSender: (event) => isAllowedOrigin(event.senderFrame?.url ?? '', allowedOrigins),
      logger: logger.child('ipc')
    }
  )
  shutdown.register('ipc', unregisterIpc)

  const window = createMainWindow({
    preloadPath: join(import.meta.dirname, '../preload/index.cjs'),
    rendererUrl: devServerUrl ?? APP_ENTRY_URL,
    stateStore: new WindowStateStore(join(userData, 'window-state.json')),
    enableDevTools: !app.isPackaged,
    logger: logger.child('window')
  })
  watchRendererHealth(window, logger.child('renderer-health'), new RendererCrashGuard())
  // Windows log-off or shutdown: the OS may terminate the process soon after.
  window.on('session-end', () => void shutdown.run('windows-session-end'))
  return window
}

function startupFailureMessage(error: unknown): string {
  if (error instanceof DatabaseTooNewError) {
    return 'This store data was saved by a newer version of StorePro. Install the latest version to open it.'
  }
  if (error instanceof DatabaseIntegrityError) {
    return (
      'StorePro found a problem with its data file and stopped to protect it. ' +
      'Please contact support; do not delete any files in the StorePro folder.'
    )
  }
  return 'StorePro failed to start. Details were saved to the log file.'
}

function getAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  }
}
