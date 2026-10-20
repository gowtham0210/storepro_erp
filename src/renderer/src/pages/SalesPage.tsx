import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Eye,
  Printer,
  ReceiptText,
  Undo2
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type {
  SaleDetail,
  SaleListFilter,
  SaleListItem,
  SaleStatusFilter
} from '@shared/ipc/contract'
import { SALE_STATUS_FILTERS } from '@shared/schemas/sales'
import { formatStoreTime } from '@shared/storeTime'
import { useManagerApproval } from '../auth/ManagerApproval'
import { NewReturnDialog } from '../returns/NewReturnDialog'
import { ReturnDetailDialog, ReturnsListDialog } from '../returns/ReturnViews'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Money,
  PageHeader,
  Quantity,
  Select,
  Spinner,
  TextArea,
  TextInput,
  TotalDisplay,
  useToast,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { refreshSalesAndInventory } from '../sales/BillingDialogs'
import { useStoreTimeZone } from '../store/storeContext'

const PAGE_SIZE = 50

function useSettled<T>(value: T, delayMs = 200): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

/** M11-10, M11-12: Sales history, invoice lookup, bill detail, and sale voiding. */
export default function SalesPage(): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const settledSearch = useSettled(search.trim())
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null)
  const [returnsDialog, setReturnsDialog] = useState<
    | { kind: 'list' }
    | { kind: 'new'; invoiceNumber?: string | undefined }
    | { kind: 'view'; saleReturnId: number; justCreated: boolean }
    | null
  >(null)

  const statusParam = params.get('status')
  const status: SaleStatusFilter = SALE_STATUS_FILTERS.includes(statusParam as SaleStatusFilter)
    ? (statusParam as SaleStatusFilter)
    : 'all'
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

  const filter: SaleListFilter = useMemo(
    () => ({
      ...(params.get('q') ? { search: params.get('q') ?? '' } : {}),
      status,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE
    }),
    [params, status, page]
  )

  const list = useQuery({
    queryKey: ['sales:list', filter],
    queryFn: () => invoke('sales:list', filter),
    placeholderData: keepPreviousData
  })

  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)
  const filtered = Boolean(params.get('q') || status !== 'all')

  const columns: Column<SaleListItem>[] = [
    {
      id: 'invoice',
      header: 'Invoice #',
      cell: (item) => (
        <span className="font-mono font-semibold text-fg">{item.invoiceNumber}</span>
      )
    },
    {
      id: 'completedAt',
      header: 'Date & time',
      cell: (item) => (
        <span className="text-fg-muted">{formatStoreTime(item.completedAt, timeZone)}</span>
      )
    },
    {
      id: 'cashier',
      header: 'Cashier',
      cell: (item) => item.cashierName
    },
    {
      id: 'items',
      header: 'Items',
      align: 'right',
      cell: (item) => item.lineCount
    },
    {
      id: 'payments',
      header: 'Paid via',
      cell: (item) => <span className="text-fg-muted">{item.paymentSummary}</span>
    },
    {
      id: 'status',
      header: 'Status',
      cell: (item) =>
        item.isVoided ? (
          <Badge tone="danger">Voided</Badge>
        ) : (
          <Badge tone="success">Completed</Badge>
        )
    },
    {
      id: 'total',
      header: 'Total',
      align: 'right',
      cell: (item) => (
        <span className={item.isVoided ? 'line-through text-fg-muted' : 'font-semibold text-fg'}>
          <Money minor={item.grandTotalMinor} />
        </span>
      )
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (item) => (
        <Button
          size="sm"
          icon={<Eye />}
          aria-label={`View invoice ${item.invoiceNumber}`}
          onClick={() => setSelectedSaleId(item.saleId)}
        >
          View
        </Button>
      )
    }
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales"
        description="Search past invoices, inspect bill details and payment records, take returns, or void a sale."
        actions={
          <Button icon={<Undo2 />} onClick={() => setReturnsDialog({ kind: 'list' })}>
            Returns
          </Button>
        }
      />

      {list.isError && <Alert tone="danger">{describeError(list.error).message}</Alert>}

      <section
        role="search"
        aria-label="Filter sales"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="min-w-64 flex-1">
          <Field label="Search">
            <TextInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Invoice number, customer or cashier…"
            />
          </Field>
        </div>

        <div className="w-48">
          <Field label="Status">
            <Select
              value={status}
              onChange={(event) =>
                setParam('status', event.target.value === 'all' ? '' : event.target.value)
              }
              options={[
                { value: 'all', label: 'All bills' },
                { value: 'completed', label: 'Completed' },
                { value: 'voided', label: 'Voided' }
              ]}
            />
          </Field>
        </div>

        <Button
          disabled={!filtered && search === ''}
          onClick={() => {
            setSearch('')
            setParams(new URLSearchParams(), { replace: true })
          }}
        >
          Clear filters
        </Button>
      </section>

      <DataTable
        caption="Past sales invoices"
        columns={columns}
        rows={items}
        getRowId={(item) => item.saleId}
        onRowActivate={(item) => setSelectedSaleId(item.saleId)}
        loading={list.isLoading}
        empty={
          <EmptyState
            icon={<ReceiptText />}
            title={filtered ? 'No sales match these filters' : 'No sales recorded yet'}
            description={
              filtered
                ? 'Try clearing the search or status filter.'
                : 'Completed bills from the Billing screen appear here.'
            }
          />
        }
      />

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-fg-muted">
          <span>
            Showing {first}–{last} of {total} {total === 1 ? 'bill' : 'bills'}.
          </span>
          {total > PAGE_SIZE && (
            <div className="flex gap-2">
              <Button
                size="sm"
                icon={<ChevronLeft />}
                disabled={page === 0}
                onClick={() => setParam('page', page > 1 ? String(page - 1) : '')}
              >
                Previous
              </Button>
              <Button
                size="sm"
                icon={<ChevronRight />}
                disabled={last >= total}
                onClick={() => setParam('page', String(page + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {selectedSaleId !== null && (
        <SaleDetailDialog
          saleId={selectedSaleId}
          onClose={() => setSelectedSaleId(null)}
          onReturn={(invoiceNumber) => {
            setSelectedSaleId(null)
            setReturnsDialog({ kind: 'new', invoiceNumber })
          }}
        />
      )}

      {returnsDialog?.kind === 'list' && (
        <ReturnsListDialog
          onClose={() => setReturnsDialog(null)}
          onNew={() => setReturnsDialog({ kind: 'new' })}
          onOpen={(saleReturnId) =>
            setReturnsDialog({ kind: 'view', saleReturnId, justCreated: false })
          }
        />
      )}
      {returnsDialog?.kind === 'new' && (
        <NewReturnDialog
          initialInvoiceNumber={returnsDialog.invoiceNumber}
          onClose={() => setReturnsDialog(null)}
          onDone={(made) =>
            setReturnsDialog({ kind: 'view', saleReturnId: made.saleReturnId, justCreated: true })
          }
        />
      )}
      {returnsDialog?.kind === 'view' && (
        <ReturnDetailDialog
          saleReturnId={returnsDialog.saleReturnId}
          justCreated={returnsDialog.justCreated}
          onClose={() => setReturnsDialog(null)}
        />
      )}
    </div>
  )
}

function SaleDetailDialog({
  saleId,
  onClose,
  onReturn
}: {
  saleId: number
  onClose: () => void
  onReturn: (invoiceNumber: string) => void
}): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const toast = useToast()
  const withApproval = useManagerApproval()
  const [voiding, setVoiding] = useState(false)
  const [reprinting, setReprinting] = useState(false)
  const [reprintError, setReprintError] = useState<string | null>(null)
  const [showReprintPreview, setShowReprintPreview] = useState(false)

  const detail = useQuery({
    queryKey: ['sales:get', saleId],
    queryFn: () => invoke('sales:get', { saleId })
  })

  const reprintPreview = useQuery({
    queryKey: ['receipts:preview', saleId, true],
    queryFn: () => invoke('receipts:preview', { saleId, isReprint: true }),
    enabled: showReprintPreview
  })

  const sale = detail.data

  const handleReprint = async (): Promise<void> => {
    if (!sale) return
    setReprintError(null)
    setReprinting(true)
    try {
      const result = await withApproval((overrideId) =>
        invoke('receipts:print', {
          saleId: sale.saleId,
          isReprint: true,
          ...(overrideId === undefined ? {} : { overrideId })
        })
      )
      if (!result) return
      setShowReprintPreview(true)
      toast.success(`Reprinted invoice ${sale.invoiceNumber} (Duplicate).`)
    } catch (failure) {
      setReprintError(describeError(failure).message)
    } finally {
      setReprinting(false)
    }
  }

  if (detail.isLoading || !sale) {
    return (
      <Dialog open onClose={onClose} size="lg" title="Invoice details">
        <div className="py-10">
          {detail.isError ? (
            <Alert tone="danger">{describeError(detail.error).message}</Alert>
          ) : (
            <Spinner label="Loading invoice" />
          )}
        </div>
      </Dialog>
    )
  }

  return (
    <>
      <Dialog
        open={!voiding}
        onClose={onClose}
        size="lg"
        title={`Invoice ${sale.invoiceNumber}`}
        description={`Completed ${formatStoreTime(sale.completedAt, timeZone)} by ${sale.cashierName}`}
      >
        <div className="space-y-4">
          {sale.voidInfo && (
            <Alert tone="danger" title="This sale was voided">
              Voided by {sale.voidInfo.voidedByName}
              {sale.voidInfo.approvedByName
                ? ` (approved by ${sale.voidInfo.approvedByName})`
                : ''}{' '}
              on {formatStoreTime(sale.voidInfo.voidedAt, timeZone)} — Reason:{' '}
              {sale.voidInfo.reason}
            </Alert>
          )}

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-border bg-surface-subtle font-medium text-fg-muted">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Discount</th>
                  <th className="px-3 py-2 text-right">Tax</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sale.lines.map((line) => (
                  <tr key={line.saleItemId}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-fg">{line.description}</div>
                      <div className="text-xs text-fg-muted">
                        SKU: {line.sku}
                        {line.hsnCode ? ` · HSN: ${line.hsnCode}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Quantity milli={line.quantityMilli} unit={line.unitCode} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Money minor={line.unitPriceMinor} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {line.discountMinor > 0 ? (
                        <Money minor={line.discountMinor} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Money minor={line.taxMinor} />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      <Money minor={line.totalMinor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TotalDisplay
            label={sale.voidInfo ? 'Voided total' : 'Invoice total'}
            minor={sale.grandTotalMinor}
            breakdown={[
              { label: 'Gross amount', minor: sale.grossMinor },
              ...(sale.discountMinor > 0
                ? [{ label: 'Discount', minor: -sale.discountMinor }]
                : []),
              ...sale.taxSummary.map((t) => ({
                label: `${t.code} ${(t.rateBp / 100).toFixed(t.rateBp % 100 === 0 ? 0 : 2)}%`,
                minor: t.amountMinor
              })),
              ...(sale.roundOffMinor !== 0
                ? [{ label: 'Round off', minor: sale.roundOffMinor }]
                : [])
            ]}
          />

          <div className="rounded-md border border-border p-3 text-sm space-y-1.5">
            <div className="font-semibold text-fg">Payments</div>
            {sale.payments.map((payment) => (
              <div key={payment.salePaymentId} className="flex justify-between">
                <span className="text-fg-muted">
                  {payment.methodName}
                  {payment.reference ? ` · Ref: ${payment.reference}` : ''}
                  {payment.verificationNotice ? ` (${payment.verificationNotice})` : ''}
                  {payment.changeMinor > 0 ? (
                    <>
                      {' '}
                      · Tendered <Money minor={payment.tenderedMinor ?? payment.amountMinor} />,
                      Change <Money minor={payment.changeMinor} />
                    </>
                  ) : null}
                </span>
                <span className="font-medium text-fg">
                  <Money minor={payment.amountMinor} />
                </span>
              </div>
            ))}
          </div>

          {sale.refunds.length > 0 && (
            <div className="rounded-md border border-border p-3 text-sm space-y-1.5">
              <div className="font-semibold text-fg">Refunds</div>
              {sale.refunds.map((refund) => (
                <div key={refund.returnRefundId} className="flex justify-between">
                  <span className="text-fg-muted">
                    {refund.returnNumber} · {refund.methodName}
                    {refund.reference ? ` (${refund.reference})` : ''}
                  </span>
                  <span className="font-medium text-fg">
                    <Money minor={refund.amountMinor} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {reprintError && <Alert tone="danger">{reprintError}</Alert>}

          {showReprintPreview && reprintPreview.data && (
            <div className="rounded-md border border-border bg-surface-subtle p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-fg">
                <span>Duplicate / Reprint receipt ({reprintPreview.data.paperWidthMm} mm)</span>
                <Badge tone="warning">DUPLICATE / REPRINT</Badge>
              </div>
              <pre
                aria-label="Duplicate receipt preview"
                className="max-h-56 overflow-y-auto rounded bg-surface p-2 font-mono text-xs leading-snug text-fg"
              >
                {reprintPreview.data.lines.join('\n')}
              </pre>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<Printer />}
                loading={reprinting}
                onClick={() => void handleReprint()}
              >
                Reprint receipt
              </Button>
              {!sale.voidInfo && (
                <Button icon={<Undo2 />} onClick={() => onReturn(sale.invoiceNumber)}>
                  Return items
                </Button>
              )}
              {!sale.voidInfo && sale.refunds.length === 0 && (
                <Button
                  variant="danger"
                  icon={<Ban />}
                  onClick={() => setVoiding(true)}
                >
                  Void sale
                </Button>
              )}
            </div>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </Dialog>

      {voiding && (
        <VoidSaleDialog
          sale={sale}
          onVoided={() => {
            setVoiding(false)
          }}
          onCancel={() => setVoiding(false)}
        />
      )}
    </>
  )
}

function VoidSaleDialog({
  sale,
  onVoided,
  onCancel
}: {
  sale: SaleDetail
  onVoided: (updated: SaleDetail) => void
  onCancel: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const withApproval = useManagerApproval()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('Enter a reason for voiding this invoice')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const updated = await withApproval((overrideId) =>
        invoke('sales:void', {
          saleId: sale.saleId,
          reason: trimmed,
          ...(overrideId === undefined ? {} : { overrideId })
        })
      )
      if (!updated) return
      await Promise.all([
        refreshSalesAndInventory(queryClient),
        queryClient.invalidateQueries({ queryKey: ['sales:get', sale.saleId] })
      ])
      toast.success(`Voided invoice ${sale.invoiceNumber}.`)
      onVoided(updated)
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={`Void invoice ${sale.invoiceNumber}`}
      description="Voiding reverses the stock movement and marks the invoice as voided. The invoice record is kept for audit."
    >
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field
          label="Reason for voiding"
          hint="Recorded permanently in the audit log and on the voided invoice."
        >
          <TextArea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Entered wrong item / duplicate bill"
            rows={3}
            maxLength={200}
            autoFocus
          />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="danger" icon={<Ban />} loading={submitting}>
            Confirm void
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
