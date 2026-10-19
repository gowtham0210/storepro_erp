import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import {
  closeStorePro,
  createUserDataDir,
  expect,
  goTo,
  launchStorePro,
  OWNER,
  removeUserDataDir,
  signIn,
  test
} from './fixtures'

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
)

/** WCAG checks including colour contrast, on whatever is on screen. */
async function axeViolations(ui: Page): Promise<string[]> {
  await ui.evaluate(axeSource)
  return ui.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options: object
          ) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }>
        }
      }
    ).axe
    const result = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']
      }
    })
    return result.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
    )
  })
}

async function onStep(ui: Page, title: string): Promise<void> {
  await expect(ui.getByRole('heading', { level: 2, name: title })).toBeVisible()
  expect(await axeViolations(ui), title).toEqual([])
}

const next = (ui: Page) => ui.getByRole('button', { name: 'Continue' }).click()

test.describe('store setup (M03)', () => {
  test('first run sets up the store; it survives a restart and can be changed in Settings', async () => {
    const userDataDir = createUserDataDir()
    try {
      const first = await launchStorePro(userDataDir, { signIn: false })
      const ui = first.window
      await expect(ui.getByRole('heading', { level: 1, name: 'Set up StorePro' })).toBeVisible()

      await onStep(ui, 'Store details')
      await next(ui)
      await expect(ui.getByText('Enter the store name')).toBeVisible()
      await ui.getByLabel(/^Store name/).fill('Lakshmi Stores')
      await ui.getByLabel(/^Phone number/).fill('044 2345 6789')
      await ui.getByLabel(/^Street address/).fill('4 Bazaar Street')
      await ui.getByLabel(/^City or town/).fill('Chennai')
      await ui.getByLabel(/^State/).selectOption({ label: 'Tamil Nadu' })
      await ui.getByLabel(/^PIN code/).fill('600001')
      await next(ui)

      await onStep(ui, 'Business and region')
      await ui.getByLabel(/^Time zone/).selectOption('Asia/Kolkata')
      await next(ui)

      await onStep(ui, 'Tax')
      await ui
        .getByRole('group', { name: 'Is the store registered for GST?' })
        .getByRole('radio', { name: /^Yes/ })
        .check()
      await ui.getByLabel(/^GSTIN/).fill('33AAPFU0939F1Z2')
      await next(ui)

      await onStep(ui, 'Receipts')
      await ui.getByLabel(/^Invoice number prefix/).fill('LS')
      await ui.getByLabel(/Message at the bottom/).fill('Thank you! Visit again.')
      await expect(ui.getByRole('figure', { name: 'Receipt preview' })).toContainText('LS000001')
      await next(ui)

      await onStep(ui, 'Your account')
      await ui.getByLabel(/^Your name/).fill(OWNER.displayName)
      await ui.getByLabel(/^Username/).fill(OWNER.username)
      await ui.getByLabel(/^Password/).fill(OWNER.password)
      await ui.getByLabel(/^Confirm password/).fill(OWNER.password)
      await next(ui)

      await onStep(ui, 'Check and finish')
      await ui.getByRole('button', { name: 'Finish setup' }).click()
      await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
      await closeStorePro(first)

      // The next start asks to sign in, and remembers the store.
      const second = await launchStorePro(userDataDir, { signIn: false })
      await signIn(second.window, OWNER)
      await expect(second.window.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
      await goTo(second.window, '/settings')
      const details = second.window.getByRole('region', { name: 'Store details' })
      await expect(details.getByLabel(/^Store name/)).toHaveValue('Lakshmi Stores')
      await expect(
        second.window.getByRole('region', { name: 'Tax' }).getByLabel(/^GSTIN/)
      ).toHaveValue('33AAPFU0939F1Z2')

      // A change in Settings is saved and audited.
      const receipts = second.window.getByRole('region', { name: 'Receipts' })
      await receipts.getByLabel(/Message at the bottom/).fill('Exchange within 7 days.')
      await receipts.getByRole('button', { name: 'Save receipts' }).click()
      await expect(second.window.getByText('Receipts saved.')).toBeVisible()

      const policy = second.window.getByRole('region', { name: 'Rounding and discounts' })
      await policy.getByLabel(/^Round bill totals/).selectOption('100')
      await policy.getByRole('button', { name: 'Save rounding and discounts' }).click()
      await expect(second.window.getByText('Rounding and discounts saved.')).toBeVisible()

      await goTo(second.window, '/audit')
      await expect(
        second.window.getByRole('row', {
          name: /Changed store settings.*receipt footer from Thank you! Visit again\. to Exchange within 7 days\./i
        })
      ).toBeVisible()
      await expect(
        second.window.getByRole('row', {
          name: /Changed rounding or discount limit.*bill rounding from not rounded to nearest ₹1\.00/i
        })
      ).toBeVisible()
      await expect(second.window.getByRole('row', { name: /Set up the store/ })).toBeVisible()
      await closeStorePro(second)
    } finally {
      removeUserDataDir(userDataDir)
    }
  })
})
