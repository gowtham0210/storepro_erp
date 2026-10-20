import type {
  CustomerInput,
  CustomerListFilter,
  CustomerListPage,
  CustomerPurchasePage,
  CustomerSummary,
  CustomerUpdate
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { changesBetween, type AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import { conflict } from '../catalog/catalogService'
import type { Database } from '../db/database'
import type { CustomerRepository } from './customerRepository'

export interface CustomerServiceDeps {
  db: Database
  customers: CustomerRepository
  audit: AuditLog
}

function readable(input: CustomerInput): Record<string, unknown> {
  return {
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    taxRegistrationNumber: input.taxRegistrationNumber
  }
}

/**
 * Customers (M17). Customers are optional on a bill: a sale with none is a
 * walk-in. A phone number identifies one customer, so a second customer with
 * the same number is refused and the error names who has it. There is no
 * credit or balance in this release.
 */
export class CustomerService {
  constructor(private readonly deps: CustomerServiceDeps) {}

  list(actor: Actor, filter: CustomerListFilter = {}): CustomerListPage {
    assertCan(actor, 'customer.view')
    return this.deps.customers.list(filter)
  }

  create(actor: Actor, input: CustomerInput): CustomerSummary {
    assertCan(actor, 'customer.manage')
    const { db, customers, audit } = this.deps
    const customerId = db.transaction(() => {
      this.assertPhoneFree(input.phone, null)
      const id = customers.create(input)
      audit.change({
        action: 'customer.created',
        actor,
        entity: { type: 'customer', id },
        details: { name: input.name, ...(input.phone ? { phone: input.phone } : {}) }
      })
      return id
    })
    return this.require(customerId)
  }

  update(actor: Actor, input: CustomerUpdate): CustomerSummary {
    assertCan(actor, 'customer.manage')
    const { db, customers, audit } = this.deps
    db.transaction(() => {
      const before = this.require(input.customerId)
      this.assertPhoneFree(input.phone, input.customerId)
      const changes = changesBetween(readable(before), readable(input))
      if (!changes) return
      customers.updateDetails(input.customerId, input)
      audit.change({
        action: 'customer.updated',
        actor,
        entity: { type: 'customer', id: input.customerId },
        details: { name: input.name, changes }
      })
    })
    return this.require(input.customerId)
  }

  setActive(
    actor: Actor,
    { customerId, active }: { customerId: number; active: boolean }
  ): CustomerSummary {
    assertCan(actor, 'customer.manage')
    const { db, customers, audit } = this.deps
    db.transaction(() => {
      const before = this.require(customerId)
      if (before.active === active) return
      customers.setActive(customerId, active)
      audit.change({
        action: active ? 'customer.restored' : 'customer.archived',
        actor,
        entity: { type: 'customer', id: customerId },
        details: { name: before.name }
      })
    })
    return this.require(customerId)
  }

  /** M17-03: purchase history. It lists sales, so it needs the sales permission as well. */
  purchases(
    actor: Actor,
    input: { customerId: number; offset?: number | undefined; limit?: number | undefined }
  ): CustomerPurchasePage {
    assertCan(actor, 'customer.view')
    assertCan(actor, 'sale.view')
    const customer = this.require(input.customerId)
    return {
      customerName: customer.name,
      ...this.deps.customers.purchases(input.customerId, input)
    }
  }

  private assertPhoneFree(phone: string | null, customerId: number | null): void {
    if (phone === null) return
    const existing = this.deps.customers.findByPhone(phone)
    if (existing && existing.customerId !== customerId) {
      throw conflict(
        'phone',
        `${existing.name} already has this phone number${existing.active ? '' : ' (archived; restore them instead)'}`
      )
    }
  }

  private require(customerId: number): CustomerSummary {
    const found = this.deps.customers.find(customerId)
    if (!found) throw new AppError('NOT_FOUND', 'That customer no longer exists.')
    return found
  }
}
