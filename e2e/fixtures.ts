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

import { TEST_STORE } from '../src/shared/test/stores'

export { expect } from '@playwright/test'
export { TEST_STORE }

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

/** The administrator every test store starts with. */
export const OWNER = { displayName: 'Ravi Kumar', username: 'owner', password: 'counter-top-42' }

export interface LaunchOptions {
  /**
   * Get past first-run setup or sign-in as OWNER (the default), or stop at
   * whatever screen appears first.
   */
  signIn?: boolean
}

/** Start the built app and wait until the first screen has rendered. */
export async function launchStorePro(
  userDataDir: string,
  options: LaunchOptions = {}
): Promise<StoreProApp> {
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
  const heading = window.getByRole('heading', { level: 1 })
  await heading.waitFor()
  if (options.signIn !== false) {
    const title = await heading.textContent()
    if (title === 'Set up StorePro') await completeSetup(window)
    else if (title === 'Sign in') await signIn(window, OWNER)
  }
  return { app, window, userDataDir }
}

/**
 * Finish first-run setup with TEST_STORE and OWNER, the quick way: one call
 * to the main process, as the wizard's Finish button makes, then a reload.
 * e2e/setup.spec.ts drives the wizard itself.
 */
export async function completeSetup(ui: Page, owner = OWNER): Promise<void> {
  const result = await ui.evaluate((input) => window.storepro.invoke('setup:complete', input), {
    store: TEST_STORE,
    administrator: owner
  })
  if (!result.ok) throw new Error(`Setup failed: ${JSON.stringify(result.error)}`)
  await ui.reload()
  await ui.getByRole('heading', { level: 1, name: 'Billing' }).waitFor()
}

export async function signIn(
  ui: Page,
  credentials: { username: string; password: string }
): Promise<void> {
  await ui.getByLabel('Username', { exact: true }).fill(credentials.username)
  await ui.getByLabel('Password', { exact: true }).fill(credentials.password)
  await ui.getByRole('button', { name: 'Sign in' }).click()
}

export async function signOut(ui: Page): Promise<void> {
  await ui.getByRole('button', { name: /·/ }).click()
  await ui.getByRole('list', { name: 'Account' }).getByRole('button', { name: 'Sign out' }).click()
  await ui.getByRole('heading', { level: 1, name: 'Sign in' }).waitFor()
}

/**
 * Cut or restore the network, as a dropped connection would: the main
 * process's check (`net.isOnline()`) reports it, and Chromium's network is
 * switched off too, so nothing could reach the internet even if it tried.
 * The connectivity monitor notices within a few seconds.
 */
export async function setNetwork({ app, window }: StoreProApp, online: boolean): Promise<void> {
  await app.evaluate(({ net, session }, up) => {
    ;(net as { isOnline: () => boolean }).isOnline = () => up
    if (up) session.defaultSession.disableNetworkEmulation()
    else session.defaultSession.enableNetworkEmulation({ offline: true })
  }, online)
  await window.context().setOffline(!online)
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
