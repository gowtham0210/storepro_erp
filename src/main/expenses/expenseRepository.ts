import type {
  ExpenseCategorySummary,
  ExpenseInput,
  ExpenseListFilter,
  ExpenseListPage,
  ExpenseSummary
} from '@shared/ipc/contract'
import type { SQLInputValue } from 'node:sqlite'
import { Repository } from '../db/repository'
import { likePattern } from '../db/search'

export const DEFAULT_EXPENSE_PAGE_SIZE = 50

interface CategoryRow {
  expense_category_id: number
  name: string
  archived_at: number | null
  expense_count: number
}

interface ExpenseRow {
  expense_id: number
  expense_category_id: number
  category_name: string
  expense_date: string
  amount_minor: number
  payment_method_id: number
  payment_method_name: string
  description: string | null
  recorded_by_name: string
  recorded_at: number
  updated_at: number
  archived_at: number | null
}

const EXPENSE_SELECT = `SELECT e.expense_id, e.expense_category_id, c.name AS category_name,
         e.expense_date, e.amount_minor, e.payment_method_id, pm.name AS payment_method_name,
         e.description, u.display_name AS recorded_by_name, e.recorded_at, e.updated_at,
         e.archived_at
  FROM expenses e
  JOIN expense_categories c ON c.expense_category_id = e.expense_category_id
  JOIN payment_methods pm ON pm.payment_method_id = e.payment_method_id
  JOIN users u ON u.user_id = e.recorded_by_user_id`

function toCategory(row: CategoryRow): ExpenseCategorySummary {
  return {
    expenseCategoryId: row.expense_category_id,
    name: row.name,
    active: row.archived_at === null,
    expenseCount: row.expense_count
  }
}

function toExpense(row: ExpenseRow): ExpenseSummary {
  return {
    expenseId: row.expense_id,
    expenseCategoryId: row.expense_category_id,
    categoryName: row.category_name,
    expenseDate: row.expense_date,
    amountMinor: row.amount_minor,
    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_method_name,
    description: row.description,
    recordedByName: row.recorded_by_name,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
    voided: row.archived_at !== null
  }
}

/**
 * Expense categories and expenses (M18-01). Categories are archived, never
 * deleted. An expense is never deleted either: a mistaken one is voided, which
 * keeps it on record but leaves it out of totals.
 */
export class ExpenseRepository extends Repository {
  // ---- Categories ----------------------------------------------------------

  listCategories(): ExpenseCategorySummary[] {
    return this.db
      .all<CategoryRow>(
        `SELECT c.*, (SELECT count(*) FROM expenses e
                      WHERE e.expense_category_id = c.expense_category_id) AS expense_count
         FROM expense_categories c
         ORDER BY c.archived_at IS NOT NULL, c.name COLLATE NOCASE`
      )
      .map(toCategory)
  }

  findCategory(expenseCategoryId: number): ExpenseCategorySummary | null {
    const row = this.db.get<CategoryRow>(
      `SELECT c.*, (SELECT count(*) FROM expenses e
                    WHERE e.expense_category_id = c.expense_category_id) AS expense_count
       FROM expense_categories c WHERE c.expense_category_id = ?`,
      [expenseCategoryId]
    )
    return row ? toCategory(row) : null
  }

  findCategoryByName(name: string): ExpenseCategorySummary | null {
    const row = this.db.get<{ expense_category_id: number }>(
      'SELECT expense_category_id FROM expense_categories WHERE name = ? COLLATE NOCASE',
      [name]
    )
    return row ? this.findCategory(row.expense_category_id) : null
  }

  createCategory(name: string): number {
    return this.insert('expense_categories', { name })
  }

  renameCategory(expenseCategoryId: number, name: string): void {
    this.db.run('UPDATE expense_categories SET name = ? WHERE expense_category_id = ?', [
      name,
      expenseCategoryId
    ])
  }

  setCategoryActive(expenseCategoryId: number, active: boolean): void {
    this.db.run('UPDATE expense_categories SET archived_at = ? WHERE expense_category_id = ?', [
      active ? null : this.now(),
      expenseCategoryId
    ])
  }

  // ---- Expenses ------------------------------------------------------------

  find(expenseId: number): ExpenseSummary | null {
    const row = this.db.get<ExpenseRow>(`${EXPENSE_SELECT} WHERE e.expense_id = ?`, [expenseId])
    return row ? toExpense(row) : null
  }

  create(input: ExpenseInput & { recordedByUserId: number }): number {
    const now = this.now()
    return this.insert('expenses', {
      expense_category_id: input.expenseCategoryId,
      expense_date: input.expenseDate,
      amount_minor: input.amountMinor,
      payment_method_id: input.paymentMethodId,
      description: input.description,
      recorded_by_user_id: input.recordedByUserId,
      recorded_at: now,
      updated_at: now
    })
  }

  updateDetails(expenseId: number, input: ExpenseInput): void {
    this.update('expenses', 'expense_id', expenseId, {
      expense_category_id: input.expenseCategoryId,
      expense_date: input.expenseDate,
      amount_minor: input.amountMinor,
      payment_method_id: input.paymentMethodId,
      description: input.description
    })
  }

  setVoided(expenseId: number, voided: boolean): void {
    this.update('expenses', 'expense_id', expenseId, { archived_at: voided ? this.now() : null })
  }

  list(filter: ExpenseListFilter = {}): ExpenseListPage {
    const where: string[] = []
    const params: SQLInputValue[] = []
    const status = filter.status ?? 'active'
    if (status === 'active') where.push('e.archived_at IS NULL')
    else if (status === 'voided') where.push('e.archived_at IS NOT NULL')

    const search = filter.search?.trim()
    if (search) {
      const pattern = likePattern(search)
      where.push(`(e.description LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`)
      params.push(pattern, pattern)
    }
    if (filter.categoryId !== undefined) {
      where.push('e.expense_category_id = ?')
      params.push(filter.categoryId)
    }
    if (filter.paymentMethodId !== undefined) {
      where.push('e.payment_method_id = ?')
      params.push(filter.paymentMethodId)
    }
    if (filter.from !== undefined) {
      where.push('e.expense_date >= ?')
      params.push(filter.from)
    }
    if (filter.to !== undefined) {
      where.push('e.expense_date <= ?')
      params.push(filter.to)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const from = `FROM expenses e
      JOIN expense_categories c ON c.expense_category_id = e.expense_category_id`

    const totals = this.db.get<{ n: number; sum: number | null }>(
      `SELECT count(*) AS n,
              sum(CASE WHEN e.archived_at IS NULL THEN e.amount_minor ELSE 0 END) AS sum
       ${from} ${whereSql}`,
      params
    )
    const rows = this.db.all<ExpenseRow>(
      `${EXPENSE_SELECT}
       ${whereSql}
       ORDER BY e.expense_date DESC, e.expense_id DESC
       LIMIT ? OFFSET ?`,
      [...params, filter.limit ?? DEFAULT_EXPENSE_PAGE_SIZE, filter.offset ?? 0]
    )
    return { items: rows.map(toExpense), total: totals?.n ?? 0, totalMinor: totals?.sum ?? 0 }
  }
}
