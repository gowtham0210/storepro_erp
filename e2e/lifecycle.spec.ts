import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_DIR,
  createUserDataDir,
  ELECTRON_PATH,
  expect,
  EXTRA_ARGS,
  launchEnv,
  launchStorePro,
  readLog,
  test
} from './fixtures'

test.describe('application lifecycle', () => {
  test('creates and migrates the store database on first start', async ({ storepro }) => {
    expect(existsSync(join(storepro.userDataDir, 'data', 'storepro.db'))).toBe(true)
    expect(readLog(storepro.userDataDir)).toContain('Database migrated')
  })

  test('runs only one instance per data folder', async ({ storepro }) => {
    const second = spawnSync(ELECTRON_PATH, [...EXTRA_ARGS, APP_DIR], {
      env: launchEnv(storepro.userDataDir),
      timeout: 20_000
    })
    expect(second.error).toBeUndefined()
    expect(second.status).toBe(0)
    expect(storepro.app.windows()).toHaveLength(1)
  })

  test('reloads the window after the renderer crashes', async ({ storepro }) => {
    await storepro.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
    })
    // The main process notices the crash and reloads; then the page is usable again.
    await expect
      .poll(() => readLog(storepro.userDataDir))
      .toContain('Reloading window after renderer crash')
    await expect
      .poll(() =>
        storepro.app.evaluate(({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents
          return contents && !contents.isCrashed() && !contents.isLoading()
            ? contents.getURL()
            : null
        })
      )
      .toMatch(/^app:\/\/storepro\//)
  })

  test('after a hard kill, the next start checks the data and tells the user', async () => {
    const userDataDir = createUserDataDir()
    try {
      const first = await launchStorePro(userDataDir)
      // Simulates a power cut or Task Manager "End task": no shutdown hooks run.
      const killed = first.app.process()
      const exited = new Promise((resolve) => killed.once('exit', resolve))
      killed.kill('SIGKILL')
      await exited
      expect(existsSync(join(userDataDir, 'session.lock'))).toBe(true)

      const second = await launchStorePro(userDataDir)
      await expect(
        second.window.getByText("StorePro didn't close properly last time")
      ).toBeVisible()
      expect(readLog(userDataDir)).toContain('Database integrity check finished')
      await second.app.close()
      expect(existsSync(join(userDataDir, 'session.lock'))).toBe(false)

      const third = await launchStorePro(userDataDir)
      await expect(third.window.getByText("StorePro didn't close properly last time")).toHaveCount(
        0
      )
      await third.app.close()
    } finally {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })

  test('shuts down cleanly, closing the database', async () => {
    const userDataDir = createUserDataDir()
    try {
      const { app } = await launchStorePro(userDataDir)
      await app.close()
      const log = readLog(userDataDir)
      expect(log).toContain('Shutdown hook finished {"hook":"database"')
      expect(log).toContain('Shutdown complete')
      // A clean close folds the WAL back into the database file.
      expect(existsSync(join(userDataDir, 'data', 'storepro.db-wal'))).toBe(false)
    } finally {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })
})
