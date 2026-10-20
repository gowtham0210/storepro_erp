import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  History,
  Pencil,
  Plus,
  Users
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type {
  CustomerListFilter,
  CustomerStatusFilter,
  CustomerSummary
} from '@shared/ipc/contract'
import { CUSTOMER_STATUS_FILTERS } from '@shared/schemas/customers'
import { formatStoreTime } from '@shared/storeTime'
import { useCan } from '../auth/permissions'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  Select,
  TextInput,
  useConfirm,
  useToast,
  type Column
} from '../components/ui'
import { CustomerDialog, refreshCustomers } from '../customers/CustomerDialog'
import { CustomerHistoryDialog } from '../customers/CustomerHistoryDialog'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useSettled } from '../lib/useSettled'
import { useStoreTimeZone } from '../store/storeContext'

const PAGE_SIZE = 50

type DialogState =
  | { kind: 'edit'; customer?: CustomerSummary | undefined }
  | { kind: 'history'; customerId: number }
  | null

/** M17-01, M17-03: customers, their details and what they have bought. */
export default function CustomersPage(): React.JSX.Element {
  const can = useCan()
  const canManage = can('customer.manage')
  const canSeeSales = can('sale.view')
  const timeZone = useStoreTimeZone()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const settledSearch = useSettled(search.trim())

  const statusParam = params.get('status')
  const status: CustomerStatusFilter = CUSTOMER_STATUS_FILTERS.includes(
    statusParam as CustomerStatusFilter
  )
    ? (statusParam as CustomerStatusFilter)
    : 'active'
  const page = Math.max(0, Number(params.get('page')) || 0)

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

  const filter: CustomerListFilter = useMemo(
    () => ({
      ...(params.get('q') ? { search: params.get('q') ?? '' } : {}),
      status,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE
    }),
    [params, status, page]
  )
  const list = useQuery({
    queryKey: ['customers:list', filter],
    queryFn: () => invoke('customers:list', filter),
    placeholderData: keepPreviousData
  })
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)
  const filtered = Boolean(params.get('q') || status !== 'active')

  const toggleActive = async (customer: CustomerSummary): Promise<void> => {
    if (
      customer.active &&
      !(await confirm({
        title: `Archive ${customer.name}?`,
        description:
          'They will no longer be offered at the billing counter. Their past invoices keep their name, and you can restore them any time.',
        confirmLabel: 'Archive customer'
      }))
    ) {
      return
    }
    try {
      await invoke('customers:set-active', {
        customerId: customer.customerId,
        active: !customer.active
      })
      toast.success(`${customer.name} was ${customer.active ? 'archived' : 'restored'}.`)
      await refreshCustomers(queryClient)
    } catch (failure) {
      toast.error(describeError(failure).message)
    }
  }

  const columns: Column<CustomerSummary>[] = [
    {
      id: 'name',
      header: 'Customer',
      cell: (c) => (
        <div>
          <span className="font-medium">{c.name}</span> {!c.active && <Badge>Archived</Badge>}
          {c.address && <div className="text-sm text-fg-muted">{c.address}</div>}
        </div>
      )
    },
    {
      id: 'contact',
      header: 'Contact',
      cell: (c) =>
        c.phone || c.email ? (
          <div>
            {c.phone && <div className="tabular">{c.phone}</div>}
            {c.email && <div className="text-sm text-fg-muted">{c.email}</div>}
          </div>
        ) : (
          <span className="text-fg-muted">–</span>
        )
    },
    {
      id: 'tax',
      header: 'GSTIN / tax number',
      cell: (c) =>
        c.taxRegistrationNumber ? (
          <span className="font-mono text-sm">{c.taxRegistrationNumber}</span>
        ) : (
          <span className="text-fg-muted">–</span>
        )
    },
    { id: 'sales', header: 'Purchases', align: 'right', cell: (c) => c.saleCount },
    {
      id: 'last',
      header: 'Last purchase',
      cell: (c) =>
        c.lastPurchaseAt === null ? (
          <span className="text-fg-muted">–</span>
        ) : (
          <span className="text-fg-muted">
            {formatStoreTime(c.lastPurchaseAt, timeZone, 'date')}
          </span>
        )
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (c) => (
        <span className="inline-flex gap-1">
          {canSeeSales && (
            <Button
              size="sm"
              variant="ghost"
              icon={<History />}
              aria-label={`Purchases by ${c.name}`}
              onClick={() => setDialog({ kind: 'history', customerId: c.customerId })}
            >
              Purchases
            </Button>
          )}
          {canManage && (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Pencil />}
                aria-label={`Edit ${c.name}`}
                onClick={() => setDialog({ kind: 'edit', customer: c })}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={c.active ? <Archive /> : <ArchiveRestore />}
                aria-label={`${c.active ? 'Archive' : 'Restore'} ${c.name}`}
                onClick={() => void toggleActive(c)}
              >
                {c.active ? 'Archive' : 'Restore'}
              </Button>
            </>
          )}
        </span>
      )
    }
  ]

  return (
    <>
      <PageHeader
        title="Customers"
        description="Who you sell to, and what they have bought."
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'edit' })}>
              Add customer
            </Button>
          )
        }
      />

      <form
        role="search"
        aria-label="Find customers"
        onSubmit={(event) => event.preventDefault()}
        className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr]"
      >
        <Field label="Search" hint="Name, phone, email or tax number">
          <TextInput
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label="Show">
          <Select
            value={status}
            onChange={(event) =>
              setParam('status', event.target.value === 'active' ? '' : event.target.value)
            }
            options={[
              { value: 'active', label: 'Active customers' },
              { value: 'archived', label: 'Archived customers' },
              { value: 'all', label: 'All customers' }
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
          <DataTable
            caption="Customers"
            columns={columns}
            rows={items}
            getRowId={(c) => c.customerId}
            loading={list.isPending}
            empty={
              <EmptyState
                icon={<Users />}
                title={filtered ? 'No customers match' : 'No customers yet'}
                description={
                  filtered
                    ? 'Try other words, or show all customers.'
                    : 'Add customers here, or at the billing counter while serving them.'
                }
              />
            }
          />
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted" role="status">
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

      {dialog?.kind === 'edit' && (
        <CustomerDialog customer={dialog.customer} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'history' && (
        <CustomerHistoryDialog customerId={dialog.customerId} onClose={() => setDialog(null)} />
      )}
    </>
  )
}
