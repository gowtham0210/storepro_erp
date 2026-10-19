import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import {
  createUserDataDir,
  expect,
  goTo,
  launchStorePro,
  removeUserDataDir,
  setNetwork,
  test
} from './fixtures'

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
)

/** Full axe-core scan in real Chromium, including colour contrast (which jsdom can't check). */
async function axeViolations(ui: Page): Promise<string[]> {
  await ui.evaluate(axeSource)
  return ui.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options: object
          ) => Promise<{
            violations: { id: string; help: string; nodes: { target: string[] }[] }[]
          }>
        }
      }
    ).axe
    const result = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
      }
    })
    return result.violations.map(
      (v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
    )
  })
}

test.describe('accessibility (WCAG 2.2 AA)', () => {
  for (const path of [
    '/billing',
    '/sales',
    '/products',
    '/inventory',
    '/reports',
    '/settings',
    '/users',
    '/audit',
    '/nowhere'
  ]) {
    test(`${path} has no violations`, async ({ ui }) => {
      await goTo(ui, path)
      await ui.waitForTimeout(200)
      expect(await axeViolations(ui)).toEqual([])
    })
  }

  test('the first-run and sign-in screens have no violations', async () => {
    const userDataDir = createUserDataDir()
    try {
      const { app, window } = await launchStorePro(userDataDir, { signIn: false })
      await expect(window.getByRole('heading', { level: 1, name: 'Set up StorePro' })).toBeVisible()
      expect(await axeViolations(window)).toEqual([])
      await app.close()
    } finally {
      removeUserDataDir(userDataDir)
    }
  })

  test('the lock screen has no violations', async ({ ui }) => {
    await ui.keyboard.press('Control+l')
    await expect(ui.getByRole('heading', { level: 1, name: 'StorePro is locked' })).toBeVisible()
    expect(await axeViolations(ui)).toEqual([])
  })

  test('the shortcut help dialog has no violations', async ({ ui }) => {
    await ui.keyboard.press('F1')
    await expect(ui.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    expect(await axeViolations(ui)).toEqual([])
  })

  test('the role permissions dialog has no violations', async ({ ui }) => {
    await goTo(ui, '/users')
    await ui.getByRole('button', { name: 'What each role can do' }).click()
    await expect(ui.getByRole('table', { name: 'Permissions of each role' })).toBeVisible()
    expect(await axeViolations(ui)).toEqual([])
  })

  test('the offline state has no violations', async ({ storepro, ui }) => {
    await setNetwork(storepro, false)
    await expect(ui.getByText('Offline · billing still works')).toBeVisible({ timeout: 10_000 })
    expect(await axeViolations(ui)).toEqual([])
  })
})
