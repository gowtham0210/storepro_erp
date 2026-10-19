import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { TEST_STORE } from '@shared/test/stores'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { Database } from '../db/database'
import { useMigratedDb, useMigratedFileDb } from '../db/test/testDb'
import { createRealIpc } from '../ipc/test/realHandlers'

async function rejection(run: Promise<unknown> | (() => unknown)): Promise<AppError> {
  try {
    await (typeof run === 'function' ? run() : run)
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

const MANAGER = {
  username: 'arjun',
  displayName: 'Arjun',
  roleCode: 'manager' as const,
  password: 'back-office-31'
}

describe('first-run setup (M03-02)', () => {
  const getDb = useMigratedDb()

  it('saves the store and the administrator together, and signs them in', async () => {
    const bed = createTestbed(getDb())
    expect(bed.storeService.isConfigured()).toBe(false)
    const admin = await bed.storeService.completeSetup({ store: TEST_STORE, administrator: OWNER })
    expect(admin).toMatchObject({ username: 'owner', roleCode: 'administrator' })
    expect(bed.auth.getState().status).toBe('signed-in')
    expect(bed.storeService.isConfigured()).toBe(true)
    expect(bed.storeService.getProfile()).toMatchObject({
      ...TEST_STORE,
      currency: { currencyCode: 'INR', symbol: '₹', minorUnits: 2 },
      businessTypeName: 'Grocery / retail',
      setUpAt: bed.clock.time
    })
    expect(getDb().all('SELECT module_code FROM enabled_modules')).toEqual([
      { module_code: 'grocery' }
    ])
    expect(bed.audit().map((a) => a.action)).toEqual([
      'user.created',
      'user.sign_in',
      'store.set_up'
    ])
  })

  it('runs only once', async () => {
    const bed = createTestbed(getDb())
    await bed.storeService.completeSetup({ store: TEST_STORE, administrator: OWNER })
    const again = await rejection(
      bed.storeService.completeSetup({
        store: TEST_STORE,
        administrator: { ...OWNER, username: 'intruder' }
      })
    )
    expect(again.code).toBe('CONFLICT')
    expect(bed.users.count()).toBe(1)
  })

  it('saves nothing if any part fails', async () => {
    const bed = createTestbed(getDb())
    const create = vi.spyOn(bed.stores, 'create').mockImplementation(() => {
      throw new Error('disk full')
    })
    await expect(
      bed.storeService.completeSetup({ store: TEST_STORE, administrator: OWNER })
    ).rejects.toThrow('disk full')
    create.mockRestore()
    expect(bed.users.count()).toBe(0)
    expect(bed.storeService.isConfigured()).toBe(false)
    expect(bed.auth.getState()).toEqual({ status: 'setup-required' })
    expect(bed.audit()).toEqual([])
    // ...and setup can then be completed normally.
    await bed.storeService.completeSetup({ store: TEST_STORE, administrator: OWNER })
    expect(bed.storeService.isConfigured()).toBe(true)
  })

  it('checks the currency and business type against what is supported', async () => {
    const bed = createTestbed(getDb())
    const currency = await rejection(
      bed.storeService.completeSetup({
        store: { ...TEST_STORE, currencyCode: 'XYZ' },
        administrator: OWNER
      })
    )
    expect(currency.details).toEqual([{ path: 'currencyCode', message: 'Choose a currency' }])
    const type = await rejection(
      bed.storeService.completeSetup({
        store: { ...TEST_STORE, businessTypeCode: 'restaurant' },
        administrator: OWNER
      })
    )
    expect(type.details).toEqual([
      {
        path: 'businessTypeCode',
        message: 'Only grocery and retail stores are supported in this version'
      }
    ])
    expect(bed.users.count()).toBe(0)
  })

  it('offers the seeded currencies and business types, with only grocery available', () => {
    const { businessTypes, currencies } = createTestbed(getDb()).storeService.options()
    expect(currencies.map((c) => c.currencyCode)).toContain('INR')
    expect(businessTypes.filter((t) => t.available).map((t) => t.businessTypeCode)).toEqual([
      'grocery'
    ])
  })
})

describe('restarting (FR-005)', () => {
  const files = useMigratedFileDb()

  it('keeps the configuration', async () => {
    const first = createTestbed(files.db())
    await first.storeService.completeSetup({ store: TEST_STORE, administrator: OWNER })
    // Closed and reopened, as on the next start.
    files.db().close()
    const reopened = Database.open(files.path())
    try {
      const second = createTestbed(reopened)
      expect(second.storeService.isConfigured()).toBe(true)
      expect(second.storeService.getProfile()).toMatchObject(TEST_STORE)
    } finally {
      reopened.close()
    }
  })
})

describe('store settings (M03-04)', () => {
  const getDb = useMigratedDb()

  async function setUp() {
    const bed = createTestbed(getDb())
    await bed.storeService.completeSetup({ store: TEST_STORE, administrator: OWNER })
    return bed
  }

  it('saves changes and audits each one readably', async () => {
    const bed = await setUp()
    bed.clock.time += 60_000
    const updated = bed.storeService.update(bed.actor(), {
      ...TEST_STORE,
      name: 'Sharma Stores',
      regionCode: 'KA',
      taxRegistrationNumber: null,
      allowNegativeStock: true,
      invoicePrefix: 'SGS'
    })
    expect(updated).toMatchObject({
      name: 'Sharma Stores',
      invoicePrefix: 'SGS',
      updatedAt: bed.clock.time
    })
    expect(JSON.parse(bed.audit().at(-1)?.details ?? '')).toEqual({
      changes: {
        name: { from: 'Sharma General Stores', to: 'Sharma Stores' },
        regionCode: { from: 'Maharashtra', to: 'Karnataka' },
        taxRegistrationNumber: { from: '27AAPFU0939F1ZV', to: null },
        allowNegativeStock: { from: 'no', to: 'yes' },
        invoicePrefix: { from: 'INV', to: 'SGS' }
      }
    })
  })

  it('describes a move abroad in the same readable way', async () => {
    const bed = await setUp()
    bed.storeService.update(bed.actor(), {
      ...TEST_STORE,
      countryCode: 'AE',
      regionCode: 'Dubai',
      postalCode: null,
      taxRegistrationNumber: null,
      currencyCode: 'AED',
      timeZone: 'Asia/Dubai'
    })
    expect(JSON.parse(bed.audit().at(-1)?.details ?? '').changes).toMatchObject({
      countryCode: { from: 'India', to: 'United Arab Emirates' },
      regionCode: { from: 'Maharashtra', to: 'Dubai' },
      timeZone: { from: 'Asia/Kolkata', to: 'Asia/Dubai' }
    })
  })

  it('records nothing when nothing changed', async () => {
    const bed = await setUp()
    const before = bed.audit().length
    bed.storeService.update(bed.actor(), TEST_STORE)
    expect(bed.audit()).toHaveLength(before)
  })

  it("won't change the currency once there are sales", async () => {
    const bed = await setUp()
    bed.storeService.update(bed.actor(), { ...TEST_STORE, currencyCode: 'USD' }) // no sales yet
    vi.spyOn(bed.stores, 'hasSales').mockReturnValue(true)
    const error = await rejection(() =>
      bed.storeService.update(bed.actor(), { ...TEST_STORE, currencyCode: 'INR' })
    )
    expect(error.details).toEqual([
      expect.objectContaining({
        path: 'currencyCode',
        message: expect.stringMatching(/first sale/)
      })
    ])
  })

  it('is for administrators: managers can see settings but not change them', async () => {
    const bed = await setUp()
    await bed.userService.create(bed.actor(), MANAGER)
    bed.auth.signOut()
    await bed.auth.signIn(MANAGER)
    expect(bed.storeService.getProfile()?.name).toBe(TEST_STORE.name)
    const error = await rejection(() =>
      bed.storeService.update(bed.actor(), { ...TEST_STORE, name: 'Arjun Stores' })
    )
    expect(error.code).toBe('FORBIDDEN')
  })
})

describe('the setup guard (M03-03)', () => {
  const getDb = useMigratedDb()

  it('blocks everything but setup until the store is set up', async () => {
    // An administrator from before store setup existed (a database from M05).
    const bed = createTestbed(getDb())
    await bed.auth.createInitialAdmin(OWNER)
    const ipc = createRealIpc(bed)

    for (const channel of ['users:list', 'audit:list', 'store:update'] as const) {
      const input =
        channel === 'audit:list' ? {} : channel === 'store:update' ? TEST_STORE : undefined
      expect(await ipc.send(channel, input), channel).toMatchObject({
        ok: false,
        error: { code: 'SETUP_REQUIRED' }
      })
    }
    await expect(ipc.invoke('store:get-profile')).resolves.toBeNull()
    await expect(ipc.invoke('setup:complete-store', TEST_STORE)).resolves.toMatchObject({
      name: TEST_STORE.name
    })
    await expect(ipc.invoke('users:list')).resolves.toHaveLength(1)
    expect(bed.audit().at(-1)).toMatchObject({ action: 'store.set_up', user_id: 1 })
    expect(await ipc.send('setup:complete-store', TEST_STORE)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' }
    })
  })

  it('still lets a user choose a new password before setup', async () => {
    const bed = createTestbed(getDb())
    await bed.auth.createInitialAdmin(OWNER)
    const ipc = createRealIpc(bed)
    await expect(
      ipc.invoke('auth:change-password', {
        currentPassword: OWNER.password,
        newPassword: 'fresh-start-88'
      })
    ).resolves.toMatchObject({ username: 'owner' })
  })
})
