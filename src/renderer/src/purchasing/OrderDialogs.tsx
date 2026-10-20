import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCheck, PackageCheck, Pencil, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { PurchaseOrderDetail, PurchaseOrderLineDetail } from '@shared/ipc/contract'
import { formatStoreTime } from '@shared/storeTime'
import { useCan } from '../auth/permissions'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Money,
  Quantity,
  Select,
  Spinner,
  TextInput,
  useConfirm,
  useCurrency,
  useToast,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useStoreTimeZone } from '../store/storeContext'
import {
  draftTotal,
  ItemPicker,
  LineEditor,
  newDraftLine,
  parseLines,
  withServerLineErrors,
  type DraftLine
} from './LineEditor'
import { refreshPurchases } from './refresh'
import { ORDER_STATUS, RECEIPT_STATUS } from './status'

/** M15-02: write a purchase order, or change a draft. Confirming it fixes it as a request to the supplier. */
export function PurchaseOrderDialog({
  order,
  onClose,
  onSaved
}: {
  /** The draft being changed; leave out to start a new order. */
  order?: PurchaseOrderDetail | undefined
  onClose: () => void
  onSaved: (saved: PurchaseOrderDetail) => void
}): React.JSX.Element {
  const { minorUnits } = useCurrency()
  const queryClient = useQueryClient()
  const toast = useToast()
  const suppliers = useQuery({
    queryKey: ['suppliers:list', 'active-for-documents'],
    queryFn: () => invoke('suppliers:list', { status: 'active', limit: 200 })
  })
  const [supplierId, setSupplierId] = useState(order ? String(order.supplierId) : '')
  const [notes, setNotes] = useState(order?.notes ?? '')
  const [lines, setLines] = useState<DraftLine[]>(() =>
    (order?.lines ?? []).map((l) => newDraftLine(l, minorUnits, l.quantityMilli, l.unitCostMinor))
  )
  const [supplierError, setSupplierError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'draft' | 'confirm' | null>(null)

  const save = async (confirm: boolean): Promise<void> => {
    setError(null)
    setSupplierError(null)
    if (!supplierId) {
      setSupplierError('Choose a supplier')
      return
    }
    if (lines.length === 0) {
      setError('Add at least one item.')
      return
    }
    const parsed = parseLines(lines, minorUnits)
    if (!parsed.ok) {
      setLines(parsed.lines)
      return
    }
    setBusy(confirm ? 'confirm' : 'draft')
    try {
      const saved = await invoke('purchases:save-order', {
        ...(order ? { purchaseOrderId: order.purchaseOrderId } : {}),
        supplierId: Number(supplierId),
        notes: notes.trim() === '' ? null : notes.trim(),
        lines: parsed.lines,
        confirm
      })
      toast.success(`Order ${saved.orderNumber} was ${confirm ? 'confirmed' : 'saved as a draft'}.`)
      await refreshPurchases(queryClient)
      onSaved(saved)
    } catch (failure) {
      setLines(withServerLineErrors(lines, failure))
      setError(describeError(failure).message)
    } finally {
      setBusy(null)
    }
  }

  const supplierOptions = (suppliers.data?.items ?? []).map((s) => ({
    value: String(s.supplierId),
    label: s.name
  }))
  const total = draftTotal(lines, minorUnits)

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={order ? `Edit order ${order.orderNumber}` : 'New purchase order'}
      description="What you are asking a supplier to send. A draft can be changed; once confirmed, an order is fixed. Nothing is added to stock until the goods arrive."
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            loading={busy === 'draft'}
            disabled={busy !== null}
            onClick={() => void save(false)}
          >
            Save draft
          </Button>
          <Button
            variant="primary"
            loading={busy === 'confirm'}
            disabled={busy !== null}
            onClick={() => void save(true)}
          >
            Save and confirm
          </Button>
        </>
      }
    >
      {suppliers.error ? (
        <Alert tone="danger">{describeError(suppliers.error).message}</Alert>
      ) : !suppliers.data ? (
        <Spinner label="Loading" />
      ) : (
        <div className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Supplier"
              required
              error={supplierError}
              hint={suppliers.data.items.length === 0 ? 'Add a supplier first.' : undefined}
            >
              <Select
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                placeholder="Choose a supplier…"
                options={supplierOptions}
              />
            </Field>
            <Field label="Note" hint="Optional">
              <TextInput
                value={notes}
                maxLength={300}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </div>
          <ItemPicker
            excluded={new Set(lines.map((l) => l.variantId))}
            onPick={(item) =>
              setLines((current) => [
                ...current,
                newDraftLine(item, minorUnits, undefined, undefined)
              ])
            }
          />
          <LineEditor lines={lines} onChange={setLines} />
          {lines.length > 0 && (
            <p className="text-right text-lg">
              Order total <Money minor={total} className="font-semibold" />
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}

/** M15-06: one order with what has arrived, and the actions its status allows. */
export function PurchaseOrderDetailDialog({
  purchaseOrderId,
  onClose,
  onEdit,
  onReceive,
  onOpenReceipt
}: {
  purchaseOrderId: number
  onClose: () => void
  onEdit: (order: PurchaseOrderDetail) => void
  onReceive: (order: PurchaseOrderDetail) => void
  onOpenReceipt: (goodsReceiptId: number) => void
}): React.JSX.Element {
  const canManage = useCan()('purchase.manage')
  const timeZone = useStoreTimeZone()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const detail = useQuery({
    queryKey: ['purchases:get-order', { purchaseOrderId }],
    queryFn: () => invoke('purchases:get-order', { purchaseOrderId })
  })
  const order = detail.data

  const run = async (action: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      toast.success(done)
      await refreshPurchases(queryClient)
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  const act = {
    confirm: async (o: PurchaseOrderDetail) => {
      if (
        await confirm({
          title: `Confirm order ${o.orderNumber}?`,
          description:
            'A confirmed order is fixed: its items and costs can no longer be changed. You can still receive goods against it, close it or cancel it.',
          confirmLabel: 'Confirm order'
        })
      ) {
        await run(
          () => invoke('purchases:confirm-order', { purchaseOrderId }),
          `Order ${o.orderNumber} was confirmed.`
        )
      }
    },
    close: async (o: PurchaseOrderDetail) => {
      if (
        await confirm({
          title: `Close order ${o.orderNumber}?`,
          description:
            'Use this when the supplier will not send the rest. Goods already received stay in stock; nothing more can be received against this order.',
          confirmLabel: 'Close order'
        })
      ) {
        await run(
          () => invoke('purchases:close-order', { purchaseOrderId }),
          `Order ${o.orderNumber} was closed.`
        )
      }
    },
    cancel: async (o: PurchaseOrderDetail) => {
      if (
        await confirm({
          title: `Cancel order ${o.orderNumber}?`,
          description: 'The order stays on record as cancelled. This cannot be undone.',
          confirmLabel: 'Cancel order',
          cancelLabel: 'Keep order',
          tone: 'danger'
        })
      ) {
        await run(
          () => invoke('purchases:cancel-order', { purchaseOrderId }),
          `Order ${o.orderNumber} was cancelled.`
        )
      }
    },
    remove: async (o: PurchaseOrderDetail) => {
      if (
        await confirm({
          title: `Delete draft ${o.orderNumber}?`,
          description: 'The draft is removed. This cannot be undone.',
          confirmLabel: 'Delete draft',
          tone: 'danger'
        })
      ) {
        setBusy(true)
        setError(null)
        try {
          await invoke('purchases:delete-order', { purchaseOrderId })
          toast.success(`Draft ${o.orderNumber} was deleted.`)
          await refreshPurchases(queryClient)
          onClose()
        } catch (failure) {
          setError(describeError(failure).message)
        } finally {
          setBusy(false)
        }
      }
    }
  }

  const showReceived = order !== undefined && order.status !== 'draft'
  const columns: Column<PurchaseOrderLineDetail>[] = [
    {
      id: 'item',
      header: 'Item',
      cell: (l) => (
        <div>
          <span className="font-medium">{l.name}</span>
          <div className="text-sm text-fg-muted">{l.sku}</div>
        </div>
      )
    },
    {
      id: 'ordered',
      header: 'Ordered',
      align: 'right',
      cell: (l) => <Quantity milli={l.quantityMilli} unit={l.unitCode} />
    },
    ...(showReceived
      ? [
          {
            id: 'received',
            header: 'Received',
            align: 'right' as const,
            cell: (l: PurchaseOrderLineDetail) => (
              <Quantity milli={l.receivedMilli} unit={l.unitCode} />
            )
          },
          {
            id: 'outstanding',
            header: 'Still to come',
            align: 'right' as const,
            cell: (l: PurchaseOrderLineDetail) =>
              l.outstandingMilli === 0 ? (
                <span className="text-fg-muted">–</span>
              ) : (
                <Quantity milli={l.outstandingMilli} unit={l.unitCode} className="font-medium" />
              )
          }
        ]
      : []),
    {
      id: 'cost',
      header: 'Cost each',
      align: 'right',
      cell: (l) => <Money minor={l.unitCostMinor} />
    },
    { id: 'total', header: 'Total', align: 'right', cell: (l) => <Money minor={l.totalMinor} /> }
  ]

  const receivedAnything = order?.lines.some((l) => l.receivedMilli > 0) ?? false

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={order ? `Order ${order.orderNumber}` : 'Purchase order'}
      footer={
        order && canManage ? (
          <>
            <Button onClick={onClose}>Close window</Button>
            {order.status === 'draft' && (
              <>
                <Button
                  variant="danger"
                  icon={<Trash2 />}
                  disabled={busy}
                  onClick={() => void act.remove(order)}
                >
                  Delete draft
                </Button>
                <Button icon={<Pencil />} disabled={busy} onClick={() => onEdit(order)}>
                  Edit
                </Button>
                <Button
                  variant="primary"
                  icon={<CheckCheck />}
                  disabled={busy}
                  onClick={() => void act.confirm(order)}
                >
                  Confirm order
                </Button>
              </>
            )}
            {order.status === 'confirmed' && (
              <>
                {!receivedAnything && (
                  <Button
                    variant="danger"
                    icon={<Ban />}
                    disabled={busy}
                    onClick={() => void act.cancel(order)}
                  >
                    Cancel order
                  </Button>
                )}
                <Button icon={<XCircle />} disabled={busy} onClick={() => void act.close(order)}>
                  Close order
                </Button>
                <Button
                  variant="primary"
                  icon={<PackageCheck />}
                  disabled={busy}
                  onClick={() => onReceive(order)}
                >
                  Receive goods
                </Button>
              </>
            )}
          </>
        ) : undefined
      }
    >
      {detail.error ? (
        <Alert tone="danger">{describeError(detail.error).message}</Alert>
      ) : !order ? (
        <Spinner label="Loading" />
      ) : (
        <div className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-fg-muted">Supplier</dt>
              <dd className="font-medium">{order.supplierName}</dd>
            </div>
            <div>
              <dt className="text-sm text-fg-muted">Status</dt>
              <dd>
                <Badge tone={ORDER_STATUS[order.status].tone}>
                  {ORDER_STATUS[order.status].label}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-fg-muted">Written by</dt>
              <dd>
                {order.createdByName} · {formatStoreTime(order.createdAt, timeZone)}
              </dd>
            </div>
            {order.confirmedAt !== null && (
              <div>
                <dt className="text-sm text-fg-muted">Confirmed</dt>
                <dd>{formatStoreTime(order.confirmedAt, timeZone)}</dd>
              </div>
            )}
            {order.closedAt !== null && (
              <div>
                <dt className="text-sm text-fg-muted">Closed</dt>
                <dd>{formatStoreTime(order.closedAt, timeZone)}</dd>
              </div>
            )}
            {order.cancelledAt !== null && (
              <div>
                <dt className="text-sm text-fg-muted">Cancelled</dt>
                <dd>{formatStoreTime(order.cancelledAt, timeZone)}</dd>
              </div>
            )}
            {order.notes && (
              <div className="sm:col-span-2">
                <dt className="text-sm text-fg-muted">Note</dt>
                <dd>{order.notes}</dd>
              </div>
            )}
          </dl>

          <DataTable
            caption={`Items on order ${order.orderNumber}`}
            columns={columns}
            rows={order.lines}
            getRowId={(l) => l.variantId}
            density="compact"
          />
          <p className="text-right text-lg">
            Order total <Money minor={order.totalMinor} className="font-semibold" />
          </p>

          {order.receipts.length > 0 && (
            <section aria-label="Goods received against this order">
              <h3 className="mb-2 font-medium">Goods received</h3>
              <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
                {order.receipts.map((r) => (
                  <li
                    key={r.goodsReceiptId}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        className="font-mono font-semibold text-accent-fg underline"
                        onClick={() => onOpenReceipt(r.goodsReceiptId)}
                      >
                        {r.receiptNumber}
                      </button>
                      <Badge tone={RECEIPT_STATUS[r.status].tone}>
                        {RECEIPT_STATUS[r.status].label}
                      </Badge>
                      {r.postedAt !== null && (
                        <span className="text-sm text-fg-muted">
                          {formatStoreTime(r.postedAt, timeZone)}
                        </span>
                      )}
                    </span>
                    <Money minor={r.totalMinor} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Dialog>
  )
}
