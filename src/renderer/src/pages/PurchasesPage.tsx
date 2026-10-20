import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Boxes, ChevronLeft, ChevronRight, History, PackageCheck, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type {
  GoodsReceiptDetail,
  GoodsReceiptListItem,
  GoodsReceiptStatusFilter,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  PurchaseOrderStatusFilter
} from '@shared/ipc/contract'
import {
  GOODS_RECEIPT_STATUS_FILTERS,
  PURCHASE_ORDER_STATUS_FILTERS
} from '@shared/schemas/purchasing'
import { formatStoreTime } from '@shared/storeTime'
import { useCan } from '../auth/permissions'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Money,
  PageHeader,
  Select,
  TextInput,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useSettled } from '../lib/useSettled'
import { CostHistoryDialog } from '../purchasing/CostHistoryDialog'
import { PurchaseOrderDetailDialog, PurchaseOrderDialog } from '../purchasing/OrderDialogs'
import { GoodsReceiptDetailDialog, GoodsReceiptDialog } from '../purchasing/ReceiptDialogs'
import { ORDER_STATUS, RECEIPT_STATUS } from '../purchasing/status'
import { useStoreTimeZone } from '../store/storeContext'

const PAGE_SIZE = 50

type Tab = 'orders' | 'receipts'

type DialogState =
  | { kind: 'order-edit'; order?: PurchaseOrderDetail | undefined }
  | { kind: 'order-view'; purchaseOrderId: number }
  | {
      kind: 'receipt-edit'
      receipt?: GoodsReceiptDetail | undefined
      order?: PurchaseOrderDetail | undefined
    }
  | { kind: 'receipt-view'; goodsReceiptId: number }
  | { kind: 'cost-history' }
  | null

