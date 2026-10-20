import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Check, Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { ExpenseCategorySummary, ExpenseSummary } from '@shared/ipc/contract'
import { parseMoney, toDecimalString } from '@shared/money'
import { expenseCategoryName } from '@shared/schemas/expenses'
import { businessDateOf } from '@shared/storeTime'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  NumberInput,
  Select,
  Spinner,
  TextInput,
  useCurrency,
  useToast,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError, fieldErrorsFrom } from '../lib/describeError'
import { useStoreTimeZone } from '../store/storeContext'

export async function refreshExpenses(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all(
    ['expenses:list', 'expenses:list-categories', 'payments:list-methods'].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] })
    )
  )
}

/** M18-01: record an expense, or correct one. */
export function ExpenseDialog({
  expense,
  onClose
}: {
  /** The expense being corrected; leave out to record a new one. */
  expense?: ExpenseSummary | undefined
  onClose: () => void
}): React.JSX.Element {
  const { minorUnits } = useCurrency()
  const timeZone = useStoreTimeZone()
  const queryClient = useQueryClient()
  const toast = useToast()
  const categories = useQuery({
    queryKey: ['expenses:list-categories'],
    queryFn: () => invoke('expenses:list-categories')
  })
  const methods = useQuery({
    queryKey: ['payments:list-methods'],
    queryFn: () => invoke('payments:list-methods')
  })

  const [categoryId, setCategoryId] = useState(expense ? String(expense.expenseCategoryId) : '')
  const [date, setDate] = useState(
    () => expense?.expenseDate ?? businessDateOf(Date.now(), timeZone)
  )
  const [amount, setAmount] = useState(
    expense ? toDecimalString(expense.amountMinor, minorUnits) : ''
  )
  const [methodId, setMethodId] = useState(expense ? String(expense.paymentMethodId) : '')
  const [note, setNote] = useState(expense?.description ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setError(null)
    const found: Record<string, string> = {}
    if (!categoryId) found.expenseCategoryId = 'Choose a category'
    if (!date) found.expenseDate = 'Enter the date'
    if (!methodId) found.paymentMethodId = 'Choose how it was paid'
    let amountMinor = 0
    try {
      amountMinor = amount.trim() === '' ? 0 : parseMoney(amount, minorUnits)
      if (amountMinor <= 0) found.amountMinor = 'Enter an amount above zero'
    } catch (failure) {
      found.amountMinor = failure instanceof RangeError ? failure.message : 'Enter a valid amount'
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const input = {
      expenseCategoryId: Number(categoryId),
      expenseDate: date,
      amountMinor,
      paymentMethodId: Number(methodId),
      description: note.trim() === '' ? null : note.trim()
    }
    setBusy(true)
    try {
      if (expense) await invoke('expenses:update', { expenseId: expense.expenseId, ...input })
      else await invoke('expenses:create', input)
      toast.success(expense ? 'The expense was updated.' : 'The expense was recorded.')
      await refreshExpenses(queryClient)
      onClose()
    } catch (failure) {
      const fields = fieldErrorsFrom(failure)
      if (fields && Object.keys(fields).length > 0) setErrors(fields)
      else setError(describeError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  const loadError = categories.error ?? methods.error
  // New expenses can only use active choices; an existing one keeps what it has.
  const categoryOptions = (categories.data ?? [])
    .filter((c) => c.active || String(c.expenseCategoryId) === categoryId)
    .map((c) => ({
      value: String(c.expenseCategoryId),
      label: c.active ? c.name : `${c.name} (archived)`
    }))
  const methodOptions = (methods.data ?? [])
    .filter((m) => m.active || String(m.paymentMethodId) === methodId)
    .map((m) => ({
      value: String(m.paymentMethodId),
      label: m.active ? m.name : `${m.name} (archived)`
    }))

  return (
    <Dialog
      open
      onClose={onClose}
      title={expense ? 'Edit expense' : 'Add expense'}
      description="Rent, electricity, salaries and other running costs."
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {expense ? 'Save changes' : 'Add expense'}
          </Button>
        </>
      }
    >
      {loadError ? (
        <Alert tone="danger">{describeError(loadError).message}</Alert>
      ) : !categories.data || !methods.data ? (
        <Spinner label="Loading" />
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          className="space-y-4"
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Category" required error={errors.expenseCategoryId}>
              <Select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                placeholder="Choose a category…"
                options={categoryOptions}
              />
            </Field>
            <Field label="Date" required error={errors.expenseDate}>
              <TextInput
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            <Field label="Amount" required error={errors.amountMinor}>
              <NumberInput
                value={amount}
                onValueChange={setAmount}
                decimals={minorUnits}
                inputMode="decimal"
              />
            </Field>
            <Field label="Paid by" required error={errors.paymentMethodId}>
              <Select
                value={methodId}
                onChange={(event) => setMethodId(event.target.value)}
                placeholder="Choose…"
                options={methodOptions}
              />
            </Field>
          </div>
          <Field label="Note" hint="Optional" error={errors.description}>
            <TextInput
              value={note}
              maxLength={200}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  )
}

/** M18-01: the categories expenses are filed under. Archived ones stay on their expenses. */
export function ExpenseCategoriesDialog({
  canManage,
  onClose
}: {
  canManage: boolean
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const categories = useQuery({
    queryKey: ['expenses:list-categories'],
    queryFn: () => invoke('expenses:list-categories')
  })
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)

  const run = async (action: () => Promise<unknown>, done: string): Promise<boolean> => {
    try {
      await action()
      toast.success(done)
      await refreshExpenses(queryClient)
      return true
    } catch (failure) {
      toast.error(describeError(failure).message)
      return false
    }
  }

  const add = async (): Promise<void> => {
    const parsed = expenseCategoryName.safeParse(name)
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? 'Enter a category name')
      return
    }
    setNameError(null)
    try {
      await invoke('expenses:create-category', { name: parsed.data })
      toast.success(`${parsed.data} was added.`)
      setName('')
      await refreshExpenses(queryClient)
    } catch (failure) {
      const fields = fieldErrorsFrom(failure)
      setNameError(fields?.name ?? describeError(failure).message)
    }
  }

  const rename = async (category: ExpenseCategorySummary): Promise<void> => {
    if (!renaming) return
    const parsed = expenseCategoryName.safeParse(renaming.name)
    if (!parsed.success) {
      setRenameError(parsed.error.issues[0]?.message ?? 'Enter a category name')
      return
    }
    try {
      await invoke('expenses:rename-category', {
        expenseCategoryId: category.expenseCategoryId,
        name: parsed.data
      })
      toast.success(`${category.name} is now ${parsed.data}.`)
      setRenaming(null)
      setRenameError(null)
      await refreshExpenses(queryClient)
    } catch (failure) {
      const fields = fieldErrorsFrom(failure)
      setRenameError(fields?.name ?? describeError(failure).message)
    }
  }

  const columns: Column<ExpenseCategorySummary>[] = [
    {
      id: 'name',
      header: 'Category',
      cell: (c) =>
        renaming?.id === c.expenseCategoryId ? (
          <span className="flex items-start gap-1">
            <Field label={`New name for ${c.name}`} hideLabel error={renameError}>
              <TextInput
                value={renaming.name}
                maxLength={60}
                autoFocus
                onChange={(event) =>
                  setRenaming({ id: c.expenseCategoryId, name: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void rename(c)
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setRenaming(null)
                    setRenameError(null)
                  }
                }}
              />
            </Field>
            <Button
              size="sm"
              variant="ghost"
              icon={<Check />}
              aria-label={`Save new name for ${c.name}`}
              onClick={() => void rename(c)}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<X />}
              aria-label="Cancel renaming"
              onClick={() => {
                setRenaming(null)
                setRenameError(null)
              }}
            />
          </span>
        ) : (
          <span>
            {c.name} {!c.active && <Badge>Archived</Badge>}
          </span>
        )
    },
    { id: 'count', header: 'Expenses', align: 'right', cell: (c) => c.expenseCount },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'right' as const,
            cell: (c: ExpenseCategorySummary) =>
              renaming?.id === c.expenseCategoryId ? null : (
                <span className="inline-flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil />}
                    aria-label={`Rename ${c.name}`}
                    onClick={() => setRenaming({ id: c.expenseCategoryId, name: c.name })}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={c.active ? <Archive /> : <ArchiveRestore />}
                    aria-label={`${c.active ? 'Archive' : 'Restore'} ${c.name}`}
                    onClick={() =>
                      void run(
                        () =>
                          invoke('expenses:set-category-active', {
                            expenseCategoryId: c.expenseCategoryId,
                            active: !c.active
                          }),
                        `${c.name} was ${c.active ? 'archived' : 'restored'}.`
                      )
                    }
                  >
                    {c.active ? 'Archive' : 'Restore'}
                  </Button>
                </span>
              )
          }
        ]
      : [])
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Expense categories"
      description="Archiving a category keeps it on the expenses already filed under it, and hides it from new ones."
      footer={<Button onClick={onClose}>Close window</Button>}
    >
      <div className="space-y-5">
        {canManage && (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void add()
            }}
            className="flex items-start gap-2"
          >
            <Field label="New category" error={nameError} className="flex-1">
              <TextInput
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Button type="submit" icon={<Plus />} className="mt-6">
              Add category
            </Button>
          </form>
        )}
        {categories.error ? (
          <Alert tone="danger">{describeError(categories.error).message}</Alert>
        ) : (
          <DataTable
            caption="Expense categories"
            columns={columns}
            rows={categories.data ?? []}
            getRowId={(c) => c.expenseCategoryId}
            loading={categories.isPending}
            density="compact"
          />
        )}
      </div>
    </Dialog>
  )
}
