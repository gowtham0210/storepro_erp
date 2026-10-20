import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { MovementType, StockMovementRow } from '@shared/ipc/contract'
import { MOVEMENT_TYPES } from '@shared/schemas/inventory'
import { formatStoreTime } from '@shared/storeTime'
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  Field,
  Quantity,
  Select,
  Spinner,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useStoreTimeZone } from '../store/storeContext'
import { ExportButton } from './ExportButton'
import { Pager } from './Pager'
import type { ReportRangeState } from './useReportRange'

const PAGE_SIZE = 100

const LABELS: Record<MovementType, string> = {
  sale: 'Sale',
  sale_void: 'Sale voided',
  sale_return: 'Customer return',
  goods_receipt: 'Goods received',
  adjustment: 'Adjustment'
}

/** M19-06: every stock movement in the period across all items, with the document behind each. */
export function MovementsTab({ range }: { range: ReportRangeState }): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const [type, setType] = useState<MovementType | ''>('')
  const [page, setPage] = useState(0)
  const { from, to } = range
  const filter = {
    from,
    to,
    ...(type ? { movementType: type } : {}),
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE
  }
  const movements = useQuery({
    queryKey: ['reports:stock-movements', filter],
    queryFn: () => invoke('reports:stock-movements', filter),
    placeholderData: keepPreviousData,
    enabled: range.error === null
  })

  const columns: Column<StockMovementRow>[] = [
    {
      id: 'when',
      header: 'When',
      cell: (r) => <span className="text-fg-muted">{formatStoreTime(r.occurredAt, timeZone)}</span>
    },
    { id: 'type', header: 'What happened', cell: (r) => LABELS[r.movementType] },
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
      id: 'change',
      header: 'Change',
      align: 'right',
      cell: (r) => (
        <span className={r.quantityDeltaMilli < 0 ? 'text-danger' : undefined}>
          {r.quantityDeltaMilli > 0 ? '+' : ''}
          <Quantity milli={r.quantityDeltaMilli} unit={r.unitCode} />
        </span>
      )
    },
    {
      id: 'document',
      header: 'Document',
      cell: (r) => <span className="font-mono">{r.documentNumber}</span>
    }
  ]
  return (
    <div className="space-y-4">
      <Field label="Show" className="max-w-xs">
        <Select
          value={type}
          onChange={(event) => {
            setType(event.target.value as MovementType | '')
            setPage(0)
          }}
          placeholder="All movements"
          options={MOVEMENT_TYPES.map((t) => ({ value: t, label: LABELS[t] }))}
        />
      </Field>
      {range.error ? null : movements.error ? (
        <Alert tone="danger" title={describeError(movements.error).title}>
          {describeError(movements.error).message}
        </Alert>
      ) : !movements.data ? (
        <Spinner label="Loading the figures" />
      ) : (
        <>
          <Card
            title="Stock movements"
            flush
            actions={
              <ExportButton
                request={{
                  report: 'stock-movements',
                  from,
                  to,
                  ...(type ? { movementType: type } : {})
                }}
              />
            }
          >
            <DataTable
              caption="Stock movements"
              columns={columns}
              rows={movements.data.items}
              getRowId={(r) =>
                `${r.movementType}-${r.documentNumber}-${r.variantId}-${r.occurredAt}`
              }
              density="compact"
              empty={<EmptyState title="No stock movements in this period" />}
            />
          </Card>
          <Pager page={page} pageSize={PAGE_SIZE} total={movements.data.total} onPage={setPage} />
        </>
      )}
    </div>
  )
}
