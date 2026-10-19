import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { MODULES, type ModuleManifest } from '@shared/modules'
import { isPermissionCode } from '@shared/permissions'
import { TEST_STORE } from '@shared/test/stores'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { useMigratedDb } from '../db/test/testDb'
import { ModuleRepository } from './moduleRepository'
import { ModuleService } from './moduleService'

function rejection(run: () => unknown): AppError {
  try {
    run()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

/** Planned modules made available, with a dependency, to exercise the rules. */
const TEST_MANIFESTS: readonly ModuleManifest[] = MODULES.map((manifest) =>
  manifest.code === 'electronics'
    ? { ...manifest, availability: 'available' }
    : manifest.code === 'pharmacy'
      ? { ...manifest, availability: 'available', requires: ['electronics'] }
      : manifest
)

describe('the module manifest (M04-01)', () => {
  const getDb = useMigratedDb()

  it('matches the modules seeded in the database', () => {
    const rows = getDb().all<{ module_code: string; name: string }>(
      'SELECT module_code, name FROM modules ORDER BY module_code'
    )
    expect(rows).toEqual(
      [...MODULES]
        .map((m) => ({ module_code: m.code, name: m.name }))
        .sort((a, b) => a.module_code.localeCompare(b.module_code))
    )
  })

  it('refers only to things that exist', () => {
    const businessTypes = getDb()
      .all<{ business_type_code: string }>('SELECT business_type_code FROM business_types')
      .map((r) => r.business_type_code)
    const paths = new Set<string>()
    for (const manifest of MODULES) {
      for (const type of manifest.businessTypes) expect(businessTypes).toContain(type)
      for (const required of manifest.requires) {
        expect(MODULES.map((m) => m.code)).toContain(required)
      }
      for (const permission of manifest.permissions) expect(isPermissionCode(permission)).toBe(true)
      for (const entry of manifest.navigation) {
        expect(paths.has(entry.path), entry.path).toBe(false)
        paths.add(entry.path)
        if (entry.permission) expect(isPermissionCode(entry.permission)).toBe(true)
      }
    }
    // Every store type has its module.
    for (const type of businessTypes) {
      expect(
        MODULES.some((m) => m.businessTypes.includes(type)),
        type
      ).toBe(true)
    }
  })
})

describe('switching modules (M04-02)', () => {
  const getDb = useMigratedDb()

  async function aGroceryStore(manifests: readonly ModuleManifest[] = TEST_MANIFESTS) {
    const bed = createTestbed(getDb())
    await bed.storeService.completeSetup({ store: TEST_STORE, administrator: OWNER })
    const modules = new ModuleService({
      db: getDb(),
      modules: new ModuleRepository(getDb(), bed.clock),
      audit: bed.auditLog,
      manifests
    })
    return { ...bed, modules }
  }

  it('switches grocery on at setup, and keeps it on', async () => {
    const { modules, actor, storeService } = await aGroceryStore(MODULES)
    expect(storeService.getProfile()?.enabledModules).toEqual(['grocery'])
    const grocery = modules.list().find((m) => m.code === 'grocery')
    expect(grocery).toMatchObject({
      enabled: true,
      locked: 'Grocery and retail is what this store runs on, so it is always on.'
    })
    expect(
      rejection(() => modules.setEnabled(actor(), { code: 'grocery', enabled: false })).code
    ).toBe('CONFLICT')
    expect(modules.isEnabled('grocery')).toBe(true)
  })

  it("won't switch on a module this version doesn't include", async () => {
    const { modules, actor } = await aGroceryStore(MODULES)
    const restaurant = modules.list().find((m) => m.code === 'restaurant')
    expect(restaurant).toMatchObject({
      enabled: false,
      availability: 'planned',
      plannedFor: 'Release 1.3',
      locked: "Restaurant isn't in this version of StorePro yet; it is planned for Release 1.3."
    })
    const error = rejection(() =>
      modules.setEnabled(actor(), { code: 'restaurant', enabled: true })
    )
    expect(error.message).toMatch(/isn't in this version/)
    expect(modules.isEnabled('restaurant')).toBe(false)
  })

  it('switches an available module on and off, audited, without touching its data', async () => {
    const { modules, actor, audit, storeService } = await aGroceryStore()
    const before = getDb().all('SELECT * FROM audit_logs')
    modules.setEnabled(actor(), { code: 'electronics', enabled: true })
    expect(modules.isEnabled('electronics')).toBe(true)
    expect(storeService.getProfile()?.enabledModules).toEqual(['electronics', 'grocery'])

    modules.setEnabled(actor(), { code: 'electronics', enabled: false })
    expect(modules.isEnabled('electronics')).toBe(false)
    expect(
      audit()
        .slice(-2)
        .map((a) => [a.action, JSON.parse(a.details ?? '')])
    ).toEqual([
      ['module.enabled', { module: 'Electronics' }],
      ['module.disabled', { module: 'Electronics' }]
    ])
    // Nothing else changed: earlier history is all still there.
    expect(getDb().all('SELECT * FROM audit_logs').slice(0, before.length)).toEqual(before)

    // Asking for the state it is already in does nothing.
    const count = audit().length
    modules.setEnabled(actor(), { code: 'electronics', enabled: false })
    expect(audit()).toHaveLength(count)
  })

  it('keeps dependencies in order', async () => {
    const { modules, actor } = await aGroceryStore()
    expect(
      rejection(() => modules.setEnabled(actor(), { code: 'pharmacy', enabled: true })).message
    ).toBe('Pharmacy needs Electronics. Switch Electronics on first.')
    modules.setEnabled(actor(), { code: 'electronics', enabled: true })
    modules.setEnabled(actor(), { code: 'pharmacy', enabled: true })
    expect(
      rejection(() => modules.setEnabled(actor(), { code: 'electronics', enabled: false })).message
    ).toBe('Pharmacy needs Electronics. Switch Pharmacy off first.')
  })

  it('lets services refuse work for a module that is off', async () => {
    const { modules } = await aGroceryStore()
    expect(() => modules.assertEnabled('grocery')).not.toThrow()
    const error = rejection(() => modules.assertEnabled('electronics'))
    expect(error).toMatchObject({
      code: 'MODULE_DISABLED',
      message: 'Electronics is switched off. An administrator can switch it on in Settings.'
    })
  })

  it('is for administrators', async () => {
    const bed = await aGroceryStore()
    await bed.userService.create(bed.actor(), {
      username: 'arjun',
      displayName: 'Arjun',
      roleCode: 'manager',
      password: 'back-office-31'
    })
    bed.auth.signOut()
    await bed.auth.signIn({ username: 'arjun', password: 'back-office-31' })
    expect(bed.modules.list()).toHaveLength(MODULES.length)
    expect(
      rejection(() => bed.modules.setEnabled(bed.actor(), { code: 'electronics', enabled: true }))
        .code
    ).toBe('FORBIDDEN')
  })
})
