import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { PurchaseReceiptRow, PurchaseSupplierRow } from '@shared/ipc/contract'
import { formatStoreTime } from '@shared/storeTime'
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  Field,
  Money,
  Select,
  Spinner,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useStoreTimeZone } from '../store/storeContext'
import { ExportButton } from './ExportButton'
import { Pager } from './Pager'
import { Stat } from './Stat'
import type { ReportRangeState } from './useReportRange'

const PAGE_SIZE = 100

/** M19-07: goods received in the period, by supplier and one by one. Drafts aren't purchases yet. */
export function PurchasesTab({ range }: { range: ReportRangeState }): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const [supplier, setSupplier] = useState('')
  const [page, setPage] = useState(0)
  const { from, to } = range
  const suppliers = useQuery({
    queryKey: ['suppliers:list', 'report-filter'],
    queryFn: () => invoke('suppliers:list', { status: 'all', limit: 200 }),
    retry: false
  })
  const filter = {
    from,
    to,
    ...(supplier ? { supplierId: Number(supplier) } : {}),
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE
  }
  const report = useQuery({
    queryKey: ['reports:purchases', filter],
    queryFn: () => invoke('reports:purchases', filter),
    placeholderData: keepPreviousData,
    enabled: range.error === null
  })

  const supplierColumns: Column<PurchaseSupplierRow>[] = [
    { id: 'supplier', header: 'Supplier', cell: (r) => r.supplierName },
    { id: 'receipts', header: 'Receipts', align: 'right', cell: (r) => r.receiptCount },
    {
      id: 'total',
      header: 'Bought for',
      align: 'right',
      cell: (r) => <Money minor={r.totalMinor} className="font-medium" />
    }
  ]
  const receiptColumns: Column<PurchaseReceiptRow>[] = [
    {
      id: 'number',
      header: 'Receipt #',
      cell: (r) => <span className="font-mono font-semibold">{r.receiptNumber}</span>
    },
    {
      id: 'posted',
      header: 'Received',
      cell: (r) => <span className="text-fg-muted">{formatStoreTime(r.postedAt, timeZone)}</span>
    },
    { id: 'supplier', header: 'Supplier', cell: (r) => r.supplierName },
    {
      id: 'order',
      header: 'Order',
      cell: (r) => r.orderNumber ?? <span className="text-fg-muted">Direct</span>
    },
    {
      id: 'bill',
      header: 'Supplier bill',
      cell: (r) => r.supplierInvoiceNumber ?? <span className="text-fg-muted">–</span>
    },
    { id: 'total', header: 'Total', align: 'right', cell: (r) => <Money minor={r.totalMinor} /> }
  ]

  return (
    <div className="space-y-4">
      {!suppliers.error && (
        <Field label="Supplier" className="max-w-xs">
          <Select
            value={supplier}
            onChange={(event) => {
              setSupplier(event.target.value)
              setPage(0)
            }}
            placeholder="All suppliers"
            options={(suppliers.data?.items ?? []).map((s) => ({
              value: String(s.supplierId),
              label: s.active ? s.name : `${s.name} (archived)`
            }))}
          />
        </Field>
      )}
      {range.error ? null : report.error ? (
        <Alert tone="danger" title={describeError(report.error).title}>
          {describeError(report.error).message}
        </Alert>
      ) : !report.data ? (
        <Spinner label="Loading the figures" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Stat
              label="Bought for"
              minor={report.data.totalMinor}
              definition="The cost on goods receipts posted in the period, as paid, before any GST input credit."
            />
            <Stat
              label="Goods receipts"
              value={report.data.receiptCount}
              definition="Posted receipts. Drafts don't count until they are posted."
            />
          </div>
          <Card
            title="By supplier"
            flush
            actions={
              <ExportButton
                request={{
                  report: 'purchases',
                  from,
                  to,
                  ...(supplier ? { supplierId: Number(supplier) } : {})
                }}
              />
            }
          >
            <DataTable
              caption="Purchases by supplier"
              columns={supplierColumns}
              rows={report.data.bySupplier}
              getRowId={(r) => r.supplierId}
              density="compact"
              empty={<EmptyState title="No goods received in this period" />}
            />
          </Card>
          <Card title="Receipts" flush>
            <DataTable
              caption="Goods receipts"
              columns={receiptColumns}
              rows={report.data.receipts}
              getRowId={(r) => r.goodsReceiptId}
              density="compact"
              empty={<EmptyState title="No goods received in this period" />}
            />
          </Card>
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={report.data.receiptCount}
            onPage={setPage}
          />
        </>
      )}
    </div>
  )
}
