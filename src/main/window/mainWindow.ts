import { BrowserWindow, screen } from 'electron'
import type { Logger } from '../logging/logger'
import { MIN_WINDOW_SIZE, type WindowState, type WindowStateStore } from './windowState'

export interface MainWindowOptions {
  preloadPath: string
  rendererUrl: string
  stateStore: WindowStateStore
  enableDevTools: boolean
  logger: Logger
}

const SAVE_DEBOUNCE_MS = 500

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const { preloadPath, rendererUrl, stateStore, enableDevTools, logger } = options
  const state = stateStore.load(screen.getAllDisplays().map((display) => display.workArea))

  const window = new BrowserWindow({
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    width: state.width,
    height: state.height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    title: 'StorePro',
    show: false,
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: enableDevTools
    }
  })

  if (state.isMaximized) window.maximize()
  window.once('ready-to-show', () => window.show())

  trackWindowState(window, stateStore, logger)

  window.loadURL(rendererUrl).catch((error: unknown) => {
    logger.error('Failed to load renderer', { rendererUrl, error })
  })
  return window
}

function trackWindowState(window: BrowserWindow, store: WindowStateStore, logger: Logger): void {
  let timer: NodeJS.Timeout | undefined

  const save = (): void => {
    if (window.isDestroyed() || window.isMinimized()) return
    // Normal bounds keep the restored size/position while maximized.
    const bounds = window.getNormalBounds()
    const state: WindowState = { ...bounds, isMaximized: window.isMaximized() }
    try {
      store.save(state)
    } catch (error) {
      logger.warn('Could not save window state', { error })
    }
  }
  const scheduleSave = (): void => {
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  window.on('close', () => {
    clearTimeout(timer)
    save()
  })
}
