import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, PackageOpen, Plus, Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReturnDetail, ReturnLineDetail, ReturnListItem } from '@shared/ipc/contract'
import { RETURN_DISPOSITION_LABELS } from '@shared/returns'
import { formatStoreTime } from '@shared/storeTime'
import { useManagerApproval } from '../auth/ManagerApproval'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Money,
  Quantity,
  Spinner,
  TextInput,
  useToast,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useSettled } from '../lib/useSettled'
import { useStoreTimeZone } from '../store/storeContext'

const PAGE_SIZE = 25

/** M16-05: past returns, searchable by return number, invoice number or customer. */
export function ReturnsListDialog({
  onClose,
  onNew,
  onOpen
}: {
  onClose: () => void
  onNew: () => void
  onOpen: (saleReturnId: number) => void
}): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const [text, setText] = useState('')
  const search = useSettled(text.trim())
  const [page, setPage] = useState(0)
  const filter = { ...(search ? { search } : {}), offset: page * PAGE_SIZE, limit: PAGE_SIZE }
  const list = useQuery({
    queryKey: ['returns:list', filter],
    queryFn: () => invoke('returns:list', filter),
    placeholderData: keepPreviousData
  })
  const total = list.data?.total ?? 0
  const last = Math.min(total, (page + 1) * PAGE_SIZE)

  const columns: Column<ReturnListItem>[] = [
    {
      id: 'number',
      header: 'Return #',
      cell: (r) => <span className="font-mono font-semibold">{r.returnNumber}</span>
    },
    {
      id: 'invoice',
      header: 'Invoice',
      cell: (r) => <span className="font-mono">{r.invoiceNumber}</span>
    },
    {
      id: 'date',
      header: 'Date',
      cell: (r) => <span className="text-fg-muted">{formatStoreTime(r.returnedAt, timeZone)}</span>
    },
    {
      id: 'customer',
      header: 'Customer',
      cell: (r) => r.customerName ?? <span className="text-fg-muted">Walk-in</span>
    },
    { id: 'items', header: 'Lines', align: 'right', cell: (r) => r.itemCount },
    {
      id: 'refund',
      header: 'Refunded',
      align: 'right',
      cell: (r) => <Money minor={r.refundDueMinor} className="font-medium" />
    }
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Returns"
      description="Goods customers have brought back, and what was refunded."
      footer={
        <>
          <Button onClick={onClose}>Close window</Button>
          <Button variant="primary" icon={<Plus />} onClick={onNew}>
            Take a return
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Search" hint="Return number, invoice number or customer">
          <TextInput
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setPage(0)
            }}
          />
        </Field>
        {list.error ? (
          <Alert tone="danger">{describeError(list.error).message}</Alert>
        ) : (
          <DataTable
            caption="Returns"
            columns={columns}
            rows={list.data?.items ?? []}
            getRowId={(r) => r.saleReturnId}
            loading={list.isPending}
            density="compact"
            onRowActivate={(r) => onOpen(r.saleReturnId)}
            empty={
              <EmptyState
                icon={<PackageOpen />}
                title={search ? 'No returns match' : 'No returns yet'}
                description={
                  search ? 'Try another number or name.' : 'Returns you take will be listed here.'
                }
              />
            }
          />
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-fg-muted" role="status">
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
    </Dialog>
  )
}

/**
 * M16-05: one return, with its receipt. Right after a return is taken the
 * receipt prints as the original; after that, printing it again makes a
 * duplicate, which needs a manager's approval for a cashier.
 */
