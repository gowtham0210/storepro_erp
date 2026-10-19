import {
  completeSetup,
  createUserDataDir,
  expect,
  goTo,
  launchStorePro,
  OWNER,
  removeUserDataDir,
  signIn,
  signOut,
  test
} from './fixtures'

const CASHIER = { displayName: 'Meena Sundar', username: 'meena', password: 'till-drawer-77' }

test.describe('sign-in and users', () => {
  test('first run creates the administrator; the next start asks to sign in', async () => {
    const userDataDir = createUserDataDir()
    try {
      const first = await launchStorePro(userDataDir, { signIn: false })
      await expect(
        first.window.getByRole('heading', { level: 1, name: 'Set up StorePro' })
      ).toBeVisible()
      await completeSetup(first.window)
      await expect(
        first.window.getByRole('button', { name: /Ravi Kumar · Administrator/ })
      ).toBeVisible()
      await first.app.close()

      const second = await launchStorePro(userDataDir, { signIn: false })
      await expect(second.window.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
      await signIn(second.window, { username: 'owner', password: 'not-my-password' })
      await expect(second.window.getByText('The username or password is incorrect.')).toBeVisible()
      await signIn(second.window, { username: 'OWNER', password: OWNER.password })
      await expect(second.window.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
      await second.app.close()
    } finally {
      removeUserDataDir(userDataDir)
    }
  })

  test('Ctrl+L locks over the current screen; unlocking returns to it', async ({ ui }) => {
    await ui.keyboard.press('Control+4')
    await expect(ui.getByRole('heading', { level: 1, name: 'Products' })).toBeFocused()
    await ui.keyboard.press('Control+l')
    await expect(ui.getByRole('heading', { level: 1, name: 'StorePro is locked' })).toBeVisible()
    await ui.getByLabel('Password', { exact: true }).fill('wrong-password-1')
    await ui.getByRole('button', { name: 'Unlock' }).click()
    await expect(ui.getByText('The password is incorrect.')).toBeVisible()
    await ui.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await ui.getByRole('button', { name: 'Unlock' }).click()
    await expect(ui.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible()
  })

  test('an administrator adds a cashier, who cannot manage users, even by asking the main process', async ({
    ui
  }) => {
    await goTo(ui, '/users')
    await ui.getByRole('button', { name: 'Add user' }).click()
    const dialog = ui.getByRole('dialog', { name: 'Add user' })
    await dialog.getByLabel(/^Name/).fill(CASHIER.displayName)
    await dialog.getByLabel(/^Username/).fill(CASHIER.username)
    await dialog.getByLabel(/^Role/).selectOption('cashier')
    await dialog.getByLabel(/^Password/).fill(CASHIER.password)
    await dialog.getByLabel(/Confirm password/).fill(CASHIER.password)
    await dialog.getByRole('button', { name: 'Add user' }).click()
    await expect(ui.getByText('Meena Sundar can now sign in as meena.')).toBeVisible()
    await expect(ui.getByRole('cell', { name: /Meena Sundar/ })).toBeVisible()

    await signOut(ui)
    await signIn(ui, CASHIER)
    await expect(ui.getByRole('button', { name: /Meena Sundar · Cashier/ })).toBeVisible()
    await expect(ui.getByRole('navigation', { name: 'Main' }).getByText('Users')).toHaveCount(0)
    await goTo(ui, '/users')
    await expect(ui.getByText("You don't have access to Users")).toBeVisible()
    // The UI hiding the screen is a convenience; the main process enforces it.
    const direct = await ui.evaluate(() => window.storepro.invoke('users:list'))
    expect(direct).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })

  test('after a password reset, the user must choose a new password', async ({ ui }) => {
    await goTo(ui, '/users')
    await ui.getByRole('button', { name: 'Add user' }).click()
    let dialog = ui.getByRole('dialog', { name: 'Add user' })
    await dialog.getByLabel(/^Name/).fill(CASHIER.displayName)
    await dialog.getByLabel(/^Username/).fill(CASHIER.username)
    await dialog.getByLabel(/^Password/).fill(CASHIER.password)
    await dialog.getByLabel(/Confirm password/).fill(CASHIER.password)
    await dialog.getByRole('button', { name: 'Add user' }).click()
    await ui
      .getByRole('row', { name: /Meena Sundar/ })
      .getByRole('button', { name: 'Reset password' })
      .click()
    dialog = ui.getByRole('dialog', { name: "Reset Meena Sundar's password" })
    await dialog.getByLabel(/^Temporary password/).fill('temporary-pass-1')
    await dialog.getByLabel(/Confirm temporary password/).fill('temporary-pass-1')
    await dialog.getByRole('button', { name: 'Reset password' }).click()
    await expect(
      ui.getByRole('row', { name: /Meena Sundar/ }).getByText('New password needed')
    ).toBeVisible()

    await signOut(ui)
    await signIn(ui, { username: CASHIER.username, password: 'temporary-pass-1' })
    await expect(ui.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeVisible()
    await ui.getByLabel(/Temporary password/).fill('temporary-pass-1')
    await ui.getByLabel(/^New password/).fill('my-own-pass-55')
    await ui.getByLabel(/Confirm new password/).fill('my-own-pass-55')
    await ui.getByRole('button', { name: 'Change password' }).click()
    await expect(ui.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible()
  })
})
