import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { ADMIN, fakeBackend } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

async function axeViolations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']
    },
    rules: { 'color-contrast': { enabled: false } }
  })
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )
}

describe('first run', () => {
  it('asks for the administrator account, checks the password, and signs in', async () => {
    fakeBackend.authState = { status: 'setup-required' }
    fakeBackend.on('auth:create-initial-admin', (input) => {
      fakeBackend.authState = {
        status: 'signed-in',
        user: { ...ADMIN, username: input.username, displayName: input.displayName }
      }
      return fakeBackend.authState.user
    })
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up StorePro' })).toBeTruthy()
    expect(await axeViolations()).toEqual([])

    await userEvent.type(screen.getByLabelText(/Your name/), 'Ravi Kumar')
    await userEvent.type(screen.getByLabelText(/^Username/), 'owner')
    await userEvent.type(screen.getByLabelText(/^Password/), 'owner-pass-1')
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'different-1')
    await userEvent.click(screen.getByRole('button', { name: 'Create account and continue' }))
    expect(screen.getByText("Don't include your username in the password")).toBeTruthy()

    await userEvent.clear(screen.getByLabelText(/^Password/))
    await userEvent.type(screen.getByLabelText(/^Password/), 'counter-top-42')
    await userEvent.click(screen.getByRole('button', { name: 'Create account and continue' }))
    expect(screen.getByText("The passwords don't match")).toBeTruthy()

    await userEvent.clear(screen.getByLabelText(/Confirm password/))
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'counter-top-42')
    await userEvent.click(screen.getByRole('button', { name: 'Create account and continue' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy()
    expect(fakeBackend.callsTo('auth:create-initial-admin')).toEqual([
      { displayName: 'Ravi Kumar', username: 'owner', password: 'counter-top-42' }
    ])
  })
})

describe('sign in', () => {
  it('shows one message for any wrong username or password', async () => {
    fakeBackend.authState = { status: 'signed-out' }
    fakeBackend.on('auth:sign-in', () => {
      throw new AppError('UNAUTHENTICATED', 'The username or password is incorrect.')
    })
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(await axeViolations()).toEqual([])
    await userEvent.type(screen.getByLabelText('Username'), 'owner')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-one')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('The username or password is incorrect.')).toBeTruthy()
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
  })

  it('counts down and disables sign-in while blocked', async () => {
    fakeBackend.authState = { status: 'signed-out' }
    fakeBackend.on('auth:sign-in', () => {
      throw new AppError('RATE_LIMITED', 'Too many attempts. Wait a moment and try again.', {
        retryAfterMs: 30_000
      })
    })
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    await userEvent.type(screen.getByLabelText('Username'), 'owner')
    await userEvent.type(screen.getByLabelText('Password'), 'anything-1')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const button = await screen.findByRole('button', { name: /Try again in 30 seconds/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('warns when Caps Lock is on and can reveal the password', async () => {
    fakeBackend.authState = { status: 'signed-out' }
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    const password = screen.getByLabelText('Password') as HTMLInputElement
    fireEvent.keyDown(password, { key: 'A', modifierCapsLock: true })
    expect(screen.getByText('Caps Lock is on')).toBeTruthy()
    expect(password.getAttribute('aria-describedby')).toContain(
      screen.getByText('Caps Lock is on').id
    )
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password.type).toBe('text')
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })
})

describe('session', () => {
  it('locks with Ctrl+L over the app, and unlocks with the password', async () => {
    fakeBackend.on('auth:lock', () => {
      fakeBackend.authState = { status: 'locked', user: ADMIN }
    })
    fakeBackend.on('auth:unlock', () => {
      fakeBackend.authState = { status: 'signed-in', user: ADMIN }
      return ADMIN
    })
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    fireEvent.keyDown(window, { key: 'l', code: 'KeyL', ctrlKey: true })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'StorePro is locked' })
    ).toBeTruthy()
    // The app is still there underneath, but unreachable.
    const appRoot = screen
      .getByRole('heading', { level: 1, name: 'Billing', hidden: true })
      .closest('[inert]')
    expect(appRoot).not.toBeNull()
    // Background shortcuts don't work while locked.
    fireEvent.keyDown(window, { key: '4', code: 'Digit4', ctrlKey: true })
    expect(screen.queryByRole('heading', { level: 1, name: 'Products', hidden: true })).toBeNull()
    expect(await axeViolations()).toEqual([])

    await userEvent.type(screen.getByLabelText('Password'), 'counter-top-42')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(screen.queryByText('StorePro is locked')).toBeNull())
    expect(screen.getByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy()
  })

  it('makes a user with a reset password choose a new one first', async () => {
    fakeBackend.authState = { status: 'signed-in', user: { ...ADMIN, mustChangePassword: true } }
    renderApp('/billing')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose a new password' })
    ).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(await axeViolations()).toEqual([])
  })

  it('signs out from the account menu and forgets what was loaded', async () => {
    fakeBackend.on('auth:sign-out', () => {
      fakeBackend.authState = { status: 'signed-out' }
    })
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    await userEvent.click(screen.getByRole('button', { name: /Ravi Kumar/ }))
    const menu = screen.getByRole('list', { name: 'Account' })
    await userEvent.click(within(menu).getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
  })

  it('closes the account menu with Escape and returns focus to its button', async () => {
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    const trigger = screen.getByRole('button', { name: /Ravi Kumar/ })
    await userEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await userEvent.keyboard('{Escape}')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })
})

describe('users page', () => {
  const meena = {
    userId: 7,
    username: 'meena',
    displayName: 'Meena Sundar',
    roleCode: 'cashier' as const,
    roleName: 'Cashier',
    active: true,
    mustChangePassword: false,
    lastSignInAt: null,
    createdAt: 0
  }

  it('lists users and adds one, showing server errors on the right field', async () => {
    let attempts = 0
    fakeBackend.on('users:list', () => [
      {
        ...meena,
        userId: 1,
        username: 'owner',
        displayName: 'Ravi Kumar',
        roleCode: 'administrator',
        roleName: 'Administrator'
      }
    ])
    fakeBackend.on('users:list-roles', () => [
      { roleCode: 'administrator', name: 'Administrator' },
      { roleCode: 'cashier', name: 'Cashier' }
    ])
    fakeBackend.on('users:create', (input) => {
      attempts++
      if (attempts === 1) {
        throw new AppError('CONFLICT', 'That username is already taken', [
          { path: 'username', message: 'That username is already taken' }
        ])
      }
      return { ...meena, username: input.username, displayName: input.displayName }
    })
    renderApp('/users')
    expect(await screen.findByText('(you)')).toBeTruthy()
    expect(await axeViolations()).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add user' })
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Meena Sundar')
    await userEvent.type(within(dialog).getByLabelText(/^Username/), 'owner')
    await userEvent.type(within(dialog).getByLabelText(/^Password/), 'till-drawer-77')
    await userEvent.type(within(dialog).getByLabelText(/Confirm password/), 'till-drawer-77')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add user' }))
    expect(await within(dialog).findByText('That username is already taken')).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/^Username/))

    await userEvent.clear(within(dialog).getByLabelText(/^Username/))
    await userEvent.type(within(dialog).getByLabelText(/^Username/), 'meena')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add user' }))
    expect(await screen.findByText('Meena Sundar can now sign in as meena.')).toBeTruthy()
  })

  it('asks before deactivating someone', async () => {
    fakeBackend.on('users:list', () => [meena])
    fakeBackend.on('users:set-active', ({ active }) => ({ ...meena, active }))
    renderApp('/users')
    await screen.findByText('Meena Sundar')
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Meena Sundar?' })
    expect(document.activeElement?.textContent).toBe('Cancel')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() =>
      expect(fakeBackend.callsTo('users:set-active')).toEqual([{ userId: 7, active: false }])
    )
  })

  it('Enter on a row button runs that button, not the row', async () => {
    fakeBackend.on('users:list', () => [meena])
    renderApp('/users')
    await screen.findByText('Meena Sundar')
    const button = screen.getByRole('button', { name: 'Reset password' })
    button.focus()
    await act(async () => {
      await userEvent.keyboard('{Enter}')
    })
    expect(
      await screen.findByRole('dialog', { name: "Reset Meena Sundar's password" })
    ).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Edit Meena Sundar' })).toBeNull()
  })
})
