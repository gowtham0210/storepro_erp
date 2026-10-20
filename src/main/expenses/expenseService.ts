import type {
  ExpenseCategorySummary,
  ExpenseInput,
  ExpenseListFilter,
  ExpenseListPage,
  ExpenseSummary,
  ExpenseUpdate
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { formatMoney, type CurrencyFormat } from '@shared/money'
import { changesBetween, type AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import { conflict, invalid } from '../catalog/catalogService'
import type { Database } from '../db/database'
import type { PaymentRepository } from '../payments/paymentRepository'
import type { ExpenseRepository } from './expenseRepository'

export interface ExpenseServiceDeps {
  db: Database
  expenses: ExpenseRepository
  payments: PaymentRepository
  audit: AuditLog
  /** The store's currency, for amounts in audit entries. */
  currency: () => CurrencyFormat
}

/**
 * Running costs: rent, electricity, salaries and the like (M18-01).
 *
 * Each expense has a category, the day it was spent, an amount, and how it was
 * paid. Mistakes are corrected by editing the expense, or voiding it: nothing
 * is deleted, and a voided expense is left out of totals. Every change is
 * audited.
 */
export class ExpenseService {
  constructor(private readonly deps: ExpenseServiceDeps) {}

  // ---- Categories ----------------------------------------------------------

  listCategories(actor: Actor): ExpenseCategorySummary[] {
    assertCan(actor, 'expense.view')
    return this.deps.expenses.listCategories()
  }

  createCategory(actor: Actor, { name }: { name: string }): ExpenseCategorySummary {
    assertCan(actor, 'expense.manage')
    const { db, expenses, audit } = this.deps
    const id = db.transaction(() => {
      this.assertCategoryNameFree(name, null)
      const created = expenses.createCategory(name)
      audit.change({
        action: 'expense_category.created',
        actor,
        entity: { type: 'expense_category', id: created },
        details: { name }
      })
      return created
    })
    return this.requireCategory(id)
  }

  renameCategory(
    actor: Actor,
    input: { expenseCategoryId: number; name: string }
  ): ExpenseCategorySummary {
    assertCan(actor, 'expense.manage')
    const { db, expenses, audit } = this.deps
    db.transaction(() => {
      const before = this.requireCategory(input.expenseCategoryId)
      if (before.name === input.name) return
      this.assertCategoryNameFree(input.name, input.expenseCategoryId)
      expenses.renameCategory(input.expenseCategoryId, input.name)
      audit.change({
        action: 'expense_category.updated',
        actor,
        entity: { type: 'expense_category', id: input.expenseCategoryId },
        details: { changes: { name: { from: before.name, to: input.name } } }
      })
    })
    return this.requireCategory(input.expenseCategoryId)
  }

  /** Archived categories stay on their expenses but can't be chosen for new ones. */
  setCategoryActive(
    actor: Actor,
    { expenseCategoryId, active }: { expenseCategoryId: number; active: boolean }
  ): ExpenseCategorySummary {
    assertCan(actor, 'expense.manage')
    const { db, expenses, audit } = this.deps
    db.transaction(() => {
      const before = this.requireCategory(expenseCategoryId)
      if (before.active === active) return
      expenses.setCategoryActive(expenseCategoryId, active)
      audit.change({
        action: active ? 'expense_category.restored' : 'expense_category.archived',
        actor,
        entity: { type: 'expense_category', id: expenseCategoryId },
        details: { name: before.name }
      })
    })
    return this.requireCategory(expenseCategoryId)
  }

  // ---- Expenses ------------------------------------------------------------

  /** M18-02: expenses newest first, with the total of the ones that match. */
  list(actor: Actor, filter: ExpenseListFilter = {}): ExpenseListPage {
    assertCan(actor, 'expense.view')
    if (filter.from !== undefined && filter.to !== undefined && filter.from > filter.to) {
      throw invalid('to', 'The end date is before the start date')
    }
    return this.deps.expenses.list(filter)
  }

  record(actor: Actor, input: ExpenseInput): ExpenseSummary {
    assertCan(actor, 'expense.manage')
    const { db, expenses, audit } = this.deps
    const id = db.transaction(() => {
      this.assertCategoryUsable(input.expenseCategoryId, null)
      this.assertPaymentMethodUsable(input.paymentMethodId, null)
      const created = expenses.create({ ...input, recordedByUserId: actor.userId })
      const saved = this.require(created)
      audit.change({
        action: 'expense.recorded',
        actor,
        entity: { type: 'expense', id: created },
        details: this.describe(saved)
      })
      return created
    })
    return this.require(id)
  }

  update(actor: Actor, input: ExpenseUpdate): ExpenseSummary {
    assertCan(actor, 'expense.manage')
    const { db, expenses, audit } = this.deps
    db.transaction(() => {
      const before = this.require(input.expenseId)
      if (before.voided) {
        throw new AppError('CONFLICT', 'A voided expense cannot be changed. Restore it first.')
      }
      this.assertCategoryUsable(input.expenseCategoryId, before.expenseCategoryId)
      this.assertPaymentMethodUsable(input.paymentMethodId, before.paymentMethodId)
      expenses.updateDetails(input.expenseId, input)
      const after = this.require(input.expenseId)
      const changes = changesBetween(this.describe(before), this.describe(after))
      if (!changes) return
      audit.change({
        action: 'expense.updated',
        actor,
        entity: { type: 'expense', id: input.expenseId },
        details: { category: after.categoryName, date: after.expenseDate, changes }
      })
    })
    return this.require(input.expenseId)
  }

  setVoided(
    actor: Actor,
    { expenseId, voided }: { expenseId: number; voided: boolean }
  ): ExpenseSummary {
    assertCan(actor, 'expense.manage')
    const { db, expenses, audit } = this.deps
    db.transaction(() => {
      const before = this.require(expenseId)
      if (before.voided === voided) return
      expenses.setVoided(expenseId, voided)
      audit.change({
        action: voided ? 'expense.voided' : 'expense.restored',
        actor,
        entity: { type: 'expense', id: expenseId },
        details: this.describe(before)
      })
    })
    return this.require(expenseId)
  }

  // ---- Internals -----------------------------------------------------------

  private describe(expense: ExpenseSummary): Record<string, unknown> {
    return {
      category: expense.categoryName,
      date: expense.expenseDate,
      amount: formatMoney(expense.amountMinor, this.deps.currency()),
      paymentMethod: expense.paymentMethodName,
      description: expense.description
    }
  }

  /** A new expense needs an active category; an existing one may keep its (archived) category. */
  private assertCategoryUsable(expenseCategoryId: number, current: number | null): void {
    const category = this.deps.expenses.findCategory(expenseCategoryId)
    if (!category) throw invalid('expenseCategoryId', 'Choose a category')
    if (!category.active && category.expenseCategoryId !== current) {
      throw invalid(
        'expenseCategoryId',
        `“${category.name}” is archived. Restore it, or choose another category.`
      )
    }
  }

  private assertPaymentMethodUsable(paymentMethodId: number, current: number | null): void {
    const method = this.deps.payments.findMethod(paymentMethodId)
    if (!method) throw invalid('paymentMethodId', 'Choose how it was paid')
    if (!method.active && method.paymentMethodId !== current) {
      throw invalid(
        'paymentMethodId',
        `“${method.name}” is archived. Choose another way it was paid.`
      )
    }
  }

  private assertCategoryNameFree(name: string, expenseCategoryId: number | null): void {
    const existing = this.deps.expenses.findCategoryByName(name)
    if (existing && existing.expenseCategoryId !== expenseCategoryId) {
      throw conflict(
        'name',
        existing.active
          ? `There is already a category called “${existing.name}”`
          : `There is already a category called “${existing.name}” (archived). Restore it instead.`
      )
    }
  }

  private requireCategory(expenseCategoryId: number): ExpenseCategorySummary {
    const found = this.deps.expenses.findCategory(expenseCategoryId)
    if (!found) throw new AppError('NOT_FOUND', 'That category no longer exists.')
    return found
  }

  private require(expenseId: number): ExpenseSummary {
    const found = this.deps.expenses.find(expenseId)
    if (!found) throw new AppError('NOT_FOUND', 'That expense no longer exists.')
    return found
  }
}
