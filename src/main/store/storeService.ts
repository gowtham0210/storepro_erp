import type {
  NewAdministrator,
  SessionUser,
  SetupOptions,
  StoreProfile,
  StoreProfileInput
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { countryByCode, indianStateByCode } from '@shared/regions'
import { changesBetween, type AuditLog, type AuditSubject } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import type { AuthService } from '../auth/authService'
import type { TaxClassRepository } from '../catalog/taxClassRepository'
import type { Database } from '../db/database'
import type { StoreRepository } from './storeRepository'

export interface StoreServiceDeps {
  db: Database
  store: StoreRepository
  /** Setup gives a new store the tax classes for its country. */
  taxClasses: TaxClassRepository
  auth: AuthService
  audit: AuditLog
}

function invalid(path: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, [{ path, message }])
}

/**
 * Store setup and configuration (M03): first-run setup, the store profile and
 * its changes. Setup is complete once the store profile is saved; until then
 * the service host keeps every other screen's requests out (FR-005).
 */
export class StoreService {
  private configured = false

  constructor(private readonly deps: StoreServiceDeps) {}

  /** Once true, stays true: a store can't be un-set-up. */
  isConfigured(): boolean {
    this.configured ||= this.deps.store.exists()
    return this.configured
  }

  options(): SetupOptions {
    return this.deps.store.options()
  }

  getProfile(): StoreProfile | null {
    return this.deps.store.get()
  }

  /**
   * First run (M03-02): the store and its first administrator, saved
   * together. The administrator is signed in afterwards.
   */
  async completeSetup({
    store,
    administrator
  }: {
    store: StoreProfileInput
    administrator: NewAdministrator
  }): Promise<SessionUser> {
    if (this.isConfigured()) throw new AppError('CONFLICT', 'StorePro is already set up.')
    this.checkReferences(store, null)
    return this.deps.auth.createInitialAdmin(administrator, (adminId) => {
      if (this.deps.store.exists()) throw new AppError('CONFLICT', 'StorePro is already set up.')
      this.createStore(store, { userId: adminId })
    })
  }

  /**
   * Store details for a store whose administrator already exists but whose
   * profile was never saved (data from before M03).
   */
  completeStore(actor: Actor, store: StoreProfileInput): StoreProfile {
    assertCan(actor, 'settings.edit')
    this.checkReferences(store, null)
    this.deps.db.transaction(() => {
      if (this.deps.store.exists()) throw new AppError('CONFLICT', 'StorePro is already set up.')
      this.createStore(store, { actor })
    })
    return this.requireProfile()
  }

  /** Settings (M03-04). Every change is audited with what it was and what it became. */
  update(actor: Actor, input: StoreProfileInput): StoreProfile {
    assertCan(actor, 'settings.edit')
    const before = this.requireProfile()
    this.checkReferences(input, before)
    this.deps.db.transaction(() => {
      const changes = changesBetween(this.readable(before), this.readable(input))
      if (!changes) return
      this.deps.store.updateProfile(input)
      this.deps.audit.change({ action: 'store.updated', actor, details: { changes } })
    })
    return this.requireProfile()
  }

  private createStore(store: StoreProfileInput, by: AuditSubject): void {
    this.deps.store.create(store)
    this.deps.taxClasses.seedDefaults(store.countryCode)
    this.deps.audit.change({
      action: 'store.set_up',
      ...by,
      details: { name: store.name, businessType: store.businessTypeCode }
    })
  }

  /** Rules that need the database: known currency, an available business type, a locked currency. */
  private checkReferences(input: StoreProfileInput, before: StoreProfile | null): void {
    const { currencies, businessTypes } = this.deps.store.options()
    if (!currencies.some((c) => c.currencyCode === input.currencyCode)) {
      throw invalid('currencyCode', 'Choose a currency')
    }
    const type = businessTypes.find((t) => t.businessTypeCode === input.businessTypeCode)
    if (!type?.available && input.businessTypeCode !== before?.businessTypeCode) {
      throw invalid(
        'businessTypeCode',
        'Only grocery and retail stores are supported in this version'
      )
    }
    if (before && input.currencyCode !== before.currencyCode && this.deps.store.hasSales()) {
      throw invalid(
        'currencyCode',
        "The currency can't change after the first sale: past amounts would be read in the wrong currency"
      )
    }
  }

  /** Values as people read them, for the audit log's before-and-after. */
  private readable(profile: StoreProfileInput): Record<string, unknown> {
    const yesNo = (value: boolean): string => (value ? 'yes' : 'no')
    return {
      ...profile,
      countryCode: countryByCode(profile.countryCode)?.name ?? profile.countryCode,
      regionCode:
        profile.countryCode === 'IN' && profile.regionCode
          ? (indianStateByCode(profile.regionCode)?.name ?? profile.regionCode)
          : profile.regionCode,
      pricesIncludeTax: yesNo(profile.pricesIncludeTax),
      allowNegativeStock: yesNo(profile.allowNegativeStock)
    }
  }

  private requireProfile(): StoreProfile {
    const profile = this.deps.store.get()
    if (!profile) throw new AppError('SETUP_REQUIRED', 'Finish setting up the store first.')
    return profile
  }
}