/** M15-02 to M15-06: purchase orders, goods received, and what items cost. */
export default function PurchasesPage(): React.JSX.Element {
  const canManage = useCan()('purchase.manage')
  const timeZone = useStoreTimeZone()
  const [params, setParams] = useSearchParams()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const settledSearch = useSettled(search.trim())
  const suppliers = useQuery({
    queryKey: ['suppliers:list', 'all-for-filter'],
    queryFn: () => invoke('suppliers:list', { status: 'all', limit: 200 })
  })

  const tab: Tab = params.get('tab') === 'receipts' ? 'receipts' : 'orders'
  const page = Math.max(0, Number(params.get('page')) || 0)
  const supplierId = Number(params.get('supplier')) || undefined
  const statusParam = params.get('status') ?? 'all'

  const setParam = (name: string, value: string): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(name, value)
        else next.delete(name)
        if (name !== 'page') next.delete('page')
        if (name === 'tab') next.delete('status')
        return next
      },
      { replace: true }
    )
  }

  useEffect(() => {
    if (settledSearch !== (params.get('q') ?? '')) setParam('q', settledSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the search settles
  }, [settledSearch])

  const common = {
    ...(params.get('q') ? { search: params.get('q') ?? '' } : {}),
    ...(supplierId === undefined ? {} : { supplierId }),
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE
  }
  const orderStatus: PurchaseOrderStatusFilter = PURCHASE_ORDER_STATUS_FILTERS.includes(
    statusParam as PurchaseOrderStatusFilter
  )
    ? (statusParam as PurchaseOrderStatusFilter)
    : 'all'
  const receiptStatus: GoodsReceiptStatusFilter = GOODS_RECEIPT_STATUS_FILTERS.includes(
    statusParam as GoodsReceiptStatusFilter
  )
    ? (statusParam as GoodsReceiptStatusFilter)
    : 'all'

  const orderFilter = useMemo(
    () => ({ ...common, status: orderStatus }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `common` is rebuilt from these
    [params, orderStatus, page]
  )
  const receiptFilter = useMemo(
    () => ({ ...common, status: receiptStatus }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `common` is rebuilt from these
    [params, receiptStatus, page]
  )

  const orders = useQuery({
    queryKey: ['purchases:list-orders', orderFilter],
    queryFn: () => invoke('purchases:list-orders', orderFilter),
    placeholderData: keepPreviousData,
    enabled: tab === 'orders'
  })
  const receipts = useQuery({
    queryKey: ['purchases:list-receipts', receiptFilter],
    queryFn: () => invoke('purchases:list-receipts', receiptFilter),
    placeholderData: keepPreviousData,
    enabled: tab === 'receipts'
  })

  const active = tab === 'orders' ? orders : receipts
  const total = active.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)
  const filtered = Boolean(params.get('q') || supplierId !== undefined || statusParam !== 'all')

  const orderColumns: Column<PurchaseOrderListItem>[] = [
    {
      id: 'number',
      header: 'Order #',
      cell: (o) => <span className="font-mono font-semibold">{o.orderNumber}</span>
    },
    { id: 'supplier', header: 'Supplier', cell: (o) => o.supplierName },
    {
      id: 'date',
      header: 'Written',
      cell: (o) => <span className="text-fg-muted">{formatStoreTime(o.createdAt, timeZone)}</span>
    },
    { id: 'items', header: 'Items', align: 'right', cell: (o) => o.lineCount },
    { id: 'total', header: 'Total', align: 'right', cell: (o) => <Money minor={o.totalMinor} /> },
    {
      id: 'status',
      header: 'Status',
      cell: (o) => <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
    }
  ]

  const receiptColumns: Column<GoodsReceiptListItem>[] = [
    {
      id: 'number',
      header: 'Receipt #',
      cell: (r) => <span className="font-mono font-semibold">{r.receiptNumber}</span>
    },
    { id: 'supplier', header: 'Supplier', cell: (r) => r.supplierName },
    {
      id: 'order',
      header: 'Order',
      cell: (r) =>
        r.orderNumber ? (
          <span className="font-mono">{r.orderNumber}</span>
        ) : (
          <span className="text-fg-muted">Direct</span>
        )
    },
    {
      id: 'bill',
      header: 'Supplier bill',
      cell: (r) => r.supplierInvoiceNumber ?? <span className="text-fg-muted">–</span>
    },
    {
      id: 'date',
      header: 'Date',
      cell: (r) => <span className="text-fg-muted">{formatStoreTime(r.occurredAt, timeZone)}</span>
    },
    { id: 'items', header: 'Items', align: 'right', cell: (r) => r.lineCount },
    { id: 'total', header: 'Total', align: 'right', cell: (r) => <Money minor={r.totalMinor} /> },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge tone={RECEIPT_STATUS[r.status].tone}>{RECEIPT_STATUS[r.status].label}</Badge>
      )
    }
  ]

  const table = (): React.JSX.Element => {
    const empty = (
      <EmptyState
        icon={<Boxes />}
        title={
          filtered
            ? 'Nothing matches'
            : tab === 'orders'
              ? 'No purchase orders yet'
              : 'No goods received yet'
        }
        description={
          filtered
            ? 'Try other words, or clear the filters.'
            : tab === 'orders'
              ? 'Write an order to a supplier to start.'
              : 'Record goods as they arrive to add them to stock.'
        }
      />
    )
    return tab === 'orders' ? (
      <DataTable
        caption="Purchase orders"
        columns={orderColumns}
        rows={orders.data?.items ?? []}
        getRowId={(o) => o.purchaseOrderId}
        loading={orders.isPending}
        onRowActivate={(o) => setDialog({ kind: 'order-view', purchaseOrderId: o.purchaseOrderId })}
        empty={empty}
      />
    ) : (
      <DataTable
        caption="Goods received"
        columns={receiptColumns}
        rows={receipts.data?.items ?? []}
        getRowId={(r) => r.goodsReceiptId}
        loading={receipts.isPending}
        onRowActivate={(r) => setDialog({ kind: 'receipt-view', goodsReceiptId: r.goodsReceiptId })}
        empty={empty}
      />
    )
  }

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Orders to suppliers, goods as they arrive, and what you paid."
        actions={
          <>
            <Button icon={<History />} onClick={() => setDialog({ kind: 'cost-history' })}>
              Cost history
            </Button>
            {canManage && (
              <>
                <Button icon={<PackageCheck />} onClick={() => setDialog({ kind: 'receipt-edit' })}>
                  Receive without order
                </Button>
                <Button
                  variant="primary"
                  icon={<Plus />}
                  onClick={() => setDialog({ kind: 'order-edit' })}
                >
                  New purchase order
                </Button>
              </>
            )}
          </>
        }
      />

      <div role="tablist" aria-label="Purchase documents" className="mb-4 flex gap-2">
        {(
          [
            ['orders', 'Purchase orders'],
            ['receipts', 'Goods received']
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => setParam('tab', id === 'orders' ? '' : id)}
          >
            {label}
          </Button>
        ))}
      </div>

      <form
        role="search"
        aria-label="Find purchases"
        onSubmit={(event) => event.preventDefault()}
        className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_1fr]"
      >
        <Field
          label="Search"
          hint={tab === 'orders' ? 'Order number or supplier' : 'Receipt, order, bill or supplier'}
        >
          <TextInput
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label="Supplier">
          <Select
            value={supplierId === undefined ? '' : String(supplierId)}
            onChange={(event) => setParam('supplier', event.target.value)}
            placeholder="All suppliers"
            options={(suppliers.data?.items ?? []).map((s) => ({
              value: String(s.supplierId),
              label: s.active ? s.name : `${s.name} (archived)`
            }))}
          />
        </Field>
        <Field label="Status">
          <Select
            value={tab === 'orders' ? orderStatus : receiptStatus}
            onChange={(event) =>
              setParam('status', event.target.value === 'all' ? '' : event.target.value)
            }
            options={
              tab === 'orders'
                ? [
                    { value: 'all', label: 'All orders' },
                    { value: 'draft', label: 'Draft' },
                    { value: 'confirmed', label: 'Confirmed' },
                    { value: 'closed', label: 'Closed' },
                    { value: 'cancelled', label: 'Cancelled' }
                  ]
                : [
                    { value: 'all', label: 'All receipts' },
                    { value: 'draft', label: 'Draft' },
                    { value: 'posted', label: 'In stock' }
                  ]
            }
          />
        </Field>
      </form>

      {active.error ? (
        <Alert tone="danger" title={describeError(active.error).title}>
          {describeError(active.error).message}
        </Alert>
      ) : (
        <>
          {table()}
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted" role="status">
              {active.isPending || total === 0 ? '' : `Showing ${first}–${last} of ${total}`}
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

      {dialog?.kind === 'order-edit' && (
        <PurchaseOrderDialog
          order={dialog.order}
          onClose={() => setDialog(null)}
          onSaved={(saved) =>
            setDialog({ kind: 'order-view', purchaseOrderId: saved.purchaseOrderId })
          }
        />
      )}
      {dialog?.kind === 'order-view' && (
        <PurchaseOrderDetailDialog
          purchaseOrderId={dialog.purchaseOrderId}
          onClose={() => setDialog(null)}
          onEdit={(order) => setDialog({ kind: 'order-edit', order })}
          onReceive={(order) => setDialog({ kind: 'receipt-edit', order })}
          onOpenReceipt={(goodsReceiptId) => setDialog({ kind: 'receipt-view', goodsReceiptId })}
        />
      )}
      {dialog?.kind === 'receipt-edit' && (
        <GoodsReceiptDialog
          receipt={dialog.receipt}
          order={dialog.order}
          onClose={() => setDialog(null)}
          onSaved={(saved) =>
            setDialog({ kind: 'receipt-view', goodsReceiptId: saved.goodsReceiptId })
          }
        />
      )}
      {dialog?.kind === 'receipt-view' && (
        <GoodsReceiptDetailDialog
          goodsReceiptId={dialog.goodsReceiptId}
          onClose={() => setDialog(null)}
          onEdit={(receipt) => setDialog({ kind: 'receipt-edit', receipt })}
          onOpenOrder={(purchaseOrderId) => setDialog({ kind: 'order-view', purchaseOrderId })}
        />
      )}
      {dialog?.kind === 'cost-history' && <CostHistoryDialog onClose={() => setDialog(null)} />}
    </>
  )
}
