import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FolderTree, Package, Plus, Ruler } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { ProductListFilter, ProductListItem, ProductStatusFilter } from '@shared/ipc/contract'
import { useCan } from '../auth/permissions'
import { NewProductDialog, ProductDialog } from '../catalog/ProductDialog'
import { CategoriesDialog, UnitsDialog } from '../catalog/ReferenceDialogs'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Money,
  PageHeader,
  Quantity,
  Select,
  TextInput,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'

const PAGE_SIZE = 50
const STATUSES: ProductStatusFilter[] = ['active', 'archived', 'all']

type DialogState =
  | { kind: 'new' }
  | { kind: 'product'; productId: number }
  | { kind: 'categories' }
  | { kind: 'units' }
  | null

/** Typing settles for a moment before the list is searched again. */
function useSettled<T>(value: T, delayMs = 200): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

const columns: Column<ProductListItem>[] = [
  {
    id: 'item',
    header: 'Item',
    cell: (item) => (
      <div>
        <span className="font-medium">{item.productName}</span>
        {item.variantName && <span> · {item.variantName}</span>}
        {!item.active && (
          <>
            {' '}
            <Badge>Archived</Badge>
          </>
        )}
        <div className="text-sm text-fg-muted">{item.sku}</div>
      </div>
    )
  },
  {
    id: 'barcode',
    header: 'Barcode',
    cell: (item) =>
      item.barcodes.length === 0 ? (
        <span className="text-fg-muted">None</span>
      ) : (
        <span className="tabular">
          {item.barcodes[0]}
          {item.barcodes.length > 1 && (
            <span className="text-fg-muted"> +{item.barcodes.length - 1}</span>
          )}
        </span>
      )
  },
  {
    id: 'category',
    header: 'Category',
    cell: (item) => item.categoryName ?? <span className="text-fg-muted">None</span>
  },
  {
    id: 'price',
    header: 'Price',
    align: 'right',
    cell: (item) => (
      <span>
        <Money minor={item.sellingPriceMinor} />
        <span className="text-fg-muted"> / {item.unitCode}</span>
      </span>
    )
  },
  {
    id: 'mrp',
    header: 'MRP',
    align: 'right',
    cell: (item) =>
      item.mrpMinor === null ? (
        <span className="text-fg-muted">–</span>
      ) : (
        <Money minor={item.mrpMinor} />
      )
  },
  {
    id: 'stock',
    header: 'In stock',
    align: 'right',
    cell: (item) =>
      item.onHandMilli === null ? (
        <span className="text-fg-muted">Not tracked</span>
      ) : (
        <Quantity
          milli={item.onHandMilli}
          unit={item.unitCode}
          className={item.onHandMilli <= 0 ? 'text-danger' : ''}
        />
      )
  }
]

/** M09-05: every item the store sells, searchable by name, SKU and barcode. */
export default function ProductsPage(): React.JSX.Element {
  const canManage = useCan()('product.manage')
  const [params, setParams] = useSearchParams()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const settledSearch = useSettled(search.trim())
  const categories = useIpcQuery('catalog:list-categories')

  const statusParam = params.get('status')
  const status: ProductStatusFilter = STATUSES.includes(statusParam as ProductStatusFilter)
    ? (statusParam as ProductStatusFilter)
    : 'active'
  const category = Number(params.get('category')) || undefined
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

  // The settled search goes into the address, so Back returns to it.
  useEffect(() => {
    if (settledSearch !== (params.get('q') ?? '')) setParam('q', settledSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the search settles
  }, [settledSearch])

  const filter: ProductListFilter = useMemo(
    () => ({
      ...(params.get('q') ? { search: params.get('q') ?? '' } : {}),
      ...(category === undefined ? {} : { categoryId: category }),
      status,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE
    }),
    [params, category, status, page]
  )
  const list = useQuery({
    queryKey: ['products:list', filter],
    queryFn: () => invoke('products:list', filter),
    placeholderData: keepPreviousData
  })
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)
  const filtered = Boolean(params.get('q') || category !== undefined || status !== 'active')

  return (
    <>
      <PageHeader
        title="Products"
        description="Items, pack sizes, prices and barcodes. Price changes apply to the next bill."
        actions={
          <>
            <Button icon={<FolderTree />} onClick={() => setDialog({ kind: 'categories' })}>
              Categories
            </Button>
            <Button icon={<Ruler />} onClick={() => setDialog({ kind: 'units' })}>
              Units
            </Button>
            {canManage && (
              <Button variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'new' })}>
                Add product
              </Button>
            )}
          </>
        }
      />
      <form
        role="search"
        aria-label="Find products"
        onSubmit={(event) => event.preventDefault()}
        className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_1fr]"
      >
        <Field label="Search" hint="Name, SKU or barcode">
          <TextInput
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label="Category">
          <Select
            value={category === undefined ? '' : String(category)}
            onChange={(event) => setParam('category', event.target.value)}
            placeholder="All categories"
            options={(categories.data ?? []).map((c) => ({
              value: String(c.categoryId),
              label: c.active ? c.name : `${c.name} (archived)`
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
              { value: 'active', label: 'On sale' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All items' }
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
            caption="Products"
            columns={columns}
            rows={items}
            getRowId={(item) => item.variantId}
            loading={list.isPending}
            onRowActivate={(item) => setDialog({ kind: 'product', productId: item.productId })}
            empty={
              <EmptyState
                icon={<Package />}
                title={filtered ? 'No products match' : 'No products yet'}
                description={
                  filtered
                    ? 'Try other words, or clear the filters.'
                    : canManage
                      ? 'Add the items you sell, with their prices and barcodes.'
                      : undefined
                }
                action={
                  !filtered && canManage ? (
                    <Button
                      variant="primary"
                      icon={<Plus />}
                      onClick={() => setDialog({ kind: 'new' })}
                    >
                      Add product
                    </Button>
                  ) : undefined
                }
              />
            }
          />
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted" role="status">
              {list.isPending ? '' : total === 0 ? '' : `Showing ${first}–${last} of ${total}`}
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
      {dialog?.kind === 'new' && (
        <NewProductDialog
          onClose={() => setDialog(null)}
          onCreated={(product) => setDialog({ kind: 'product', productId: product.productId })}
        />
      )}
      {dialog?.kind === 'product' && (
        <ProductDialog productId={dialog.productId} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'categories' && <CategoriesDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'units' && <UnitsDialog onClose={() => setDialog(null)} />}
    </>
  )
}
