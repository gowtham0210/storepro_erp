import { expect, readLog, test } from './fixtures'

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
    expect(probe).toEqual({ require: 'undefined', process: 'undefined', bridge: ['invoke'] })
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

  test('navigation away from the app and pop-up windows are blocked', async ({ storepro, ui }) => {
    const before = ui.url()
    expect(await ui.evaluate(() => window.open('https://example.com') === null)).toBe(true)
    await ui.evaluate(() => {
      location.href = 'https://example.com/'
    })
    await ui.waitForTimeout(500)
    expect(ui.url()).toBe(before)
    expect(storepro.app.windows()).toHaveLength(1)
    expect(readLog(storepro.userDataDir)).toContain('Blocked navigation')
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
