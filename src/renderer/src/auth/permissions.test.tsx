import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { ToastProvider } from '../components/ui/Toast'
import { ShortcutProvider } from '../shortcuts/ShortcutProvider'
import { ADMIN, fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'
import { ManagerApprovalProvider, useManagerApproval } from './ManagerApproval'

async function axeViolations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } }
  })
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )
}

function navItems(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Main' })
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent?.replace(/Ctrl\+\d/, '').trim() ?? '')
    .filter((label) => label !== 'Components') // the dev-only gallery
}

describe('screens by role (M06-04)', () => {
  it('shows a cashier only the screens their role allows', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('cashier') }
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    expect(navItems()).toEqual(['Billing', 'Sales', 'Customers', 'Products', 'Inventory'])
  })

  it('starts an inventory operator on the first screen they may open, not on Billing', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('inventory_operator') }
    renderApp('/')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Products' }, { timeout: 5000 })
    ).toBeTruthy()
    expect(navItems()).not.toContain('Billing')
    expect(navItems()).toContain('Purchases')
  })

  it('explains when a role opens no screens at all', async () => {
    fakeBackend.authState = { status: 'signed-in', user: { ...ADMIN, permissions: [] } }
    renderApp('/')
    expect(await screen.findByText("Your role doesn't include any screens yet")).toBeTruthy()
  })
})

describe('users page for a manager', () => {
  const owner = {
    userId: 1,
    username: 'owner',
    displayName: 'Ravi Kumar',
    roleCode: 'administrator' as const,
    roleName: 'Administrator',
    active: true,
    mustChangePassword: false,
    lastSignInAt: null,
    createdAt: 0
  }
  const manager = userWithRole('manager', { userId: 2, displayName: 'Arjun' })
  const cashier = {
    ...owner,
    userId: 3,
    username: 'meena',
    displayName: 'Meena',
    roleCode: 'cashier' as const,
    roleName: 'Cashier'
  }

  function asManager() {
    fakeBackend.authState = { status: 'signed-in', user: manager }
    fakeBackend.on('users:list', () => [
      owner,
      { ...owner, ...manager, roleName: 'Manager' },
      cashier
    ])
    renderApp('/users')
  }

  it("can't change an administrator's account, but can change a cashier's", async () => {
    asManager()
    await screen.findByText('Meena')
    const ownerRow = screen.getByText('Ravi Kumar').closest('tr')!
    expect(
      within(ownerRow)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['History'])
    expect(
      within(ownerRow).getByText('Only an administrator can change this account.')
    ).toBeTruthy()
    const cashierRow = screen.getByText('Meena').closest('tr')!
    expect(within(cashierRow).getByRole('button', { name: 'Edit' })).toBeTruthy()

    // Activating the row explains instead of doing nothing.
    await userEvent.click(ownerRow)
    await waitFor(() =>
      expect(screen.getAllByText('Only an administrator can change this account.')).toHaveLength(2)
    )
  })

  it('only offers roles the manager may give out', async () => {
    asManager()
    await screen.findByText('Meena')
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add user' })
    const options = within(within(dialog).getByLabelText(/Role/)).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Manager',
      'Cashier',
      'Inventory operator'
    ])
  })

  it('warns a manager before they take away their own user management', async () => {
    asManager()
    fakeBackend.on('users:update', (input) => ({ ...owner, ...input }))
    await screen.findByText('Meena')
    const myRow = screen.getByText('(you)').closest('tr')!
    await userEvent.click(within(myRow).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Arjun' })
    await userEvent.selectOptions(within(dialog).getByLabelText(/Role/), 'cashier')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    const warning = await screen.findByRole('dialog', { name: 'Remove your own manager role?' })
    expect(within(warning).getByText(/lose access to user management/)).toBeTruthy()
    await userEvent.click(within(warning).getByRole('button', { name: 'Cancel' }))
    expect(fakeBackend.callsTo('users:update')).toEqual([])
  })

  it('shows what each role can do', async () => {
    asManager()
    await screen.findByText('Meena')
    await userEvent.click(screen.getByRole('button', { name: 'What each role can do' }))
    const dialog = await screen.findByRole('dialog', { name: 'What each role can do' })
    const table = within(dialog).getByRole('table', { name: 'Permissions of each role' })
    const row = within(table).getByRole('row', { name: /Void a completed sale/ })
    // Columns: administrator, manager, cashier, inventory operator.
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent?.replace('–', ''))
    ).toEqual(['Allowed', 'Allowed', 'Not allowed', 'Not allowed'])
    expect(await axeViolations()).toEqual([])
  })
})

