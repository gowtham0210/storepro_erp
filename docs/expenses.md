# Expenses

How StorePro records running costs such as rent, electricity and salaries (module M18; PRD section 8 and
MODULES.md section 18). Expenses are separate from purchases: buying stock goes through `docs/purchasing.md`.

## 1. Recording (M18-01)

**Manage → Expenses → Add expense** takes:

| Field    | Rule                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| Category | Required; an active category                                                         |
| Date     | Required; a real day (`YYYY-MM-DD`). Defaults to today **in the store's time zone**  |
| Amount   | Required; above zero. Stored in minor units, never as a float                        |
| Paid by  | Required; an active payment method (Cash, UPI, …). Expenses are not tied to the till |
| Note     | Optional, up to 200 characters                                                       |

The date is the day the money was spent, not when it was typed in, so a bill entered a week late
lands in the right week. Who recorded it and when are kept (`recorded_by_user_id`, `recorded_at`).

## 2. Categories

Seeded with Rent, Electricity, Salaries, Transport, Maintenance and Other. **Categories** on the
Expenses screen adds, renames, archives and restores them. Names are unique ignoring case. An
archived category stays on its expenses and in filters, but can't be picked for a new expense. An
expense that already has an archived category (or payment method) can still be edited without
changing it.

## 3. Correcting mistakes

- **Edit** changes any field of an expense, and the audit log records exactly what changed (a save
  with nothing changed writes nothing).
- **Void** keeps the expense on record but leaves it out of every total. It is never deleted.
  **Restore** brings it back. A voided expense can't be edited until it is restored.

## 4. The list and totals (M18-02)

**Manage → Expenses** lists expenses newest first, 50 to a page, with filters kept in the address:
words (note or category), **From** and **To** dates (inclusive, in the store's time zone),
category, how it was paid, and Show (expenses, voided, or all).

The **Total** above the table is the sum of **every matching expense that isn't voided, across all
pages**, not just the page on screen. An end date before the start date is refused.
(`expenses:list` returns `total` and `totalMinor` for the whole filter.)

## 5. Permissions and audit

- `expense.view` (Administrator, Manager) sees expenses and categories.
- `expense.manage` (Administrator, Manager) records, edits, voids and manages categories.
- Cashiers and inventory operators hold neither.

Audited, in the same transaction as the change: `expense.recorded`, `.updated`, `.voided`,
`.restored`, and `expense_category.created`, `.updated`, `.archived`, `.restored`. Amounts appear
formatted in the store's currency.

## 6. Where things are

| What         | Where                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| Rules        | `src/main/expenses/expenseService.ts`; SQL in `expenseRepository.ts`     |
| Validation   | `src/shared/schemas/expenses.ts`                                         |
| IPC channels | `expenses:*` (`src/main/ipc/handlers/expenses.ts`)                       |
| Screens      | `src/renderer/src/pages/ExpensesPage.tsx`, `expenses/ExpenseDialogs.tsx` |
| Tables       | `expense_categories`, `expenses` in migration `0001` (no new migration)  |

## 7. Not done yet

- **Recurring expenses** (a monthly rent entry that creates itself).
- **Receipts or bill attachments.**
- **Expense summary report** by category and period (M19-08), and CSV export (M22).
- **Cash drawer link.** A cash expense is not deducted from a till or day-end cash count.
