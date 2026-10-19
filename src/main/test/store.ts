import { AppError } from '@shared/ipc/errors'
import type { RoleCode, VariantInput } from '@shared/ipc/contract'
import { TEST_STORE } from '@shared/test/stores'
import { createTestbed, OWNER, type Testbed } from '../auth/test/testbed'
import type { Database } from '../db/database'

export const STAFF_PASSWORD = 'till-drawer-77'

/**
 * A set-up store (TEST_STORE: Indian, GST registered, prices include tax)
 * with the owner signed in, for service tests of the business modules.
 */
export async function setUpStore(
  db: Database,
  store = TEST_STORE
): Promise<Testbed & { signInAs(roleCode: RoleCode): Promise<void> }> {
  const bed = createTestbed(db)
  await bed.storeService.completeSetup({ store, administrator: OWNER })
  return {
    ...bed,
    /** Adds a user with this role (once) and signs them in instead of the owner. */
    async signInAs(roleCode: RoleCode) {
      const username = roleCode.replace('_', '-')
      bed.auth.signOut()
      await bed.auth.signIn({ username: OWNER.username, password: OWNER.password })
      if (!bed.users.findByUsername(username)) {
        await bed.userService.create(bed.actor(), {
          username,
          displayName: roleCode,
          roleCode,
          password: STAFF_PASSWORD
        })
      }
      bed.auth.signOut()
      await bed.auth.signIn({ username, password: STAFF_PASSWORD })
    }
  }
}

/** The error a call fails with; fails the test if it succeeds or throws something else. */
export async function rejection(run: Promise<unknown> | (() => unknown)): Promise<AppError> {
  try {
    await (typeof run === 'function' ? run() : run)
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

export function variant(overrides: Partial<VariantInput> = {}): VariantInput {
  return {
    variantName: null,
    sku: null,
    unitCode: 'pcs',
    sellingPriceMinor: 4500,
    mrpMinor: 5000,
    costPriceMinor: 3800,
    reorderLevelMilli: null,
    barcodes: [],
    ...overrides
  }
}

/** The id of a seeded tax class by name ("GST 5%"). */
export function taxClassId(bed: Testbed, name: string): number {
  const found = bed.taxClasses.findByName(name)
  if (!found) throw new Error(`no tax class ${name}`)
  return found.taxClassId
}
