import { describe, expect, it, vi } from 'vitest'
import type { Actor } from '../auth/access'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { fixedClock, useMigratedDb } from '../db/test/testDb'
import { AuditLog, changesBetween } from './auditLog'

const cashier = (override: Actor['override'] = null): Actor => ({
  userId: 2,
  username: 'meena',
  displayName: 'Meena',
  roleCode: 'cashier',
  permissions: new Set(),
  override
})

describe('AuditLog', () => {
  const getDb = useMigratedDb()

  function setup() {
    const db = getDb()
    // Users 1 (owner) and 2 (cashier) for the foreign keys.
    db.run(
      `INSERT INTO users (user_id, username, display_name, password_hash, role_id, created_at, updated_at)
       SELECT 1, 'owner', 'Ravi', 'x', role_id, 0, 0 FROM roles WHERE role_code = 'administrator'
       UNION ALL
       SELECT 2, 'meena', 'Meena', 'x', role_id, 0, 0 FROM roles WHERE role_code = 'cashier'`
    )
    const audit = new AuditLog(db, fixedClock)
    const rows = () =>
      db.all<Record<string, unknown>>(
        `SELECT occurred_at, user_id, approved_by_user_id, action, entity_type, entity_id, details
         FROM audit_logs ORDER BY audit_log_id`
      )
    return { db, audit, rows }
  }

  it('records who did what, to which record, and when', () => {
    const { db, audit, rows } = setup()
    db.transaction(() =>
      audit.change({
        action: 'user.updated',
        actor: cashier(),
        entity: { type: 'user', id: 1 },
        details: { changes: { name: { from: 'Ravi', to: 'Ravi K' } } }
      })
    )
    expect(rows()).toEqual([
      {
        occurred_at: fixedClock.now(),
        user_id: 2,
        approved_by_user_id: null,
        action: 'user.updated',
        entity_type: 'user',
        entity_id: 1,
        details: JSON.stringify({ changes: { name: { from: 'Ravi', to: 'Ravi K' } } })
      }
    ])
  })

  it('records who approved an action done with a manager approval', () => {
    const { db, audit, rows } = setup()
    const approved = cashier({
      permission: 'sale.void',
      approvedBy: { userId: 1, displayName: 'Ravi' }
    })
    db.transaction(() => audit.change({ action: 'user.updated', actor: approved }))
    expect(rows()[0]).toMatchObject({ user_id: 2, approved_by_user_id: 1 })
  })

  it('only writes a change inside the transaction that makes it (M07-02)', () => {
    const { audit, rows } = setup()
    expect(() => audit.change({ action: 'user.updated', userId: 1 })).toThrow(
      /must be written in the change's transaction/
    )
    audit.event({ action: 'user.sign_out', userId: 1 })
    expect(rows().map((r) => r.action)).toEqual(['user.sign_out'])
  })

  it('rolls back with the change it describes', () => {
    const { db, audit, rows } = setup()
    expect(() =>
      db.transaction(() => {
        audit.change({ action: 'user.deactivated', userId: 1, entity: { type: 'user', id: 2 } })
        throw new Error('the change failed')
      })
    ).toThrow('the change failed')
    expect(rows()).toEqual([])
  })

  it('never stores secrets, and refuses oversized details', () => {
    const { audit, rows } = setup()
    audit.event({
      action: 'user.sign_in_failed',
      userId: null,
      details: { username: 'meena', password: 'till-drawer-77', nested: { pin: '1234' } }
    })
    const stored = String(rows()[0]?.details)
    expect(stored).not.toContain('till-drawer-77')
    expect(stored).not.toContain('1234')
    expect(JSON.parse(stored)).toMatchObject({ username: 'meena', password: '[REDACTED]' })

    const huge = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`k${i}`, 'x'.repeat(500)])
    )
    expect(() => audit.event({ action: 'user.sign_out', userId: 1, details: huge })).toThrow(
      /too large/
    )
  })

  it('is append-only, and an approver can not be the actor', () => {
    const { db, audit } = setup()
    audit.event({ action: 'user.sign_out', userId: 1 })
    expect(() => db.run('UPDATE audit_logs SET user_id = 2')).toThrow(/immutable/)
    expect(() => db.run('DELETE FROM audit_logs')).toThrow(/immutable/)
    expect(() =>
      db.run(
        `INSERT INTO audit_logs (occurred_at, user_id, approved_by_user_id, action)
         VALUES (0, 2, 2, 'user.updated')`
      )
    ).toThrow(/CHECK/)
  })
})

describe('changesBetween', () => {
  it('lists only the fields that changed', () => {
    expect(
      changesBetween({ name: 'Meena', role: 'Cashier' }, { name: 'Meena', role: 'Manager' })
    ).toEqual({ role: { from: 'Cashier', to: 'Manager' } })
    expect(changesBetween({ name: 'Meena' }, { name: 'Meena' })).toBeNull()
    expect(changesBetween({ price: 100 }, { price: undefined })).toEqual({
      price: { from: 100, to: null }
    })
  })
})

describe('audited user changes are atomic (M07-02)', () => {
  const getDb = useMigratedDb()
  const CASHIER = {
    username: 'meena',
    displayName: 'Meena',
    roleCode: 'cashier' as const,
    password: 'till-drawer-77'
  }

  it('saves no change when its audit entry cannot be written', async () => {
    const bed = createTestbed(getDb())
    await bed.auth.createInitialAdmin(OWNER)
    const meena = await bed.userService.create(bed.actor(), CASHIER)
    vi.spyOn(bed.auditLog, 'change').mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() =>
      bed.userService.setActive(bed.actor(), { userId: meena.userId, active: false })
    ).toThrow('disk full')
    await expect(
      bed.userService.create(bed.actor(), { ...CASHIER, username: 'arun' })
    ).rejects.toThrow('disk full')
    expect(bed.users.findById(meena.userId)?.active).toBe(true)
    expect(bed.users.findByUsername('arun')).toBeNull()
  })

  it('writes no audit entry for a change that fails', async () => {
    const bed = createTestbed(getDb())
    await bed.auth.createInitialAdmin(OWNER)
    const meena = await bed.userService.create(bed.actor(), CASHIER)
    const before = bed.audit().length
    vi.spyOn(bed.users, 'updateProfile').mockImplementation(() => {
      throw new Error('constraint failed')
    })
    expect(() =>
      bed.userService.update(bed.actor(), {
        userId: meena.userId,
        displayName: 'Meena S',
        roleCode: 'cashier'
      })
    ).toThrow('constraint failed')
    expect(bed.audit()).toHaveLength(before)
  })

  it('records edits as readable before-and-after changes, and skips no-op edits', async () => {
    const bed = createTestbed(getDb())
    await bed.auth.createInitialAdmin(OWNER)
    const meena = await bed.userService.create(bed.actor(), CASHIER)
    bed.userService.update(bed.actor(), {
      userId: meena.userId,
      displayName: 'Meena',
      roleCode: 'manager'
    })
    bed.userService.update(bed.actor(), {
      userId: meena.userId,
      displayName: 'Meena',
      roleCode: 'manager'
    })
    const updates = bed.audit().filter((a) => a.action === 'user.updated')
    expect(updates.map((a) => JSON.parse(a.details ?? 'null'))).toEqual([
      { changes: { role: { from: 'Cashier', to: 'Manager' } } }
    ])
    expect(
      JSON.parse(
        bed.audit().find((a) => a.action === 'user.created' && a.entity_id === meena.userId)
          ?.details ?? ''
      )
    ).toEqual({
      username: 'meena',
      role: 'Cashier'
    })
  })
})
