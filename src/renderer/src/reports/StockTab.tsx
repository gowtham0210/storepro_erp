import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { StockLevelFilter, StockReportRow } from '@shared/ipc/contract'
import {
  Alert,
  Badge,
  Card,
  DataTable,
  EmptyState,
  Field,
  Money,
  Quantity,
  Select,
  Spinner,
  TextInput,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useSettled } from '../lib/useSettled'
import { ExportButton } from './ExportButton'
import { Pager } from './Pager'
import { Stat } from './Stat'

const PAGE_SIZE = 100

/** M19-06: stock on hand now, what it is worth at cost, and what is low. Not tied to the period. */
export function StockTab(): React.JSX.Element {
  const [search, setSearch] = useState('')
  const settled = useSettled(search.trim())
  const [level, setLevel] = useState<StockLevelFilter>('all')
  const [page, setPage] = useState(0)
  const filter = {
    ...(settled ? { search: settled } : {}),
    level,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE
  }
  const stock = useQuery({
    queryKey: ['reports:stock', filter],
    queryFn: () => invoke('reports:stock', filter),
    placeholderData: keepPreviousData
  })

  const columns: Column<StockReportRow>[] = [
    {
      id: 'item',
      header: 'Item',
      cell: (r) => (
        <div>
          <span className="font-medium">{r.name}</span>
          <div className="text-sm text-fg-muted">
            {r.sku}
            {r.categoryName ? ` · ${r.categoryName}` : ''}
          </div>
        </div>
      )
    },
    {
      id: 'on-hand',
      header: 'In stock',
      align: 'right',
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          {r.onHandMilli <= 0 ? (
            <Badge tone="danger">Out of stock</Badge>
          ) : r.isLow ? (
            <Badge tone="warning">Low stock</Badge>
          ) : null}
          <Quantity milli={r.onHandMilli} unit={r.unitCode} />
        </span>
      )
    },
    {
      id: 'reorder',
      header: 'Low-stock level',
      align: 'right',
      cell: (r) =>
        r.reorderLevelMilli === null ? (
          <span className="text-fg-muted">–</span>
        ) : (
          <Quantity milli={r.reorderLevelMilli} unit={r.unitCode} />
        )
    },
    {
      id: 'cost',
      header: 'Cost each',
      align: 'right',
      cell: (r) =>
        r.costPriceMinor === null ? (
          <span className="text-fg-muted">Not set</span>
        ) : (
          <Money minor={r.costPriceMinor} />
        )
    },
    {
      id: 'value',
      header: 'Value at cost',
      align: 'right',
      cell: (r) =>
        r.valueMinor === null ? (
          <span className="text-fg-muted">–</span>
        ) : (
          <Money minor={r.valueMinor} className="font-medium" />
        )
    }
  ]
  const totals = stock.data?.totals

  return (
    <div className="space-y-4">
      {totals && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Items"
            value={totals.itemCount}
            definition="Active items that track stock."
          />
          <Stat
            label="Low or out of stock"
            value={totals.lowCount}
            definition={`${totals.outCount} out of stock. Low means at or below the item’s low-stock level.`}
            tone={totals.lowCount > 0 ? 'danger' : 'default'}
          />
          <Stat
            label="Stock value at cost"
            minor={totals.valueMinor}
            definition="Quantity in stock × cost price, for items in stock that have a cost price."
          />
          <Stat
            label="In stock without a cost price"
            value={totals.itemsWithoutCost}
            definition="These items are left out of the value. Set their cost price, or record a purchase."
          />
        </div>
      )}
      <form
        role="search"
        aria-label="Find stock"
        onSubmit={(event) => event.preventDefault()}
        className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr]"
      >
        <Field label="Search" hint="Name, SKU or barcode">
          <TextInput
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
          />
        </Field>
        <Field label="Stock level">
          <Select
            value={level}
            onChange={(event) => {
              setLevel(event.target.value as StockLevelFilter)
              setPage(0)
            }}
            options={[
              { value: 'all', label: 'All tracked items' },
              { value: 'low', label: 'Low or out of stock' },
              { value: 'out', label: 'Out of stock' }
            ]}
          />
        </Field>
      </form>
      {stock.error ? (
        <Alert tone="danger" title={describeError(stock.error).title}>
          {describeError(stock.error).message}
        </Alert>
      ) : !stock.data ? (
        <Spinner label="Loading the figures" />
      ) : (
        <>
          <Card
            title="Stock on hand"
            flush
            actions={
              <ExportButton
                request={{ report: 'stock', ...(settled ? { search: settled } : {}), level }}
              />
            }
          >
            <DataTable
              caption="Stock on hand"
              columns={columns}
              rows={stock.data.items}
              getRowId={(r) => r.variantId}
              density="compact"
              empty={
                <EmptyState
                  title="No items match"
                  description="Try other words, or clear the filters."
                />
              }
            />
          </Card>
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={stock.data.totals.itemCount}
            onPage={setPage}
          />
        </>
      )}
    </div>
  )
}
