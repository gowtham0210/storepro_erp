import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

export { expect } from '@playwright/test'

export const APP_DIR = resolve(import.meta.dirname, '..')
/** The Electron binary from node_modules (`require('electron')` returns its path). */
export const ELECTRON_PATH = createRequire(import.meta.url)('electron') as string
/** Chromium's sandbox cannot run as root, which only happens in CI/dev containers. */
export const EXTRA_ARGS = process.getuid?.() === 0 ? ['--no-sandbox'] : []

export interface StoreProApp {
  app: ElectronApplication
  window: Page
  userDataDir: string
}

/** Environment for a launch: an isolated data folder and the built renderer (no dev server). */
export function launchEnv(userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') env[key] = value
  }
  env['STOREPRO_USER_DATA_DIR'] = userDataDir
  return env
}

/** Start the built app and wait until the first screen has rendered. */
export async function launchStorePro(userDataDir: string): Promise<StoreProApp> {
  const app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [...EXTRA_ARGS, APP_DIR],
    env: launchEnv(userDataDir)
  })
  // Tests must never open a real browser: record "open in system browser" calls instead.
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as unknown as { openedExternalUrls: string[] }).openedExternalUrls = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
  const window = await app.firstWindow()
  await window.getByRole('heading', { level: 1 }).waitFor()
  return { app, window, userDataDir }
}

/** URLs the app asked the operating system to open (see the stub in launchStorePro). */
export function openedExternalUrls({ app }: StoreProApp): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as unknown as { openedExternalUrls: string[] }).openedExternalUrls
  )
}

/**
 * Close the app and make sure the process is gone, so its data folder can be
 * deleted. Falls back to killing it if a graceful close fails or hangs.
 */
export async function closeStorePro({ app }: StoreProApp): Promise<void> {
  const child = app.process()
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  await Promise.race([
    app.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 15_000))
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await exited
}

export function readLog(userDataDir: string): string {
  try {
    return readFileSync(join(userDataDir, 'logs', 'main.log'), 'utf8')
  } catch {
    return ''
  }
}

/**
 * Delete a test's data folder. Best effort: on Windows a file can stay locked
 * for a while after a process is force-killed, and a leftover temp folder must
 * not fail a test whose checks passed. Failures are reported as warnings.
 */
export function removeUserDataDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (error) {
    const message = `Could not delete test data folder ${dir}: ${String(error)}`
    console.warn(message)
    test.info().annotations.push({ type: 'warning', description: message })
  }
}

export function createUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'storepro-e2e-'))
}

/** Navigate inside the single-page app without reloading it. */
export async function goTo(ui: Page, path: string): Promise<void> {
  await ui.evaluate((target) => {
    history.pushState({}, '', target)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

interface Fixtures {
  userDataDir: string
  storepro: StoreProApp
  /** The app's main window. (Not called `window`, which would hide the global inside evaluate().) */
  ui: Page
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires an object pattern here
  userDataDir: async ({}, use) => {
    const dir = createUserDataDir()
    await use(dir)
    removeUserDataDir(dir)
  },

  storepro: async ({ userDataDir }, use, testInfo) => {
    const launched = await launchStorePro(userDataDir)
    await use(launched)
    if (testInfo.status !== testInfo.expectedStatus) {
      // Evidence for the HTML report: what the screen showed and what the app logged.
      const screenshot = await launched.window.screenshot().catch(() => null)
      if (screenshot)
        await testInfo.attach('screenshot', { body: screenshot, contentType: 'image/png' })
      await testInfo.attach('main.log', { body: readLog(userDataDir), contentType: 'text/plain' })
    }
    await closeStorePro(launched)
  },

  ui: async ({ storepro }, use) => {
    await use(storepro.window)
  }
})
