import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import type { TopProductRank, TopProductRow } from '@shared/ipc/contract'
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  Field,
  Money,
  Quantity,
  Select,
  Spinner,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { ExportButton } from './ExportButton'
import type { ReportRangeState } from './useReportRange'

/** M19-05: top-selling items by quantity or by value, after returns. */
export function ProductsTab({ range }: { range: ReportRangeState }): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const rankBy: TopProductRank = params.get('rank') === 'quantity' ? 'quantity' : 'value'
  const { from, to } = range
  const top = useQuery({
    queryKey: ['reports:top-products', { from, to, rankBy }],
    queryFn: () => invoke('reports:top-products', { from, to, rankBy, limit: 50 }),
    enabled: range.error === null
  })

  const columns: Column<TopProductRow>[] = [
    {
      id: 'item',
      header: 'Item',
      cell: (r) => (
        <div>
          <span className="font-medium">{r.name}</span>
          <div className="text-sm text-fg-muted">{r.sku}</div>
        </div>
      )
    },
    {
      id: 'sold',
      header: 'Sold',
      align: 'right',
      cell: (r) => <Quantity milli={r.soldMilli} unit={r.unitCode} />
    },
    {
      id: 'returned',
      header: 'Returned',
      align: 'right',
      cell: (r) =>
        r.returnedMilli > 0 ? (
          <Quantity milli={r.returnedMilli} unit={r.unitCode} />
        ) : (
          <span className="text-fg-muted">–</span>
        )
    },
    {
      id: 'net-qty',
      header: 'Net quantity',
      align: 'right',
      cell: (r) => <Quantity milli={r.netMilli} unit={r.unitCode} className="font-medium" />
    },
    {
      id: 'net-value',
      header: 'Net value',
      align: 'right',
      cell: (r) => <Money minor={r.netValueMinor} className="font-medium" />
    }
  ]
  return (
    <div className="space-y-4">
      <Field label="Rank by" className="max-w-xs">
        <Select
          value={rankBy}
          onChange={(event) =>
            setParams(
              (current) => {
                const next = new URLSearchParams(current)
                next.set('rank', event.target.value)
                return next
              },
              { replace: true }
            )
          }
          options={[
            { value: 'value', label: 'Sales value' },
            { value: 'quantity', label: 'Quantity sold' }
          ]}
        />
      </Field>
      {range.error ? null : top.error ? (
        <Alert tone="danger" title={describeError(top.error).title}>
          {describeError(top.error).message}
        </Alert>
      ) : !top.data ? (
        <Spinner label="Loading the figures" />
      ) : (
        <Card
          title="Top-selling items"
          flush
          actions={<ExportButton request={{ report: 'top-products', from, to, rankBy }} />}
        >
          <DataTable
            caption="Top-selling items"
            columns={columns}
            rows={top.data.items}
            getRowId={(r) => r.variantId}
            density="compact"
            empty={
              <EmptyState
                title="Nothing sold in this period"
                description="Items appear here once they have net sales."
              />
            }
          />
          <p className="border-t border-divider px-5 py-3 text-sm text-fg-subtle">
            Net is what was sold minus what came back on returns in the same period. Value is what
            customers paid for the items after discounts. Quantities in different units (kg and
            pieces) aren’t comparable, so rank by value to compare across them.
          </p>
        </Card>
      )}
    </div>
  )
}
