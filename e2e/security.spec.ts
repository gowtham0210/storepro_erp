import { expect, openedExternalUrls, readLog, test } from './fixtures'

test.describe('renderer security', () => {
  test('the UI is served from app:// and has no Node.js access', async ({ ui }) => {
    expect(new URL(ui.url()).protocol).toBe('app:')
    const probe = await ui.evaluate(() => {
      const globals = window as unknown as Record<string, unknown>
      return {
        require: typeof globals['require'],
        process: typeof globals['process'],
        bridge: Object.keys(window.storepro)
      }
    })
    expect(probe).toEqual({
      require: 'undefined',
      process: 'undefined',
      bridge: ['invoke', 'on']
    })
  })

  test('the page can listen only to declared main-process events', async ({ ui }) => {
    const results = await ui.evaluate(() => {
      const on = window.storepro.on as (event: string, listener: () => void) => () => void
      const attempt = (event: string): string => {
        try {
          on(event, () => {})()
          return 'listening'
        } catch (error) {
          return (error as Error).message
        }
      }
      return {
        declared: attempt('connectivity:changed'),
        // An invoke channel, and an Electron-internal one: neither can be listened to.
        invokeChannel: attempt('auth:sign-in'),
        internal: attempt('ELECTRON_BROWSER_REQUIRE')
      }
    })
    expect(results.declared).toBe('listening')
    expect(results.invokeChannel).toMatch(/Unknown event: auth:sign-in/)
    expect(results.internal).toMatch(/Unknown event/)
  })

  test('IPC rejects unknown channels and invalid input', async ({ ui }) => {
    const results = await ui.evaluate(async () => {
      const invoke = window.storepro.invoke as (
        channel: string,
        input?: unknown
      ) => Promise<unknown>
      return {
        unknown: await invoke('db:drop-everything'),
        invalid: await invoke('log:write', { level: 'fatal', message: '' }),
        valid: await invoke('app:get-info')
      }
    })
    expect(results.unknown).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } })
    expect(results.invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    expect(results.valid).toMatchObject({ ok: true, data: { name: 'StorePro', isPackaged: false } })
  })

  test('the content security policy blocks inline scripts', async ({ ui }) => {
    const ran = await ui.evaluate(async () => {
      const flags = window as unknown as { inlineRan?: boolean }
      flags.inlineRan = false
      const script = document.createElement('script')
      script.textContent = 'window.inlineRan = true'
      document.head.append(script)
      await new Promise((resolve) => setTimeout(resolve, 200))
      return flags.inlineRan
    })
    expect(ran).toBe(false)
  })

  test('navigation away from the app is blocked', async ({ storepro, ui }) => {
    const before = ui.url()
    await ui.evaluate(() => {
      location.href = 'https://example.com/'
    })
    await ui.waitForTimeout(500)
    expect(ui.url()).toBe(before)
    expect(readLog(storepro.userDataDir)).toContain('Blocked navigation')
  })

  test('pop-ups never open; only safe https links go to the system browser', async ({
    storepro,
    ui
  }) => {
    const results = await ui.evaluate(() => [
      window.open('https://example.com/help'),
      window.open('http://insecure.example.com/'),
      window.open('file:///C:/Windows/System32/calc.exe')
    ])
    expect(results).toEqual([null, null, null])
    expect(storepro.app.windows()).toHaveLength(1)
    await expect.poll(() => openedExternalUrls(storepro)).toEqual(['https://example.com/help'])
    expect(readLog(storepro.userDataDir)).toContain('Blocked window.open')
  })

  test('renderer log entries reach the log file with secrets masked', async ({ storepro, ui }) => {
    await ui.evaluate(() =>
      window.storepro.invoke('log:write', {
        level: 'info',
        message: 'e2e log entry',
        context: { password: 'hunter2', cashier: 'cashier1' }
      })
    )
    const log = readLog(storepro.userDataDir)
    expect(log).toContain('e2e log entry')
    expect(log).toContain('cashier1')
    expect(log).not.toContain('hunter2')
  })
})
