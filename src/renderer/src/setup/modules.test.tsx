import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ModuleState } from '@shared/ipc/contract'
import type { ModuleCode } from '@shared/modules'
import { fakeBackend, STORE, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

function state(code: ModuleCode, name: string, overrides: Partial<ModuleState> = {}): ModuleState {
  return {
    code,
    name,
    description: `${name} features.`,
    availability: 'available',
    plannedFor: null,
    enabled: false,
    enabledAt: null,
    locked: null,
    ...overrides
  }
}

describe('modules (M04)', () => {
  it('lists the modules, with the store type always on and planned ones not offered', async () => {
    renderApp('/settings')
    const section = await screen.findByRole('region', { name: 'Modules' }, { timeout: 5000 })
    const grocery = (await within(section).findByText('Grocery and retail')).closest('li')!
    expect(within(grocery).getByText('On')).toBeTruthy()
    expect(within(grocery).getByText(/always on/)).toBeTruthy()
    const restaurant = within(section).getByText('Restaurant').closest('li')!
    expect(within(restaurant).getByText('Coming in Release 1.3')).toBeTruthy()
    expect(within(section).queryByRole('button')).toBeNull()
  })

  it('switches a module on, and its screens appear', async () => {
    let enabled: ModuleCode[] = ['grocery']
    const modules = () => [
      state('grocery', 'Grocery and retail', { enabled: true, locked: 'Always on.' }),
      state('electronics', 'Electronics', { enabled: enabled.includes('electronics') })
    ]
    fakeBackend.on('modules:list', modules)
    fakeBackend.on('store:get-profile', () => ({ ...STORE, enabledModules: enabled }))
    fakeBackend.on('modules:set-enabled', ({ code, enabled: on }) => {
      enabled = on ? [...enabled, code] : enabled.filter((c) => c !== code)
      return modules()
    })
    renderApp('/settings')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).queryByText('Serial numbers')).toBeNull()

    await userEvent.click(await screen.findByRole('button', { name: 'Switch on Electronics' }))
    expect(await screen.findByText('Electronics is switched on.')).toBeTruthy()
    await waitFor(() => expect(within(nav).getByText('Serial numbers')).toBeTruthy())

    // Switching off asks first, and says nothing is deleted.
    await userEvent.click(screen.getByRole('button', { name: 'Switch off Electronics' }))
    const dialog = await screen.findByRole('dialog', { name: 'Switch Electronics off?' })
    expect(within(dialog).getByText(/Nothing is deleted/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch off' }))
    await waitFor(() => expect(within(nav).queryByText('Serial numbers')).toBeNull())
    expect(fakeBackend.callsTo('modules:set-enabled')).toEqual([
      { code: 'electronics', enabled: true },
      { code: 'electronics', enabled: false }
    ])
  })

  it("explains a module's screen opened while the module is off", async () => {
    renderApp('/tables')
    expect(
      await screen.findByText('Tables is part of the Restaurant module, which is switched off')
    ).toBeTruthy()
  })

  it('shows a module screen as planned while the module is on', async () => {
    fakeBackend.on('store:get-profile', () => ({
      ...STORE,
      enabledModules: ['grocery', 'restaurant']
    }))
    renderApp('/tables')
    expect(await screen.findByRole('heading', { level: 1, name: 'Tables' })).toBeTruthy()
    expect(screen.getByText('It is planned in Restaurant · Release 1.3.')).toBeTruthy()
  })

  it('is read-only for managers', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('manager') }
    fakeBackend.on('modules:list', () => [state('electronics', 'Electronics')])
    renderApp('/settings')
    const section = await screen.findByRole('region', { name: 'Modules' }, { timeout: 5000 })
    await within(section).findByText('Electronics')
    expect(within(section).queryByRole('button')).toBeNull()
  })
})
