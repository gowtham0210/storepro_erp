import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react'
import { useState } from 'react'
import type { CustomerPurchase } from '@shared/ipc/contract'
import { formatStoreTime } from '@shared/storeTime'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Money,
  Spinner,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useStoreTimeZone } from '../store/storeContext'

const PAGE_SIZE = 25

/** M17-03: a customer's invoices, newest first, with what they have spent. */
export function CustomerHistoryDialog({
  customerId,
  onClose
}: {
  customerId: number
  onClose: () => void
}): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const [page, setPage] = useState(0)
  const history = useQuery({
    queryKey: ['customers:purchases', { customerId, page }],
    queryFn: () =>
      invoke('customers:purchases', { customerId, offset: page * PAGE_SIZE, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData
  })
  const data = history.data
  const total = data?.total ?? 0
  const last = Math.min(total, (page + 1) * PAGE_SIZE)

  const columns: Column<CustomerPurchase>[] = [
    {
      id: 'invoice',
      header: 'Invoice',
      cell: (p) => (
        <span>
          <span className="font-mono font-semibold">{p.invoiceNumber}</span>{' '}
          {p.isVoided && <Badge tone="danger">Voided</Badge>}
        </span>
      )
    },
    {
      id: 'date',
      header: 'Date',
      cell: (p) => <span className="text-fg-muted">{formatStoreTime(p.completedAt, timeZone)}</span>
    },
    { id: 'items', header: 'Items', align: 'right', cell: (p) => p.lineCount },
    {
      id: 'total',
      header: 'Total',
      align: 'right',
      cell: (p) => (
        <Money
          minor={p.grandTotalMinor}
          className={p.isVoided ? 'text-fg-muted line-through' : ''}
        />
      )
    },
    {
      id: 'returned',
      header: 'Refunded',
      align: 'right',
      cell: (p) =>
        p.returnedMinor > 0 ? (
          <Money minor={p.returnedMinor} />
        ) : (
          <span className="text-fg-muted">–</span>
        )
    }
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={data ? `${data.customerName}: purchases` : 'Purchases'}
      footer={<Button onClick={onClose}>Close window</Button>}
    >
      {history.error ? (
        <Alert tone="danger">{describeError(history.error).message}</Alert>
      ) : !data ? (
        <Spinner label="Loading" />
      ) : (
        <div className="space-y-4">
          <p className="text-lg" role="status">
            Spent <Money minor={data.totalSpentMinor} className="font-semibold" />
            <span className="text-base text-fg-muted">
              {' '}
              over {total} {total === 1 ? 'invoice' : 'invoices'}, after refunds and without voided
              ones
            </span>
          </p>
          <DataTable
            caption={`Invoices for ${data.customerName}`}
            columns={columns}
            rows={data.items}
            getRowId={(p) => p.saleId}
            density="compact"
            empty={
              <EmptyState
                icon={<ReceiptText />}
                title="No purchases yet"
                description="Invoices billed to this customer will appear here."
              />
            }
          />
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-fg-muted">
                Showing {page * PAGE_SIZE + 1}–{last} of {total}
              </p>
              <span className="flex gap-2">
                <Button
                  icon={<ChevronLeft />}
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  icon={<ChevronRight />}
                  disabled={last >= total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </span>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
