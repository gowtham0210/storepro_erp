import type {
  SupplierInput,
  SupplierListFilter,
  SupplierListPage,
  SupplierSummary,
  SupplierUpdate
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { changesBetween, type AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import { conflict } from '../catalog/catalogService'
import type { Database } from '../db/database'
import type { SupplierRepository } from './supplierRepository'

export interface SupplierServiceDeps {
  db: Database
  suppliers: SupplierRepository
  audit: AuditLog
}

function readable(input: SupplierInput): Record<string, unknown> {
  return {
    name: input.name,
    contactPerson: input.contactPerson,
    phone: input.phone,
    email: input.email,
    address: input.address,
    taxRegistrationNumber: input.taxRegistrationNumber
  }
}

/** Supplier records (M15-01). Archiving hides a supplier from new documents but keeps history. */
export class SupplierService {
  constructor(private readonly deps: SupplierServiceDeps) {}

  list(actor: Actor, filter: SupplierListFilter = {}): SupplierListPage {
    assertCan(actor, 'supplier.view')
    return this.deps.suppliers.list(filter)
  }

  create(actor: Actor, input: SupplierInput): SupplierSummary {
    assertCan(actor, 'supplier.manage')
    const { db, suppliers, audit } = this.deps
    const supplierId = db.transaction(() => {
      this.assertNameFree(input.name, null)
      const id = suppliers.create(input)
      audit.change({
        action: 'supplier.created',
        actor,
        entity: { type: 'supplier', id },
        details: { name: input.name }
      })
      return id
    })
    return this.require(supplierId)
  }

  update(actor: Actor, input: SupplierUpdate): SupplierSummary {
    assertCan(actor, 'supplier.manage')
    const { db, suppliers, audit } = this.deps
    db.transaction(() => {
      const before = this.require(input.supplierId)
      this.assertNameFree(input.name, input.supplierId)
      const changes = changesBetween(readable(before), readable(input))
      if (!changes) return
      suppliers.updateDetails(input.supplierId, input)
      audit.change({
        action: 'supplier.updated',
        actor,
        entity: { type: 'supplier', id: input.supplierId },
        details: { name: input.name, changes }
      })
    })
    return this.require(input.supplierId)
  }

  setActive(
    actor: Actor,
    { supplierId, active }: { supplierId: number; active: boolean }
  ): SupplierSummary {
    assertCan(actor, 'supplier.manage')
    const { db, suppliers, audit } = this.deps
    db.transaction(() => {
      const before = this.require(supplierId)
      if (before.active === active) return
      suppliers.setActive(supplierId, active)
      audit.change({
        action: active ? 'supplier.restored' : 'supplier.archived',
        actor,
        entity: { type: 'supplier', id: supplierId },
        details: { name: before.name }
      })
    })
    return this.require(supplierId)
  }

  private assertNameFree(name: string, supplierId: number | null): void {
    const existing = this.deps.suppliers.findByName(name)
    if (existing && existing.supplierId !== supplierId) {
      throw conflict(
        'name',
        existing.active
          ? `There is already a supplier called “${existing.name}”`
          : `There is already a supplier called “${existing.name}” (archived). Restore it instead.`
      )
    }
  }

  private require(supplierId: number): SupplierSummary {
    const found = this.deps.suppliers.find(supplierId)
    if (!found) throw new AppError('NOT_FOUND', 'That supplier no longer exists.')
    return found
  }
}
