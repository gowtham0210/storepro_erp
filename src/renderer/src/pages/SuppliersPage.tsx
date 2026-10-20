import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Truck
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type {
  SupplierListFilter,
  SupplierStatusFilter,
  SupplierSummary
} from '@shared/ipc/contract'
import { SUPPLIER_STATUS_FILTERS } from '@shared/schemas/purchasing'
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
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useSettled } from '../lib/useSettled'
import { refreshSuppliers, SupplierDialog } from '../purchasing/SupplierDialog'

const PAGE_SIZE = 50

/** M15-01: the supplier list, with add, edit and archive. */
export default function SuppliersPage(): React.JSX.Element {
  const canManage = useCan()('supplier.manage')
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const settledSearch = useSettled(search.trim())
  const [dialog, setDialog] = useState<{ supplier?: SupplierSummary } | null>(null)

  const statusParam = params.get('status')
  const status: SupplierStatusFilter = SUPPLIER_STATUS_FILTERS.includes(
    statusParam as SupplierStatusFilter
  )
    ? (statusParam as SupplierStatusFilter)
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

  const filter: SupplierListFilter = useMemo(
    () => ({
      ...(params.get('q') ? { search: params.get('q') ?? '' } : {}),
      status,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE
    }),
    [params, status, page]
  )

  const list = useQuery({
    queryKey: ['suppliers:list', filter],
    queryFn: () => invoke('suppliers:list', filter),
    placeholderData: keepPreviousData
  })
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)
  const filtered = Boolean(params.get('q') || status !== 'active')

  const toggleActive = async (supplier: SupplierSummary): Promise<void> => {
    if (
      supplier.active &&
      !(await confirm({
        title: `Archive ${supplier.name}?`,
        description:
          'They will no longer be offered on new orders or goods receipts. Past purchases keep their name, and you can restore them any time.',
        confirmLabel: 'Archive supplier'
      }))
    ) {
      return
    }
    try {
      await invoke('suppliers:set-active', {
        supplierId: supplier.supplierId,
        active: !supplier.active
      })
      toast.success(`${supplier.name} was ${supplier.active ? 'archived' : 'restored'}.`)
      await refreshSuppliers(queryClient)
    } catch (failure) {
      toast.error(describeError(failure).message)
    }
  }

  const columns: Column<SupplierSummary>[] = [
    {
      id: 'name',
      header: 'Supplier',
      cell: (s) => (
        <div>
          <span className="font-medium">{s.name}</span> {!s.active && <Badge>Archived</Badge>}
          {s.address && <div className="text-sm text-fg-muted">{s.address}</div>}
        </div>
      )
    },
    {
      id: 'contact',
      header: 'Contact',
      cell: (s) =>
        s.contactPerson || s.phone || s.email ? (
          <div>
            {s.contactPerson && <div>{s.contactPerson}</div>}
            <div className="text-sm text-fg-muted">
              {[s.phone, s.email].filter(Boolean).join(' · ')}
            </div>
          </div>
        ) : (
          <span className="text-fg-muted">–</span>
        )
    },
    {
      id: 'tax',
      header: 'GSTIN / tax number',
      cell: (s) =>
        s.taxRegistrationNumber ? (
          <span className="font-mono text-sm">{s.taxRegistrationNumber}</span>
        ) : (
          <span className="text-fg-muted">–</span>
        )
    },
    { id: 'documents', header: 'Purchases', align: 'right', cell: (s) => s.documentCount },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'right' as const,
            cell: (s: SupplierSummary) => (
              <span className="inline-flex gap-1" onClick={(event) => event.stopPropagation()}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil />}
                  aria-label={`Edit ${s.name}`}
                  onClick={() => setDialog({ supplier: s })}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={s.active ? <Archive /> : <ArchiveRestore />}
                  aria-label={`${s.active ? 'Archive' : 'Restore'} ${s.name}`}
                  onClick={() => void toggleActive(s)}
                >
                  {s.active ? 'Archive' : 'Restore'}
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
        title="Suppliers"
        description="The people and companies you buy stock from."
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus />} onClick={() => setDialog({})}>
              Add supplier
            </Button>
          )
        }
      />

      <form
        role="search"
        aria-label="Find suppliers"
        onSubmit={(event) => event.preventDefault()}
        className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr]"
      >
        <Field label="Search" hint="Name, contact, phone or tax number">
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
              { value: 'active', label: 'Active suppliers' },
              { value: 'archived', label: 'Archived suppliers' },
              { value: 'all', label: 'All suppliers' }
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
            caption="Suppliers"
            columns={columns}
            rows={items}
            getRowId={(s) => s.supplierId}
            loading={list.isPending}
            empty={
              <EmptyState
                icon={<Truck />}
                title={filtered ? 'No suppliers match' : 'No suppliers yet'}
                description={
                  filtered
                    ? 'Try other words, or show all suppliers.'
                    : canManage
                      ? 'Add the people you buy stock from to record purchases.'
                      : 'Suppliers will appear here once they are added.'
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

      {dialog && <SupplierDialog supplier={dialog.supplier} onClose={() => setDialog(null)} />}
    </>
  )
}
