import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../state/uiStore'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

afterEach(() => {
  useUiStore.setState({ uiScale: 100, sidebarCollapsed: false })
})

describe('AppShell', () => {
  it('starts on Billing with landmarks, a skip link and the current page marked', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe(
      '#main'
    )
    const current = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      current: 'page'
    })
    expect(current.textContent).toContain('Billing')
    // The title is set in an effect, which can run just after the heading appears.
    await waitFor(() => expect(document.title).toBe('Billing · StorePro'))
  })

  it('navigates with Ctrl+number and moves focus to the new page heading', async () => {
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    fireEvent.keyDown(window, { key: '4', code: 'Digit4', ctrlKey: true })
    const heading = await screen.findByRole('heading', { level: 1, name: 'Products' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('hides screens the user may not open, and explains when one is opened directly', async () => {
    fakeBackend.authState = {
      status: 'signed-in',
      user: userWithRole('cashier')
    }
    renderApp('/users')
    expect(await screen.findByText("You don't have access to Users")).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).queryByText('Users')).toBeNull()
    expect(within(nav).getByText('Billing')).toBeTruthy()
  })

  it('keeps loading data while the computer is offline', async () => {
    const { router } = renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    try {
      // A screen that loads new data after the connection dropped.
      fakeBackend.on('users:list', () => [
        {
          userId: 7,
          username: 'meena',
          displayName: 'Meena Sundar',
          roleCode: 'cashier',
          roleName: 'Cashier',
          active: true,
          mustChangePassword: false,
          lastSignInAt: null,
          createdAt: 0
        }
      ])
      await act(() => router.navigate('/users'))
      expect(await screen.findByText('Meena Sundar')).toBeTruthy()
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
    }
  })

  it('shows the connectivity state and reassures when offline', async () => {
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    expect(screen.getByText('Online')).toBeTruthy()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText('Offline · billing still works')).toBeTruthy()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
  })

  it('lists the shortcuts of the current screen on F1', async () => {
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    fireEvent.keyDown(window, { key: 'F1', code: 'F1' })
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(dialog).getByText('Go to Products')).toBeTruthy()
    expect(within(dialog).getByText('Larger text')).toBeTruthy()
  })

  it('scales text with Ctrl+= and resets with Ctrl+0', async () => {
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    fireEvent.keyDown(window, { key: '=', code: 'Equal', ctrlKey: true })
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('112.5%')
    )
    expect(screen.getByText('Text size 112.5% · Ctrl+0 to reset')).toBeTruthy()
    fireEvent.keyDown(window, { key: '0', code: 'Digit0', ctrlKey: true })
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('100%')
    )
  })

  it('opens Billing when started from the packaged entry document', async () => {
    renderApp('/index.html')
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy()
  })

  it('shows a helpful page for unknown addresses', async () => {
    renderApp('/nowhere')
    expect(await screen.findByText("There's nothing at this address")).toBeTruthy()
  })
})
