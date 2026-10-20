import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import type { AuditLogEntry, AuditLogFilter } from '@shared/ipc/contract'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'
import { describeAuditEntry } from './describeAuditEntry'

async function axeViolations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } }
  })
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )
}

const RAVI = { userId: 1, displayName: 'Ravi Kumar', username: 'owner' }
const ARJUN = { userId: 2, displayName: 'Arjun', username: 'arjun' }
const MEENA = { userId: 3, displayName: 'Meena', username: 'meena' }

function entry(id: number, overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id,
    occurredAt: Date.UTC(2026, 9, 19, 4, 30) + id * 60_000,
    action: 'user.sign_in',
    actor: RAVI,
    approvedBy: null,
    entity: null,
    details: null,
    ...overrides
  }
}

const LOG: AuditLogEntry[] = [
  entry(5, {
    action: 'override.approved',
    actor: ARJUN,
    entity: { type: 'user', id: 3, label: 'Meena' },
    details: { permission: 'sale.void' }
  }),
  entry(4, { action: 'access.denied', actor: MEENA, details: { permission: 'sale.void' } }),
  entry(3, {
    action: 'user.updated',
    entity: { type: 'user', id: 3, label: 'Meena' },
    details: { changes: { role: { from: 'Cashier', to: 'Manager' } } }
  }),
  entry(2, {
    action: 'system.database_upgraded',
    actor: null,
    details: { fromVersion: 3, toVersion: 4, backupFile: 'pre-migration-v3-to-v4.db' }
  }),
  entry(1, { action: 'user.sign_in' })
]

