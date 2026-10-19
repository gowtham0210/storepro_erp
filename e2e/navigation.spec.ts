import { expect, goTo, test } from './fixtures'

test.describe('shell and navigation', () => {
  test('opens on Billing with the window title set', async ({ ui }) => {
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
    await expect(ui).toHaveTitle('Billing · StorePro')
    await expect(
      ui.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Billing/ })
    ).toHaveAttribute('aria-current', 'page')
  })

  test('Ctrl+number switches screens and moves focus to the new heading', async ({ ui }) => {
    await ui.keyboard.press('Control+4')
    const heading = ui.getByRole('heading', { level: 1, name: 'Products' })
    await expect(heading).toBeFocused()
    await ui.keyboard.press('Control+Comma')
    await expect(ui.getByRole('heading', { level: 1, name: 'Settings' })).toBeFocused()
  })

  test('F1 lists shortcuts and Esc returns focus to where it was', async ({ ui }) => {
    const button = ui.getByRole('button', { name: /Shortcuts/ })
    await button.focus()
    await ui.keyboard.press('F1')
    const dialog = ui.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Go to Products')).toBeVisible()
    await ui.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(button).toBeFocused()
  })

  test('text size scales the whole interface and resets', async ({ ui }) => {
    const rootSize = () => ui.evaluate(() => getComputedStyle(document.documentElement).fontSize)
    expect(await rootSize()).toBe('16px')
    await ui.keyboard.press('Control+Equal')
    await ui.keyboard.press('Control+Equal')
    await expect.poll(rootSize).toBe('20px')
    await expect(ui.getByText('Text size 125% · Ctrl+0 to reset')).toBeVisible()
    await ui.keyboard.press('Control+0')
    await expect.poll(rootSize).toBe('16px')
  })

  test('unknown addresses show a way back', async ({ ui }) => {
    await goTo(ui, '/does-not-exist')
    await expect(ui.getByText("There's nothing at this address")).toBeVisible()
    await ui.getByRole('button', { name: 'Go to Billing' }).click()
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
  })

  test('development tools are not reachable in the built app', async ({ ui }) => {
    await expect(ui.getByRole('navigation', { name: 'Main' }).getByText('Components')).toHaveCount(
      0
    )
    await goTo(ui, '/dev/components')
    await expect(ui.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  })
})
