import type { ModuleState } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import {
  MODULES,
  moduleForBusinessType,
  type ModuleCode,
  type ModuleManifest
} from '@shared/modules'
import type { AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import type { Database } from '../db/database'
import type { ModuleRepository } from './moduleRepository'

export interface ModuleServiceDeps {
  db: Database
  modules: ModuleRepository
  audit: AuditLog
  /** The manifest; tests pass their own. */
  manifests?: readonly ModuleManifest[]
}

/**
 * The module registry (M04): which modules exist, which are on, and the
 * rules for switching them. The service host asks `isEnabled()` before
 * running a module's request; services can ask too.
 */
export class ModuleService {
  private readonly manifests: readonly ModuleManifest[]

  constructor(private readonly deps: ModuleServiceDeps) {
    this.manifests = deps.manifests ?? MODULES
  }

  isEnabled(code: ModuleCode): boolean {
    return this.deps.modules.enabled().has(code)
  }

  /** For services: refuse work for a module that is switched off. */
  assertEnabled(code: ModuleCode): void {
    if (!this.isEnabled(code)) throw disabled(this.manifest(code))
  }

  list(): ModuleState[] {
    const enabled = this.deps.modules.enabled()
    return this.manifests.map((manifest) => ({
      code: manifest.code,
      name: manifest.name,
      description: manifest.description,
      availability: manifest.availability,
      plannedFor: manifest.plannedFor ?? null,
      enabled: enabled.has(manifest.code),
      enabledAt: enabled.get(manifest.code) ?? null,
      locked: this.lockReason(manifest, enabled)
    }))
  }

  setEnabled(
    actor: Actor,
    { code, enabled }: { code: ModuleCode; enabled: boolean }
  ): ModuleState[] {
    assertCan(actor, 'settings.edit')
    const manifest = this.manifest(code)
    this.deps.db.transaction(() => {
      const current = this.deps.modules.enabled()
      if (current.has(code) === enabled) return
      const reason = this.lockReason(manifest, current)
      if (reason) throw new AppError('CONFLICT', reason)
      if (enabled) this.deps.modules.enable(code)
      else this.deps.modules.disable(code)
      this.deps.audit.change({
        action: enabled ? 'module.enabled' : 'module.disabled',
        actor,
        details: { module: manifest.name }
      })
    })
    return this.list()
  }

  /** Why the module's state can't change now, in words for the Settings screen. */
  private lockReason(manifest: ModuleManifest, enabled: Map<ModuleCode, number>): string | null {
    if (enabled.has(manifest.code)) {
      const businessType = this.deps.modules.businessTypeCode()
      if (businessType && moduleForBusinessType(businessType)?.code === manifest.code) {
        return `${manifest.name} is what this store runs on, so it is always on.`
      }
      const dependent = this.manifests.find(
        (other) => enabled.has(other.code) && other.requires.includes(manifest.code)
      )
      if (dependent)
        return `${dependent.name} needs ${manifest.name}. Switch ${dependent.name} off first.`
      return null
    }
    if (manifest.availability === 'planned') {
      return `${manifest.name} isn't in this version of StorePro yet${manifest.plannedFor ? `; it is planned for ${manifest.plannedFor}` : ''}.`
    }
    const missing = manifest.requires.filter((required) => !enabled.has(required))
    if (missing.length > 0) {
      const names = missing.map((code) => this.manifest(code).name).join(' and ')
      return `${manifest.name} needs ${names}. Switch ${names} on first.`
    }
    return null
  }

  private manifest(code: ModuleCode): ModuleManifest {
    const manifest = this.manifests.find((m) => m.code === code)
    if (!manifest) throw new AppError('NOT_FOUND', 'That module does not exist.')
    return manifest
  }
}

export function disabled(manifest: Pick<ModuleManifest, 'name'>): AppError {
  return new AppError(
    'MODULE_DISABLED',
    `${manifest.name} is switched off. An administrator can switch it on in Settings.`
  )
}
