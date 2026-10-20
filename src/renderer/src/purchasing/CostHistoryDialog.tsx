import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { CostHistoryEntry } from '@shared/ipc/contract'
import { formatStoreTime } from '@shared/storeTime'
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Money,
  Quantity,
  Spinner,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useStoreTimeZone } from '../store/storeContext'
import { ItemPicker } from './LineEditor'

/** M15-05: what an item has cost on each posted goods receipt, newest first. */
export function CostHistoryDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const [variantId, setVariantId] = useState<number | null>(null)
  const history = useQuery({
    queryKey: ['purchases:cost-history', { variantId }],
    queryFn: () => invoke('purchases:cost-history', { variantId: variantId as number }),
    enabled: variantId !== null
  })

  const columns: Column<CostHistoryEntry>[] = [
    {
      id: 'date',
      header: 'Received',
      cell: (e) => formatStoreTime(e.postedAt, timeZone)
    },
    {
      id: 'receipt',
      header: 'Receipt',
      cell: (e) => <span className="font-mono">{e.receiptNumber}</span>
    },
    { id: 'supplier', header: 'Supplier', cell: (e) => e.supplierName },
    {
      id: 'qty',
      header: 'Quantity',
      align: 'right',
      cell: (e) => <Quantity milli={e.quantityMilli} unit={history.data?.unitCode ?? ''} />
    },
    {
      id: 'cost',
      header: 'Cost each',
      align: 'right',
      cell: (e) => <Money minor={e.unitCostMinor} className="font-medium" />
    }
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Purchase cost history"
      description="Find an item to see what you paid for it each time it arrived."
      footer={<Button onClick={onClose}>Close window</Button>}
    >
      <div className="space-y-5">
        <ItemPicker
          label="Item"
          excluded={new Set<number>()}
          onPick={(item) => setVariantId(item.variantId)}
        />
        {variantId !== null &&
          (history.error ? (
            <Alert tone="danger">{describeError(history.error).message}</Alert>
          ) : !history.data ? (
            <Spinner label="Loading" />
          ) : (
            <>
              <p>
                <span className="font-medium">{history.data.name}</span>
                <span className="text-fg-muted"> · {history.data.sku} · cost price today </span>
                {history.data.currentCostMinor === null ? (
                  <span className="text-fg-muted">not set</span>
                ) : (
                  <Money minor={history.data.currentCostMinor} className="font-medium" />
                )}
              </p>
              <DataTable
                caption={`Purchase cost history for ${history.data.name}`}
                columns={columns}
                rows={history.data.entries}
                getRowId={(e) => `${e.goodsReceiptId}`}
                density="compact"
                empty={
                  <EmptyState
                    title="Not bought yet"
                    description="Posted goods receipts for this item will appear here."
                  />
                }
              />
            </>
          ))}
      </div>
    </Dialog>
  )
}