describe('describeAuditEntry', () => {
  it('turns recorded facts into a sentence', () => {
    expect(LOG.map(describeAuditEntry)).toEqual([
      '“Void a completed sale” for Meena',
      'Tried to void a completed sale',
      'Meena: role from Cashier to Manager',
      'From version 3 to 4. A backup was saved first (pre-migration-v3-to-v4.db)',
      ''
    ])
  })

  it('describes every kind of entry StorePro records', () => {
    const meena = { type: 'user', id: 3, label: 'Meena' }
    const cases: [Partial<AuditLogEntry>, string][] = [
      [
        { action: 'user.sign_in_failed', details: { username: 'meena' } },
        'Username entered: “meena”'
      ],
      [
        {
          action: 'override.denied',
          entity: meena,
          details: { permission: 'stock.adjust', reason: 'wrong_password', username: 'arjun' }
        },
        '“Adjust stock quantities” for Meena: wrong password for “arjun”'
      ],
      [
        {
          action: 'override.denied',
          entity: meena,
          details: { permission: 'stock.adjust', reason: 'not_permitted' }
        },
        "“Adjust stock quantities” for Meena: the approver isn't allowed to do it"
      ],
      [
        {
          action: 'user.created',
          entity: meena,
          details: { username: 'meena', role: 'Cashier', initialSetup: true }
        },
        'Meena (meena) as Cashier, during first-run setup'
      ],
      [
        { action: 'user.created', entity: meena, details: { username: 'meena', role: 'Cashier' } },
        'Meena (meena) as Cashier'
      ],
      [{ action: 'user.password_reset', entity: { type: 'user', id: 3, label: null } }, 'user #3'],
      [{ action: 'user.deactivated', entity: meena }, 'Meena'],
      [{ action: 'user.updated', entity: meena, details: {} }, 'Meena: '],
      [
        {
          action: 'user.updated',
          entity: meena,
          details: { changes: { name: { from: '', to: 'M' } } }
        },
        'Meena: name from nothing to M'
      ],
      [
        {
          action: 'system.database_upgraded',
          details: { fromVersion: 1, toVersion: 2, backupFile: null }
        },
        'From version 1 to 2'
      ],
      [
        { action: 'system.unclean_shutdown', details: { previousSessionStartedAt: 'garbage' } },
        "The previous session didn't close normally"
      ],
      [
        {
          action: 'system.integrity_problems',
          details: { problems: [{ check: 'sale_totals', count: 2 }] }
        },
        'sale_totals: 2'
      ],
      [{ action: 'system.integrity_problems', details: {} }, ''],
      [
        { action: 'access.denied', details: { permission: 'not.a_permission' } },
        'Tried to not.a_permission'
      ],
      [{ action: 'user.password_changed' }, ''],
      [{ action: 'store.set_up', details: { name: 'Lakshmi Stores' } }, 'Lakshmi Stores'],
      [{ action: 'module.enabled', details: { module: 'Electronics' } }, 'Electronics'],
      [
        {
          action: 'store.updated',
          details: {
            changes: {
              receiptFooter: { from: null, to: 'Thank you' },
              allowNegativeStock: { from: 'no', to: 'yes' }
            }
          }
        },
        'Receipt footer from nothing to Thank you; sell when stock runs out from no to yes'
      ],
      [
        {
          action: 'pricing.updated',
          details: {
            changes: {
              rounding: { from: 'not rounded', to: 'nearest ₹1.00' },
              discountLimit: { from: '10%', to: '5%' }
            }
          }
        },
        'Bill rounding from not rounded to nearest ₹1.00; discount limit from 10% to 5%'
      ],
      [
        {
          action: 'tax_class.created',
          details: { name: 'Tobacco', rate: '28%', cess: '36%' }
        },
        'Tobacco: 28% + 36% cess'
      ],
      [
        {
          action: 'tax_class.updated',
          details: { name: 'Tobacco', changes: { cess: { from: '36%', to: '30%' } } }
        },
        'Tobacco: cess from 36% to 30%'
      ],
      [{ action: 'tax_class.archived', details: { name: 'Tobacco' } }, 'Tobacco'],
      [
        {
          action: 'stock.adjusted',
          details: {
            adjustmentNumber: 'ADJ000001',
            reason: 'Damaged',
            notes: 'Torn packet',
            items: [{ item: 'Neem Soap', change: '-2 pcs', onHandAfter: '18 pcs' }]
          }
        },
        'ADJ000001 · Damaged: Neem Soap (-2 pcs) — Torn packet'
      ],
      [
        {
          action: 'stock.counted',
          details: {
            adjustmentNumber: 'ADJ000002',
            items: [
              {
                item: 'Sona Masoori Rice 1 kg',
                recorded: '10 kg',
                counted: '9.25 kg',
                change: '-0.75 kg'
              }
            ]
          }
        },
        'ADJ000002: Sona Masoori Rice 1 kg 10 kg → 9.25 kg'
      ],
      [
        {
          action: 'payment_method.created',
          details: { name: 'Meal Pass', code: 'sodexo', kind: 'other' }
        },
        'Meal Pass (sodexo · other)'
      ],
      [
        {
          action: 'sale.created',
          details: { invoiceNumber: 'INV000001', items: 2, total: '₹890.00', discount: '₹10.00' }
        },
        'INV000001 · 2 items · ₹890.00 (₹10.00 discount)'
      ],
      [
        {
          action: 'sale.voided',
          details: { invoiceNumber: 'INV000001', total: '₹890.00', reason: 'Wrong item' }
        },
        'INV000001 (₹890.00) — Wrong item'
      ],
      [
        {
          action: 'sale.reprinted',
          details: { invoiceNumber: 'INV000001' }
        },
        'INV000001'
      ],
      [
        {
          action: 'printer.updated',
          details: {
            changes: {
              paperWidth: { from: '80 mm', to: '58 mm' },
              autoPrint: { from: 'no', to: 'yes' }
            }
          }
        },
        'Paper width from 80 mm to 58 mm; auto-print receipt from no to yes'
      ]
    ]
    for (const [overrides, sentence] of cases) {
      expect(describeAuditEntry(entry(1, overrides)), overrides.action).toBe(sentence)
    }
    expect(
      describeAuditEntry(
        entry(1, {
          action: 'system.unclean_shutdown',
          details: { previousSessionStartedAt: '2026-10-18T04:00:00.000Z' }
        })
      )
    ).toMatch(/^The session started 18 Oct 2026, .* didn't close normally$/)
  })

  it('still shows the facts of actions it does not know', () => {
    expect(
      describeAuditEntry(
        entry(9, {
          action: 'custom.event' as AuditLogEntry['action'],
          entity: { type: 'sale', id: 12, label: null },
          details: { invoice: 'INV-0012', reason: 'Wrong item' }
        })
      )
    ).toBe('sale #12: invoice: INV-0012, reason: Wrong item')
  })
})

describe('audit log page (M07-04)', () => {
  function withLog(pages: AuditLogEntry[][] = [LOG]) {
    fakeBackend.on('audit:filter-options', () => ({
      actions: ['access.denied', 'override.approved', 'user.sign_in', 'user.updated'],
      people: [ARJUN, MEENA, RAVI]
    }))
    fakeBackend.on('audit:list', (filter: AuditLogFilter) => {
      const index =
        filter.before === undefined ? 0 : pages.findIndex((p) => p[0]!.id < filter.before!)
      return {
        entries: pages[index] ?? [],
        nextBefore: index < pages.length - 1 ? pages[index]!.at(-1)!.id : null
      }
    })
  }

  it('lists who did what and when, including approvals and StorePro itself', async () => {
    withLog()
    renderApp('/audit')
    const table = await screen.findByRole('table', { name: /Audit log entries/ })
    await within(table).findByText('Approved a restricted action')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(5)
    expect(within(rows[0]!).getByText('Arjun')).toBeTruthy()
    expect(within(rows[2]!).getByText('Meena: role from Cashier to Manager')).toBeTruthy()
    expect(within(rows[3]!).getByText('StorePro')).toBeTruthy()
    expect(screen.getByText('Showing 5 entries.')).toBeTruthy()
    expect(await axeViolations()).toEqual([])
  })

  it('filters by person, action and dates, keeping the filters in the address', async () => {
    withLog()
    const { router } = renderApp('/audit')
    await screen.findByText('Showing 5 entries.')
    const filters = screen.getByRole('search', { name: 'Filter the audit log' })

    await userEvent.selectOptions(within(filters).getByLabelText('Person'), String(ARJUN.userId))
    const action = within(filters).getByLabelText('Action')
    // Only actions present in the log are offered, grouped by area.
    expect(
      within(action)
        .getAllByRole('group')
        .map((g) => g.getAttribute('label'))
    ).toEqual(['Sign-in and access', 'User accounts'])
    await userEvent.selectOptions(action, 'override.approved')
    await userEvent.type(within(filters).getByLabelText('From'), '2026-10-01')
    await userEvent.type(within(filters).getByLabelText('To'), '2026-10-19')

    await waitFor(() =>
      expect(fakeBackend.callsTo('audit:list').at(-1)).toEqual({
        person: ARJUN.userId,
        action: 'override.approved',
        // The store's days (Asia/Kolkata), whatever the computer's time zone.
        from: Date.UTC(2026, 8, 30, 18, 30),
        to: Date.UTC(2026, 9, 19, 18, 30),
        limit: 50
      })
    )
    expect(router.state.location.search).toBe(
      '?person=2&action=override.approved&from=2026-10-01&to=2026-10-19'
    )

    await userEvent.click(within(filters).getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(fakeBackend.callsTo('audit:list').at(-1)).toEqual({ limit: 50 })
  })

  it('loads older entries on request', async () => {
    withLog([LOG.slice(0, 3), LOG.slice(3)])
    renderApp('/audit')
    await screen.findByText('Showing 3 entries; older entries are available.')
    await userEvent.click(screen.getByRole('button', { name: 'Show older entries' }))
    await screen.findByText('Showing 5 entries.')
    expect(fakeBackend.callsTo('audit:list').at(-1)).toEqual({ limit: 50, before: 3 })
    expect(screen.queryByRole('button', { name: 'Show older entries' })).toBeNull()
  })

  it('opens one user’s history from the Users page', async () => {
    fakeBackend.on('users:list', () => [
      {
        ...MEENA,
        roleCode: 'cashier',
        roleName: 'Cashier',
        active: true,
        mustChangePassword: false,
        lastSignInAt: null,
        createdAt: 0
      }
    ])
    withLog()
    const { router } = renderApp('/users')
    await userEvent.click(await screen.findByRole('button', { name: 'History of Meena' }))
    await screen.findByRole('heading', { level: 1, name: 'Audit log' })
    expect(router.state.location.search).toBe('?entity=user:3')
    await waitFor(() =>
      expect(fakeBackend.callsTo('audit:list').at(-1)).toEqual({
        entity: { type: 'user', id: 3 },
        limit: 50
      })
    )
    expect(await screen.findByText('Showing the history of Meena only.')).toBeTruthy()
  })

  it('ignores malformed filters in the address', async () => {
    withLog()
    renderApp('/audit?person=system&from=yesterday&to=2026-13-45&entity=nonsense')
    await screen.findByText('Showing 5 entries.')
    expect(fakeBackend.callsTo('audit:list').at(-1)).toEqual({ person: 'system', limit: 50 })
    expect(screen.getByRole('button', { name: 'Clear filters' })).toHaveProperty('disabled', false)
  })

  it('explains an empty log, and an empty filtered view', async () => {
    renderApp('/audit')
    expect(await screen.findByText('Nothing recorded yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toHaveProperty('disabled', true)
  })

  it('is not shown to cashiers', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('cashier') }
    renderApp('/audit')
    expect(await screen.findByText("You don't have access to Audit log")).toBeTruthy()
    expect(fakeBackend.callsTo('audit:list')).toEqual([])
  })
})
