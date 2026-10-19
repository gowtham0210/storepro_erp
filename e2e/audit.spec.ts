import type { Page } from '@playwright/test'
import { expect, goTo, OWNER, signIn, signOut, test } from './fixtures'

const PASSWORD = 'till-drawer-77'

function call(ui: Page, channel: string, input?: unknown) {
  return ui.evaluate(
    ([c, i]) =>
      (
        window as unknown as {
          storepro: { invoke(channel: string, input?: unknown): Promise<unknown> }
        }
      ).storepro.invoke(c as string, i),
    [channel, input] as const
  )
}

test.describe('audit log (M07)', () => {
  test('records what people did, and shows it to the owner with filters', async ({ ui }) => {
    await expect(
      call(ui, 'users:create', {
        username: 'meena',
        displayName: 'Meena Sundar',
        roleCode: 'cashier',
        password: PASSWORD
      })
    ).resolves.toMatchObject({ ok: true })
    await signOut(ui)

    // The cashier tries something her role doesn't allow.
    await signIn(ui, { username: 'meena', password: PASSWORD })
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
    await expect(call(ui, 'users:list')).resolves.toMatchObject({ ok: false })
    await expect(call(ui, 'audit:list', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' }
    })
    await signOut(ui)

    await signIn(ui, OWNER)
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
    await ui
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: /Audit log/ })
      .click()
    await expect(ui.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible()
    const table = ui.getByRole('table', { name: /Audit log entries/ })
    await expect(
      table.getByRole('row', { name: /Meena Sundar.*Refused: not allowed/ })
    ).toHaveCount(2)
    await expect(
      table.getByRole('row', {
        name: /Ravi Kumar.*Added a user.*Meena Sundar \(meena\) as Cashier/
      })
    ).toBeVisible()

    await ui.getByLabel('Person').selectOption({ label: 'Meena Sundar (meena)' })
    await expect(table.getByRole('row', { name: /Ravi Kumar/ })).toHaveCount(0)
    await ui.getByLabel('Action').selectOption({ label: 'Signed in' })
    await expect(table.getByRole('row')).toHaveCount(2) // header + one sign-in
    await ui.getByRole('button', { name: 'Clear filters' }).click()
    await expect(table.getByRole('row', { name: /Ravi Kumar/ }).first()).toBeVisible()

    // One user's history, from the Users screen.
    await goTo(ui, '/users')
    await ui.getByRole('button', { name: 'History of Meena Sundar' }).click()
    await expect(ui.getByText('Showing the history of Meena Sundar only.')).toBeVisible()
    await expect(table.getByRole('row', { name: /Added a user/ })).toBeVisible()
  })
})
