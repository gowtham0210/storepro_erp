import { homedir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, test } from '@playwright/test'
import { APP_DIR, ELECTRON_PATH, EXTRA_ARGS, launchEnv } from '../fixtures'
import { fillCatalogue } from './southIndianCatalogue'

/**
 * Fills a store you are exploring with a South Indian provision store's catalogue:
 * loose rice, dals and spices sold by weight, packed brands with barcodes, oils, dairy,
 * personal care and pooja items, with opening stock. A few items start below their
 * reorder level and one is out of stock, so the low-stock views have something to show.
 *
 * It drives the real app through the same calls the screens make, signed in as you:
 * the app opens, you sign in, and the script does the rest. Products whose SKU already
 * exists are skipped, so it is safe to run again. Close StorePro first, then:
 *
 *   npx electron-vite build
 *   npx playwright test --config e2e/demo/playwright.demo.config.ts
 *
 * The data folder is ~/StorePro-explore unless STOREPRO_SEED_DIR names another. The GST
 * rates and prices are illustrative demo values, not tax advice.
 */

test.setTimeout(10 * 60_000)

test('fill the store with a South Indian provision store catalogue', async () => {
  const dataDir = process.env['STOREPRO_SEED_DIR'] ?? join(homedir(), 'StorePro-explore')
  const app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [...EXTRA_ARGS, APP_DIR],
    env: launchEnv(dataDir)
  })
  try {
    const ui = await app.firstWindow()
    const heading = ui.getByRole('heading', { level: 1 })
    await heading.waitFor()
    if ((await heading.textContent()) === 'Set up StorePro') {
      throw new Error(`The store in ${dataDir} is not set up yet. Set it up in the app first.`)
    }
    // You sign in, in the window that just opened; the script never handles your password.
    console.log('\n>>> Sign in to StorePro in the window that opened. Waiting up to 5 minutes...\n')
    await ui.getByRole('heading', { level: 1, name: 'Billing' }).waitFor({ timeout: 5 * 60_000 })

    console.log(`\n${await fillCatalogue(ui)}\n`)
  } finally {
    await app.close()
  }
})