describe('manager approval (M06-05)', () => {
  const restricted = () =>
    new AppError('FORBIDDEN', "Your role doesn't allow this: void a completed sale.", {
      permission: 'sale.void',
      overridable: true
    })

  /** A pretend restricted action: refused without an approval id, done with one. */
  function Probe({ run }: { run: (overrideId?: string) => Promise<string> }): React.JSX.Element {
    const withApproval = useManagerApproval()
    const [result, setResult] = useState('idle')
    return (
      <>
        <button
          type="button"
          onClick={() => {
            withApproval(run).then(
              (value) => setResult(value ?? 'cancelled'),
              (error: unknown) => setResult(`failed: ${(error as Error).message}`)
            )
          }}
        >
          Void sale
        </button>
        <output>{result}</output>
      </>
    )
  }

  function renderProbe(run: (overrideId?: string) => Promise<string>) {
    render(
      <ShortcutProvider>
        <ToastProvider>
          <ManagerApprovalProvider>
            <Probe run={run} />
          </ManagerApprovalProvider>
        </ToastProvider>
      </ShortcutProvider>
    )
  }

  it('asks a manager, then repeats the request with their approval', async () => {
    const seen: (string | undefined)[] = []
    renderProbe(async (overrideId) => {
      seen.push(overrideId)
      if (!overrideId) throw restricted()
      return 'voided'
    })
    let attempts = 0
    fakeBackend.on('auth:approve-override', ({ password }) => {
      attempts++
      if (password !== 'back-office-31') {
        throw new AppError('UNAUTHENTICATED', 'The username or password is incorrect.')
      }
      return { overrideId: 'approval-1', approvedBy: 'Arjun', expiresAt: 0 }
    })

    await userEvent.click(screen.getByRole('button', { name: 'Void sale' }))
    const dialog = await screen.findByRole('dialog', { name: 'Manager approval needed' })
    expect(within(dialog).getByText(/“Void a completed sale” needs approval/)).toBeTruthy()
    expect(await axeViolations()).toEqual([])

    await userEvent.type(within(dialog).getByLabelText("Approver's username"), 'arjun')
    await userEvent.type(within(dialog).getByLabelText("Approver's password"), 'wrong-one')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await within(dialog).findByText('The username or password is incorrect.')).toBeTruthy()

    await userEvent.type(within(dialog).getByLabelText("Approver's password"), 'back-office-31')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('voided')).toBeTruthy()
    expect(seen).toEqual([undefined, 'approval-1'])
    expect(attempts).toBe(2)
    expect(fakeBackend.callsTo('auth:approve-override')[1]).toEqual({
      username: 'arjun',
      password: 'back-office-31',
      permission: 'sale.void'
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('gives up quietly when the approval is cancelled', async () => {
    renderProbe(async () => {
      throw restricted()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Void sale' }))
    const dialog = await screen.findByRole('dialog', { name: 'Manager approval needed' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('cancelled')).toBeTruthy()
    expect(fakeBackend.callsTo('auth:approve-override')).toEqual([])
  })

  it("doesn't offer approval for anything else", async () => {
    renderProbe(async () => {
      throw new AppError('FORBIDDEN', 'Only for administrators.', {
        permission: 'settings.edit',
        overridable: false
      })
    })
    await userEvent.click(screen.getByRole('button', { name: 'Void sale' }))
    expect(await screen.findByText('failed: Only for administrators.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
