import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  History,
  SlidersHorizontal
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { StockLevelFilter, StockListFilter, StockListItem } from '@shared/ipc/contract'
import { STOCK_LEVEL_FILTERS } from '@shared/schemas/inventory'
import { useCan } from '../auth/permissions'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  Quantity,
  Select,
  TextInput,
  type Column
} from '../components/ui'
import {
  AdjustmentHistoryDialog,
  MovementHistoryDialog,
  StockAdjustmentDialog,
  StockCountDialog
} from '../inventory/InventoryDialogs'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'

const PAGE_SIZE = 50

type DialogState =
  | { kind: 'adjust'; item?: StockListItem | undefined }
  | { kind: 'count' }
  | { kind: 'movements'; variantId: number; item?: StockListItem | undefined }
  | { kind: 'adjustments' }
  | null

function useSettled<T>(value: T, delayMs = 200): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

/** M14-02 to M14-07: stock on hand, low-stock list, adjustments, stock counts and movement history. */
export default function InventoryPage(): React.JSX.Element {
  const canAdjust = useCan()('stock.adjust')
  const [params, setParams] = useSearchParams()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const settledSearch = useSettled(search.trim())
  const categories = useIpcQuery('catalog:list-categories')

  const levelParam = params.get('level')
  const level: StockLevelFilter = STOCK_LEVEL_FILTERS.includes(levelParam as StockLevelFilter)
    ? (levelParam as StockLevelFilter)
    : 'all'
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

  useEffect(() => {
    if (settledSearch !== (params.get('q') ?? '')) setParam('q', settledSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the search settles
  }, [settledSearch])

  const filter: StockListFilter = useMemo(
    () => ({
      ...(params.get('q') ? { search: params.get('q') ?? '' } : {}),
      ...(category === undefined ? {} : { categoryId: category }),
      level,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE
    }),
    [params, category, level, page]
  )

  const list = useQuery({
    queryKey: ['inventory:list', filter],
    queryFn: () => invoke('inventory:list', filter),
    placeholderData: keepPreviousData
  })

  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const lowStockCount = list.data?.lowStockCount ?? 0
  const outOfStockCount = list.data?.outOfStockCount ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)
  const filtered = Boolean(params.get('q') || category !== undefined || level !== 'all')

  const columns: Column<StockListItem>[] = [
    {
      id: 'item',
      header: 'Item',
      cell: (item) => (
        <div>
          <span className="font-medium">{item.productName}</span>
          {item.variantName && <span> · {item.variantName}</span>}
          <div className="text-sm text-fg-muted">{item.sku}</div>
        </div>
      )
    },
    {
      id: 'category',
      header: 'Category',
      cell: (item) => item.categoryName ?? <span className="text-fg-muted">None</span>
    },
    {
      id: 'reorder',
      header: 'Low-stock level',
      align: 'right',
      cell: (item) =>
        item.reorderLevelMilli === null ? (
          <span className="text-fg-muted">–</span>
        ) : (
          <Quantity milli={item.reorderLevelMilli} unit={item.unitCode} />
        )
    },
    {
      id: 'stock',
      header: 'In stock',
      align: 'right',
      cell: (item) => (
        <span className="inline-flex items-center justify-end gap-2">
          {item.onHandMilli <= 0 ? (
            <Badge tone="danger">Out of stock</Badge>
          ) : item.isLowStock ? (
            <Badge tone="warning">Low stock</Badge>
          ) : null}
          <Quantity
            milli={item.onHandMilli}
            unit={item.unitCode}
            className={item.onHandMilli <= 0 ? 'font-medium text-danger' : 'font-medium'}
          />
        </span>
      )
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (item) => (
        <span
          className="inline-flex flex-wrap justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            icon={<History />}
            aria-label={`Movements for ${item.name}`}
            onClick={() => setDialog({ kind: 'movements', variantId: item.variantId, item })}
          >
            Movements
          </Button>
          {canAdjust && (
            <Button
              size="sm"
              variant="ghost"
              icon={<SlidersHorizontal />}
              aria-label={`Adjust ${item.name}`}
              onClick={() => setDialog({ kind: 'adjust', item })}
            >
              Adjust
            </Button>
          )}
        </span>
      )
    }
  ]

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock on hand, low-stock alerts, adjustments and physical stock counts."
        actions={
          <>
            <Button icon={<History />} onClick={() => setDialog({ kind: 'adjustments' })}>
              Adjustments
            </Button>
            {canAdjust && (
              <>
                <Button icon={<ClipboardCheck />} onClick={() => setDialog({ kind: 'count' })}>
                  Count stock
                </Button>
                <Button
                  variant="primary"
                  icon={<SlidersHorizontal />}
                  onClick={() => setDialog({ kind: 'adjust' })}
                >
                  Adjust stock
                </Button>
              </>
            )}
          </>
        }
      />

      {lowStockCount > 0 && level === 'all' && (
        <div className="mb-4">
          <Alert
            tone={outOfStockCount > 0 ? 'warning' : 'info'}
            title={
              outOfStockCount > 0
                ? `${outOfStockCount} ${outOfStockCount === 1 ? 'item is' : 'items are'} out of stock (${lowStockCount} low or out overall)`
                : `${lowStockCount} ${lowStockCount === 1 ? 'item is' : 'items are'} at or below the low-stock level`
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Filter the list to check what needs restocking or counting.</span>
              <Button size="sm" onClick={() => setParam('level', 'low')}>
                Show low stock
              </Button>
            </div>
          </Alert>
        </div>
      )}

      <form
        role="search"
        aria-label="Find stock"
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
        <Field label="Stock level">
          <Select
            value={level}
            onChange={(event) =>
              setParam('level', event.target.value === 'all' ? '' : event.target.value)
            }
            options={[
              { value: 'all', label: 'All tracked items' },
              {
                value: 'low',
                label:
                  lowStockCount > 0
                    ? `Low or out of stock (${lowStockCount})`
                    : 'Low or out of stock'
              },
              {
                value: 'out',
                label: outOfStockCount > 0 ? `Out of stock (${outOfStockCount})` : 'Out of stock'
              }
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
            caption="Inventory"
            columns={columns}
            rows={items}
            getRowId={(item) => item.variantId}
            loading={list.isPending}
            onRowActivate={(item) =>
              setDialog({ kind: 'movements', variantId: item.variantId, item })
            }
            empty={
              <EmptyState
                icon={<Boxes />}
                title={filtered ? 'No items match' : 'No tracked items yet'}
                description={
                  filtered
                    ? 'Try other words, or clear the filters.'
                    : 'Products with stock tracking turned on will appear here.'
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

      {dialog?.kind === 'adjust' && (
        <StockAdjustmentDialog initialItem={dialog.item} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'count' && <StockCountDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'movements' && (
        <MovementHistoryDialog
          variantId={dialog.variantId}
          onClose={() => setDialog(null)}
          onAdjust={
            dialog.item ? () => setDialog({ kind: 'adjust', item: dialog.item }) : undefined
          }
        />
      )}
      {dialog?.kind === 'adjustments' && (
        <AdjustmentHistoryDialog onClose={() => setDialog(null)} />
      )}
    </>
  )
}