export function ReturnDetailDialog({
  saleReturnId,
  justCreated = false,
  onClose
}: {
  saleReturnId: number
  /** True straight after the return was recorded, when the receipt hasn't been printed yet. */
  justCreated?: boolean
  onClose: () => void
}): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const toast = useToast()
  const withApproval = useManagerApproval()
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)
  const [printedOriginal, setPrintedOriginal] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const detail = useQuery({
    queryKey: ['returns:get', { saleReturnId }],
    queryFn: () => invoke('returns:get', { saleReturnId })
  })
  const config = useQuery({
    queryKey: ['printers:get-config'],
    queryFn: () => invoke('printers:get-config')
  })
  const ret: ReturnDetail | undefined = detail.data
  // The first print of a new return is the original; every later one is a duplicate.
  const asReprint = !(justCreated && !printedOriginal)

  const preview = useQuery({
    queryKey: ['returns:preview-receipt', { saleReturnId, asReprint }],
    queryFn: () => invoke('returns:preview-receipt', { saleReturnId, isReprint: asReprint }),
    enabled: showPreview
  })

  const print = async (): Promise<void> => {
    if (!ret) return
    setPrintError(null)
    setPrinting(true)
    try {
      const result = await withApproval((overrideId) =>
        invoke('returns:print-receipt', {
          saleReturnId,
          isReprint: asReprint,
          ...(overrideId === undefined ? {} : { overrideId })
        })
      )
      if (!result) return
      if (!asReprint) setPrintedOriginal(true)
      setShowPreview(true)
      toast.success(
        asReprint ? `Reprinted ${ret.returnNumber} (Duplicate).` : `Printed ${ret.returnNumber}.`
      )
    } catch (failure) {
      setPrintError(
        `The return is saved, but the receipt did not print. ${describeError(failure).message}`
      )
    } finally {
      setPrinting(false)
    }
  }

  // Print straight away when the store has asked for receipts to print by themselves.
  const autoPrinted = useRef(false)
  useEffect(() => {
    if (justCreated && ret && config.data?.autoPrintReceipt && !autoPrinted.current) {
      autoPrinted.current = true
      void print()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when both have loaded
  }, [justCreated, ret, config.data?.autoPrintReceipt])

  const columns: Column<ReturnLineDetail>[] = [
    {
      id: 'item',
      header: 'Item',
      cell: (l) => (
        <div>
          <span className="font-medium">{l.description}</span>
          <div className="text-sm text-fg-muted">{l.sku}</div>
        </div>
      )
    },
    {
      id: 'qty',
      header: 'Returned',
      align: 'right',
      cell: (l) => <Quantity milli={l.quantityMilli} unit={l.unitCode} />
    },
    {
      id: 'goods',
      header: 'The goods',
      cell: (l) => (
        <Badge tone={l.disposition === 'restock' ? 'success' : 'warning'}>
          {RETURN_DISPOSITION_LABELS[l.disposition]}
        </Badge>
      )
    },
    { id: 'credit', header: 'Credit', align: 'right', cell: (l) => <Money minor={l.creditMinor} /> }
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={ret ? `Return ${ret.returnNumber}` : 'Return'}
      description={
        ret
          ? `Against invoice ${ret.invoiceNumber}, ${formatStoreTime(ret.returnedAt, timeZone)} by ${ret.processedByName}`
          : undefined
      }
      footer={
        <>
          <Button onClick={onClose}>{justCreated ? 'Done' : 'Close window'}</Button>
          {ret && (
            <Button
              variant={justCreated && !printedOriginal ? 'primary' : 'secondary'}
              icon={<Printer />}
              loading={printing}
              onClick={() => void print()}
            >
              {asReprint ? 'Reprint receipt' : 'Print receipt'}
            </Button>
          )}
        </>
      }
    >
      {detail.error ? (
        <Alert tone="danger">{describeError(detail.error).message}</Alert>
      ) : !ret ? (
        <Spinner label="Loading" />
      ) : (
        <div className="space-y-4">
          {justCreated && (
            <Alert tone="success" title="Return recorded">
              Give the customer {ret.refunds.map((r) => r.methodName).join(' and ')} refund of{' '}
              <Money minor={ret.refundDueMinor} className="font-semibold" />.
            </Alert>
          )}
          {printError && <Alert tone="danger">{printError}</Alert>}
          <DataTable
            caption={`Items on return ${ret.returnNumber}`}
            columns={columns}
            rows={ret.lines}
            getRowId={(l) => l.saleReturnItemId}
            density="compact"
          />
          <dl className="ml-auto max-w-xs space-y-1 text-right">
            <div className="flex justify-between gap-4">
              <dt className="text-fg-muted">
                {ret.pricesIncludeTax ? 'Goods value (incl. tax)' : 'Goods value'}
              </dt>
              <dd>
                <Money minor={ret.creditMinor} />
              </dd>
            </div>
            {!ret.pricesIncludeTax && ret.taxMinor > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Tax</dt>
                <dd>
                  <Money minor={ret.taxMinor} />
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4 text-lg font-semibold">
              <dt>Refunded</dt>
              <dd>
                <Money minor={ret.refundedMinor} />
              </dd>
            </div>
          </dl>
          <ul className="space-y-1 text-sm">
            {ret.refunds.map((r) => (
              <li key={r.returnRefundId} className="flex justify-between gap-3">
                <span>
                  {r.methodName}
                  {r.reference ? ` · ${r.reference}` : ''}
                  {r.kind === 'upi' ? ' · recorded, not verified' : ''}
                </span>
                <Money minor={r.amountMinor} />
              </li>
            ))}
          </ul>
          {ret.reason && (
            <p className="text-sm">
              <span className="text-fg-muted">Reason: </span>
              {ret.reason}
            </p>
          )}

          <div>
            <Button size="sm" variant="ghost" onClick={() => setShowPreview((shown) => !shown)}>
              {showPreview ? 'Hide receipt' : 'Show receipt'}
            </Button>
            {showPreview &&
              (preview.data ? (
                <pre
                  aria-label="Return receipt preview"
                  className="mt-2 max-h-72 overflow-auto rounded bg-surface-muted p-3 font-mono text-xs leading-snug"
                >
                  {preview.data.lines.join('\n')}
                </pre>
              ) : preview.error ? (
                <Alert tone="danger">{describeError(preview.error).message}</Alert>
              ) : (
                <Spinner label="Loading receipt" />
              ))}
          </div>
        </div>
      )}
    </Dialog>
  )
}
