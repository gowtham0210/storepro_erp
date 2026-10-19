import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, goTo, test } from './fixtures'

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
  for (const path of ['/billing', '/products', '/reports', '/settings', '/nowhere']) {
    test(`${path} has no violations`, async ({ ui }) => {
      await goTo(ui, path)
      await ui.waitForTimeout(200)
      expect(await axeViolations(ui)).toEqual([])
    })
  }

  test('the shortcut help dialog has no violations', async ({ ui }) => {
    await ui.keyboard.press('F1')
    await expect(ui.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    expect(await axeViolations(ui)).toEqual([])
  })

  test('the offline state has no violations', async ({ ui }) => {
    await ui.context().setOffline(true)
    await expect(ui.getByText('Offline · billing still works')).toBeVisible()
    expect(await axeViolations(ui)).toEqual([])
  })
})
