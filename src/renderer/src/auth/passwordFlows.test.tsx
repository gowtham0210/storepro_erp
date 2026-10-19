import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { ADMIN, fakeBackend } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

describe('forced password change', () => {
  it('requires a different, valid password, then opens the app', async () => {
    fakeBackend.authState = { status: 'signed-in', user: { ...ADMIN, mustChangePassword: true } }
    fakeBackend.on('auth:change-password', ({ currentPassword }) => {
      if (currentPassword !== 'temporary-pass-1') {
        throw new AppError('UNAUTHENTICATED', 'Your current password is incorrect.')
      }
      fakeBackend.authState = { status: 'signed-in', user: ADMIN }
      return ADMIN
    })
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Choose a new password' })

    await userEvent.type(screen.getByLabelText(/Temporary password/), 'temporary-pass-1')
    await userEvent.type(screen.getByLabelText(/^New password/), 'temporary-pass-1')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByText('Choose a password different from your current one')).toBeTruthy()

    await userEvent.clear(screen.getByLabelText(/^New password/))
    await userEvent.type(screen.getByLabelText(/^New password/), 'my-own-pass-55')
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'my-own-pass-55')
    await userEvent.clear(screen.getByLabelText(/Temporary password/))
    await userEvent.type(screen.getByLabelText(/Temporary password/), 'wrong-temp-1')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Your current password is incorrect.')).toBeTruthy()

    await userEvent.clear(screen.getByLabelText(/Temporary password/))
    await userEvent.type(screen.getByLabelText(/Temporary password/), 'temporary-pass-1')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy()
  })

  it('offers a way out by signing out', async () => {
    fakeBackend.authState = { status: 'signed-in', user: { ...ADMIN, mustChangePassword: true } }
    fakeBackend.on('auth:sign-out', () => {
      fakeBackend.authState = { status: 'signed-out' }
    })
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Choose a new password' })
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
  })
})

describe('change password from the account menu', () => {
  it('opens a dialog and confirms the change', async () => {
    fakeBackend.on('auth:change-password', () => ADMIN)
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    await userEvent.click(screen.getByRole('button', { name: /Ravi Kumar/ }))
    await userEvent.click(
      within(screen.getByRole('list', { name: 'Account' })).getByRole('button', {
        name: 'Change password'
      })
    )
    const dialog = await screen.findByRole('dialog', { name: 'Change your password' })
    await userEvent.type(within(dialog).getByLabelText(/Current password/), 'counter-top-42')
    await userEvent.type(within(dialog).getByLabelText(/^New password/), 'new-shop-pass-9')
    await userEvent.type(within(dialog).getByLabelText(/Confirm new password/), 'new-shop-pass-9')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Your password was changed.')).toBeTruthy()
    expect(fakeBackend.callsTo('auth:change-password')).toEqual([
      { currentPassword: 'counter-top-42', newPassword: 'new-shop-pass-9' }
    ])
  })
})

describe('lock screen', () => {
  it('rejects a wrong password, then counts down when blocked', async () => {
    fakeBackend.authState = { status: 'locked', user: ADMIN }
    let attempt = 0
    fakeBackend.on('auth:unlock', () => {
      attempt++
      if (attempt === 1) throw new AppError('UNAUTHENTICATED', 'The password is incorrect.')
      throw new AppError('RATE_LIMITED', 'Too many attempts. Wait a moment and try again.', {
        retryAfterMs: 120_000
      })
    })
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'StorePro is locked' })
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-one-1')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('The password is incorrect.')).toBeTruthy()
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-one-2')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('button', { name: 'Try again in 2 minutes' })).toBeTruthy()
  })

  it('lets someone else sign in instead', async () => {
    fakeBackend.authState = { status: 'locked', user: ADMIN }
    fakeBackend.on('auth:sign-out', () => {
      fakeBackend.authState = { status: 'signed-out' }
    })
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'StorePro is locked' })
    await userEvent.click(screen.getByRole('button', { name: 'Sign in as someone else' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
  })
})

describe('users page dialogs', () => {
  const owner = {
    userId: 1,
    username: 'owner',
    displayName: 'Ravi Kumar',
    roleCode: 'administrator' as const,
    roleName: 'Administrator',
    active: true,
    mustChangePassword: false,
    lastSignInAt: Date.UTC(2026, 9, 19, 4, 30),
    createdAt: 0
  }

  it('warns before you remove your own administrator role', async () => {
    fakeBackend.on('users:list', () => [owner])
    fakeBackend.on('users:update', (input) => ({ ...owner, ...input, roleName: 'Manager' }))
    renderApp('/users')
    await screen.findByText('(you)')
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Ravi Kumar' })
    await userEvent.selectOptions(within(dialog).getByLabelText(/Role/), 'manager')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    const warning = await screen.findByRole('dialog', {
      name: 'Remove your own administrator role?'
    })
    await userEvent.click(within(warning).getByRole('button', { name: 'Change my role' }))
    await waitFor(() =>
      expect(fakeBackend.callsTo('users:update')).toEqual([
        { userId: 1, displayName: 'Ravi Kumar', roleCode: 'manager' }
      ])
    )
  })

  it('resets a password with a temporary one', async () => {
    const meena = {
      ...owner,
      userId: 7,
      username: 'meena',
      displayName: 'Meena',
      roleCode: 'manager' as const,
      roleName: 'Manager'
    }
    fakeBackend.on('users:list', () => [owner, meena])
    fakeBackend.on('users:reset-password', () => ({ ...meena, mustChangePassword: true }))
    renderApp('/users')
    await screen.findByText('Meena')
    await userEvent.click(screen.getAllByRole('button', { name: 'Reset password' })[1]!)
    const dialog = await screen.findByRole('dialog', { name: "Reset Meena's password" })
    await userEvent.type(within(dialog).getByLabelText(/^Temporary password/), 'temporary-pass-1')
    await userEvent.type(
      within(dialog).getByLabelText(/Confirm temporary password/),
      'temporary-pass-1'
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByText(/Meena's password was reset/)).toBeTruthy()
    expect(fakeBackend.callsTo('users:reset-password')).toEqual([
      { userId: 7, newPassword: 'temporary-pass-1' }
    ])
  })
})
