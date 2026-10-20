import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, ChevronLeft, ChevronRight, Pencil, Plus, RotateCcw, Tags, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { ExpenseListFilter, ExpenseStatusFilter, ExpenseSummary } from '@shared/ipc/contract'
import { EXPENSE_STATUS_FILTERS } from '@shared/schemas/expenses'
import { isBusinessDate } from '@shared/storeTime'
import { useCan } from '../auth/permissions'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Money,
  PageHeader,
  Select,
  TextInput,
  useConfirm,
  useToast,
  type Column
} from '../components/ui'
import { ExpenseCategoriesDialog, ExpenseDialog, refreshExpenses } from '../expenses/ExpenseDialogs'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useSettled } from '../lib/useSettled'

const PAGE_SIZE = 50

type DialogState =
  { kind: 'expense'; expense?: ExpenseSummary | undefined } | { kind: 'categories' } | null

/** M18-01, M18-02: running costs, with a date filter and the total of what is shown. */
export default function ExpensesPage(): React.JSX.Element {
  const canManage = useCan()('expense.manage')
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const settledSearch = useSettled(search.trim())
  const categories = useQuery({
    queryKey: ['expenses:list-categories'],
    queryFn: () => invoke('expenses:list-categories')
  })
  const methods = useQuery({
    queryKey: ['payments:list-methods'],
    queryFn: () => invoke('payments:list-methods')
  })

  const statusParam = params.get('status')
  const status: ExpenseStatusFilter = EXPENSE_STATUS_FILTERS.includes(
    statusParam as ExpenseStatusFilter
  )
    ? (statusParam as ExpenseStatusFilter)
    : 'active'
  const category = Number(params.get('category')) || undefined
  const method = Number(params.get('method')) || undefined
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const page = Math.max(0, Number(params.get('page')) || 0)
  // A half-typed date is not a filter yet.
  const fromDate = isBusinessDate(from) ? from : undefined
  const toDate = isBusinessDate(to) ? to : undefined
  const rangeError =
    fromDate !== undefined && toDate !== undefined && fromDate > toDate
      ? 'The end date is before the start date'
      : null

  const setParam = (name: string, value: string): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(name, value)
        else next.delete(name)
        if (name !== 'page') next.delete('page')
        return next
      },
      { replace: true }
    )
  }

  useEffect(() => {
    if (settledSearch !== (params.get('q') ?? '')) setParam('q', settledSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the search settles
  }, [settledSearch])

  const filter: ExpenseListFilter = useMemo(
    () => ({
      ...(params.get('q') ? { search: params.get('q') ?? '' } : {}),
      ...(category === undefined ? {} : { categoryId: category }),
      ...(method === undefined ? {} : { paymentMethodId: method }),
      ...(fromDate === undefined ? {} : { from: fromDate }),
      ...(toDate === undefined ? {} : { to: toDate }),
      status,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE
    }),
    [params, category, method, fromDate, toDate, status, page]
  )

  const list = useQuery({
    queryKey: ['expenses:list', filter],
    queryFn: () => invoke('expenses:list', filter),
    placeholderData: keepPreviousData,
    enabled: rangeError === null
  })
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)
  const filtered = Boolean(
    params.get('q') ||
    category !== undefined ||
    method !== undefined ||
    from ||
    to ||
    status !== 'active'
  )

  const toggleVoid = async (expense: ExpenseSummary): Promise<void> => {
    if (
      !expense.voided &&
      !(await confirm({
        title: 'Void this expense?',
        description:
          'It stays on record but is left out of totals. You can restore it later if it was a mistake.',
        confirmLabel: 'Void expense',
        tone: 'danger'
      }))
    ) {
      return
    }
    try {
      await invoke('expenses:set-voided', { expenseId: expense.expenseId, voided: !expense.voided })
      toast.success(expense.voided ? 'The expense was restored.' : 'The expense was voided.')
      await refreshExpenses(queryClient)
    } catch (failure) {
      toast.error(describeError(failure).message)
    }
  }

  const columns: Column<ExpenseSummary>[] = [
    {
      id: 'date',
      header: 'Date',
      cell: (e) => <span className="tabular whitespace-nowrap">{e.expenseDate}</span>
    },
    {
      id: 'category',
      header: 'Category',
      cell: (e) => (
        <span>
          {e.categoryName} {e.voided && <Badge tone="danger">Voided</Badge>}
        </span>
      )
    },
    {
      id: 'note',
      header: 'Note',
      cell: (e) => e.description ?? <span className="text-fg-muted">–</span>
    },
    { id: 'method', header: 'Paid by', cell: (e) => e.paymentMethodName },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (e) => (
        <Money
          minor={e.amountMinor}
          className={e.voided ? 'text-fg-muted line-through' : 'font-medium'}
        />
      )
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'right' as const,
            cell: (e: ExpenseSummary) => (
              <span className="inline-flex gap-1">
                {!e.voided && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil />}
                    aria-label={`Edit ${e.categoryName} expense of ${e.expenseDate}`}
                    onClick={() => setDialog({ kind: 'expense', expense: e })}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={e.voided ? <RotateCcw /> : <Ban />}
                  aria-label={`${e.voided ? 'Restore' : 'Void'} ${e.categoryName} expense of ${e.expenseDate}`}
                  onClick={() => void toggleVoid(e)}
                >
                  {e.voided ? 'Restore' : 'Void'}
                </Button>
              </span>
            )
          }
        ]
      : [])
  ]

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Rent, salaries, electricity and other running costs."
        actions={
          <>
            <Button icon={<Tags />} onClick={() => setDialog({ kind: 'categories' })}>
              Categories
            </Button>
            {canManage && (
              <Button
                variant="primary"
                icon={<Plus />}
                onClick={() => setDialog({ kind: 'expense' })}
              >
                Add expense
              </Button>
            )}
          </>
        }
      />

      <form
        role="search"
        aria-label="Find expenses"
        onSubmit={(event) => event.preventDefault()}
        className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Field label="Search" hint="Note or category" className="lg:col-span-3">
          <TextInput
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label="From">
          <TextInput
            type="date"
            value={from}
            onChange={(event) => setParam('from', event.target.value)}
          />
        </Field>
        <Field label="To" error={rangeError}>
          <TextInput
            type="date"
            value={to}
            onChange={(event) => setParam('to', event.target.value)}
          />
        </Field>
        <Field label="Category">
          <Select
            value={category === undefined ? '' : String(category)}
            onChange={(event) => setParam('category', event.target.value)}
            placeholder="All categories"
            options={(categories.data ?? []).map((c) => ({
              value: String(c.expenseCategoryId),
              label: c.active ? c.name : `${c.name} (archived)`
            }))}
          />
        </Field>
        <Field label="Paid by">
          <Select
            value={method === undefined ? '' : String(method)}
            onChange={(event) => setParam('method', event.target.value)}
            placeholder="Any way"
            options={(methods.data ?? []).map((m) => ({
              value: String(m.paymentMethodId),
              label: m.active ? m.name : `${m.name} (archived)`
            }))}
          />
        </Field>
        <Field label="Show">
          <Select
            value={status}
            onChange={(event) =>
              setParam('status', event.target.value === 'active' ? '' : event.target.value)
            }
            options={[
              { value: 'active', label: 'Expenses' },
              { value: 'voided', label: 'Voided expenses' },
              { value: 'all', label: 'All, including voided' }
            ]}
          />
        </Field>
      </form>

      {list.error ? (
        <Alert tone="danger" title={describeError(list.error).title}>
          {describeError(list.error).message}
        </Alert>
      ) : (
        <>
          {list.data && (
            <p className="mb-3 text-lg" role="status">
              Total <Money minor={list.data.totalMinor} className="font-semibold" />
              <span className="text-base text-fg-muted">
                {' '}
                · {total} {total === 1 ? 'expense' : 'expenses'}
                {status === 'all' ? ' (voided ones are not counted in the total)' : ''}
              </span>
            </p>
          )}
          <DataTable
            caption="Expenses"
            columns={columns}
            rows={items}
            getRowId={(e) => e.expenseId}
            loading={list.isPending && rangeError === null}
            empty={
              <EmptyState
                icon={<Wallet />}
                title={filtered ? 'No expenses match' : 'No expenses yet'}
                description={
                  filtered
                    ? 'Try other dates or words, or clear the filters.'
                    : canManage
                      ? 'Add rent, salaries and other costs to see where the money goes.'
                      : 'Expenses will appear here once they are recorded.'
                }
              />
            }
          />
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted">
              {list.isPending || total === 0 ? '' : `Showing ${first}–${last} of ${total}`}
            </p>
            {total > PAGE_SIZE && (
              <span className="flex gap-2">
                <Button
                  icon={<ChevronLeft />}
                  disabled={page === 0}
                  onClick={() => setParam('page', String(page - 1))}
                >
                  Previous
                </Button>
                <Button
                  icon={<ChevronRight />}
                  disabled={last >= total}
                  onClick={() => setParam('page', String(page + 1))}
                >
                  Next
                </Button>
              </span>
            )}
          </div>
        </>
      )}

      {dialog?.kind === 'expense' && (
        <ExpenseDialog expense={dialog.expense} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'categories' && (
        <ExpenseCategoriesDialog canManage={canManage} onClose={() => setDialog(null)} />
      )}
    </>
  )
}
