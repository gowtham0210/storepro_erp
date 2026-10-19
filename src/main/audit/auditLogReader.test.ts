import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { useMigratedDb } from '../db/test/testDb'
import { createRealIpc } from '../ipc/test/realHandlers'
import { AuditLogReader, MAX_PAGE_SIZE } from './auditLogReader'
import { recordStartupEvents } from './startupEvents'

const MANAGER = {
  username: 'arjun',
  displayName: 'Arjun',
  roleCode: 'manager' as const,
  password: 'back-office-31'
}
const CASHIER = {
  username: 'meena',
  displayName: 'Meena',
  roleCode: 'cashier' as const,
  password: 'till-drawer-77'
}
const HOUR = 60 * 60 * 1000

describe('the audit log viewer (M07-04)', () => {
  const getDb = useMigratedDb()

  /** A day at the store: setup, staff added, a refused request, an approval, a sign-out. */
  async function aDayAtTheStore() {
    const bed = createTestbed(getDb())
    const start = bed.clock.time
    await bed.auth.createInitialAdmin(OWNER)
    const manager = await bed.userService.create(bed.actor(), MANAGER)
    const cashier = await bed.userService.create(bed.actor(), CASHIER)
    bed.auth.signOut()
    bed.clock.time += HOUR
    await bed.auth.signIn(CASHIER)
    expect(() => bed.auth.authorize('sale.void', { overridable: true })).toThrow(AppError)
    await bed.auth.approveOverride(bed.actor(), {
      permission: 'sale.void',
      username: MANAGER.username,
      password: MANAGER.password
    })
    bed.auth.signOut()
    const reader = new AuditLogReader(getDb(), bed.clock)
    return { ...bed, reader, start, manager, cashier }
  }

  it('lists entries newest first, with names for people and records', async () => {
    const { reader, manager, cashier } = await aDayAtTheStore()
    const { entries, nextBefore } = reader.list({})
    expect(nextBefore).toBeNull()
    expect(entries.map((e) => e.action)).toEqual([
      'user.sign_out',
      'override.approved',
      'access.denied',
      'user.sign_in',
      'user.sign_out',
      'user.created',
      'user.created',
      'user.sign_in',
      'user.created'
    ])
    expect(entries[1]).toMatchObject({
      actor: { userId: manager.userId, displayName: 'Arjun', username: 'arjun' },
      entity: { type: 'user', id: cashier.userId, label: 'Meena' },
      details: { permission: 'sale.void' }
    })
    expect(entries.at(-1)).toMatchObject({
      actor: { displayName: 'Ravi Kumar' },
      details: { username: 'owner', role: 'Administrator', initialSetup: true }
    })
  })

  it('filters by person (who did or approved it), action, date and record', async () => {
    const { reader, start, manager, cashier } = await aDayAtTheStore()
    expect(reader.list({ person: manager.userId }).entries.map((e) => e.action)).toEqual([
      'override.approved'
    ])
    expect(reader.list({ action: 'user.created' }).entries).toHaveLength(3)
    expect(reader.list({ from: start + HOUR }).entries).toHaveLength(4)
    expect(reader.list({ to: start + HOUR }).entries).toHaveLength(5)
    expect(
      reader.list({ entity: { type: 'user', id: cashier.userId } }).entries.map((e) => e.action)
    ).toEqual(['user.sign_out', 'override.approved', 'user.sign_in', 'user.created'])
    expect(reader.list({ person: 'system' }).entries).toEqual([])
  })

  it('pages through the log with a cursor', async () => {
    const { reader } = await aDayAtTheStore()
    const first = reader.list({ limit: 4 })
    expect(first.entries).toHaveLength(4)
    expect(first.nextBefore).toBe(first.entries[3]?.id)
    const second = reader.list({ limit: 4, before: first.nextBefore ?? 0 })
    const third = reader.list({ limit: 4, before: second.nextBefore ?? 0 })
    expect(third.nextBefore).toBeNull()
    const ids = [...first.entries, ...second.entries, ...third.entries].map((e) => e.id)
    expect(ids).toEqual(reader.list({}).entries.map((e) => e.id))
    expect(reader.list({ limit: 10_000 }).entries.length).toBeLessThanOrEqual(MAX_PAGE_SIZE)
  })

  it('records manager approvals against the approver too', async () => {
    const { auth, actor, reader, manager, cashier, auditLog, db } = {
      ...(await aDayAtTheStore()),
      db: getDb()
    }
    await auth.signIn(CASHIER)
    const { overrideId } = await auth.approveOverride(actor(), {
      permission: 'stock.adjust',
      username: MANAGER.username,
      password: MANAGER.password
    })
    const approved = auth.authorize('stock.adjust', { overridable: true, overrideId })
    if (!approved) throw new Error('no actor')
    db.transaction(() => auditLog.change({ action: 'user.updated', actor: approved }))
    const [latest] = reader.list({ person: manager.userId }).entries
    expect(latest).toMatchObject({
      action: 'user.updated',
      actor: { userId: cashier.userId },
      approvedBy: { userId: manager.userId, displayName: 'Arjun' }
    })
  })

  it('offers only the people and actions that appear in the log', async () => {
    const { reader } = await aDayAtTheStore()
    const options = reader.filterOptions()
    expect(options.people.map((p) => p.displayName)).toEqual(['Arjun', 'Meena', 'Ravi Kumar'])
    expect(options.actions).toEqual([
      'access.denied',
      'override.approved',
      'user.created',
      'user.sign_in',
      'user.sign_out'
    ])
  })

  it('is open to managers and administrators only', async () => {
    const bed = createTestbed(getDb())
    const ipc = createRealIpc(bed)
    await ipc.invoke('auth:create-initial-admin', OWNER)
    await ipc.invoke('users:create', CASHIER)
    await expect(ipc.invoke('audit:list', {})).resolves.toMatchObject({ nextBefore: null })
    await ipc.invoke('auth:sign-out')
    await ipc.invoke('auth:sign-in', CASHIER)
    await expect(ipc.send('audit:list', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', details: { permission: 'audit.view' } }
    })
    expect(
      await (async () => {
        await ipc.invoke('auth:sign-out')
        await ipc.invoke('auth:sign-in', OWNER)
        return ipc.send('audit:list', { from: 10, to: 5 })
      })()
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
  })
})

describe('startup events', () => {
  const getDb = useMigratedDb()

  it('records upgrades, recoveries and data problems as StorePro', () => {
    const bed = createTestbed(getDb())
    recordStartupEvents(bed.auditLog, {
      migration: { fromVersion: 3, toVersion: 4, applied: [4], backupPath: '/x/backups/pre.db' },
      integrity: {
        ok: false,
        mode: 'quick',
        storageProblems: [],
        foreignKeyViolations: [],
        consistencyViolations: [{ check: 'sale_totals', count: 2 }],
        durationMs: 5
      },
      startup: { recoveredFromUncleanShutdown: true, previousSessionStartedAt: '2026-10-18' }
    })
    expect(bed.audit().map((a) => [a.action, a.user_id, JSON.parse(a.details ?? 'null')])).toEqual([
      ['system.unclean_shutdown', null, { previousSessionStartedAt: '2026-10-18' }],
      ['system.integrity_problems', null, { problems: [{ check: 'sale_totals', count: 2 }] }],
      ['system.database_upgraded', null, { fromVersion: 3, toVersion: 4, backupFile: 'pre.db' }]
    ])
  })

  it('records nothing for an ordinary start or a brand-new store', () => {
    const bed = createTestbed(getDb())
    recordStartupEvents(bed.auditLog, {
      migration: { fromVersion: 0, toVersion: 4, applied: [1, 2, 3, 4], backupPath: null },
      integrity: null,
      startup: { recoveredFromUncleanShutdown: false, previousSessionStartedAt: null }
    })
    expect(bed.audit()).toEqual([])
  })
})
