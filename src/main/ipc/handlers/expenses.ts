import { z } from 'zod'
import {
  expenseCategoryActiveSchema,
  expenseCategoryName,
  expenseCategoryRenameSchema,
  expenseInputSchema,
  expenseListFilterSchema,
  expenseUpdateSchema,
  expenseVoidSchema
} from '@shared/schemas/expenses'
import type { ExpenseService } from '../../expenses/expenseService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'expenses:list-categories'
  | 'expenses:create-category'
  | 'expenses:rename-category'
  | 'expenses:set-category-active'
  | 'expenses:list'
  | 'expenses:create'
  | 'expenses:update'
  | 'expenses:set-voided'

export function createExpenseHandlers(expenses: ExpenseService): {
  [C in Channel]: HandlerDefinition<C>
} {
  return {
    'expenses:list-categories': {
      access: 'expense.view',
      input: z.void(),
      handle: (_, { actor }) => expenses.listCategories(actor)
    },
    'expenses:create-category': {
      access: 'expense.manage',
      input: z.object({ name: expenseCategoryName }),
      handle: (input, { actor }) => expenses.createCategory(actor, input)
    },
    'expenses:rename-category': {
      access: 'expense.manage',
      input: expenseCategoryRenameSchema,
      handle: (input, { actor }) => expenses.renameCategory(actor, input)
    },
    'expenses:set-category-active': {
      access: 'expense.manage',
      input: expenseCategoryActiveSchema,
      handle: (input, { actor }) => expenses.setCategoryActive(actor, input)
    },
    'expenses:list': {
      access: 'expense.view',
      input: expenseListFilterSchema,
      handle: (input, { actor }) => expenses.list(actor, input)
    },
    'expenses:create': {
      access: 'expense.manage',
      input: expenseInputSchema,
      handle: (input, { actor }) => expenses.record(actor, input)
    },
    'expenses:update': {
      access: 'expense.manage',
      input: expenseUpdateSchema,
      handle: (input, { actor }) => expenses.update(actor, input)
    },
    'expenses:set-voided': {
      access: 'expense.manage',
      input: expenseVoidSchema,
      handle: (input, { actor }) => expenses.setVoided(actor, input)
    }
  }
}
