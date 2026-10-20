import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, PackageCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type {
  GoodsReceiptDetail,
  PurchaseLineDetail,
  PurchaseOrderDetail
} from '@shared/ipc/contract'
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
import { describeError, fieldErrorsFrom } from '../lib/describeError'
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
import { RECEIPT_STATUS } from './status'

function CostUpdateOption({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2 text-base">
      <input
        type="checkbox"
        className="mt-1 size-4"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        Update each item&apos;s cost price to what was paid
        <span className="block text-sm text-fg-muted">
          Changes the cost price on the product, which profit reports use. Selling prices stay as
          they are.
        </span>
      </span>
    </label>
  )
}

/**
 * M15-03, M15-04: record goods arriving, against an order or as a direct
 * purchase. Saved as a draft it changes nothing; posting adds the goods to stock.
 */
export function GoodsReceiptDialog({
  receipt,
  order,
  onClose,
  onSaved
}: {
  /** A draft being changed. */
  receipt?: GoodsReceiptDetail | undefined
  /** The order the goods are for, when receiving against one. */
  order?: PurchaseOrderDetail | undefined
  onClose: () => void
  onSaved: (saved: GoodsReceiptDetail) => void
}): React.JSX.Element {
  const can = useCan()
  const { minorUnits } = useCurrency()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const suppliers = useQuery({
    queryKey: ['suppliers:list', 'active-for-documents'],
    queryFn: () => invoke('suppliers:list', { status: 'active', limit: 200 })
  })

  const purchaseOrderId = receipt?.purchaseOrderId ?? order?.purchaseOrderId ?? null
  const orderNumber = receipt?.orderNumber ?? order?.orderNumber ?? null
  const [supplierId, setSupplierId] = useState(
    String(receipt?.supplierId ?? order?.supplierId ?? '')
  )
  const [billNumber, setBillNumber] = useState(receipt?.supplierInvoiceNumber ?? '')
  const [billDate, setBillDate] = useState(receipt?.supplierInvoiceDate ?? '')
  const [updateCosts, setUpdateCosts] = useState(false)
  const [lines, setLines] = useState<DraftLine[]>(() => {
    if (receipt) {
      return receipt.lines.map((l) => newDraftLine(l, minorUnits, l.quantityMilli, l.unitCostMinor))
    }
    return (order?.lines ?? [])
      .filter((l) => l.outstandingMilli > 0)
      .map((l) => newDraftLine(l, minorUnits, l.outstandingMilli, l.unitCostMinor))
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'draft' | 'post' | null>(null)

  const save = async (post: boolean): Promise<void> => {
    setError(null)
    setErrors({})
    if (!supplierId) {
      setErrors({ supplierId: 'Choose a supplier' })
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
    if (
      post &&
      !(await confirm({
        title: 'Add these goods to stock?',
        description: `${lines.length} ${lines.length === 1 ? 'item' : 'items'} will be added to stock now. A posted receipt cannot be edited or deleted; correct a mistake with a stock adjustment.`,
        confirmLabel: 'Add to stock'
      }))
    ) {
      return
    }
    setBusy(post ? 'post' : 'draft')
    try {
      const saved = await invoke('purchases:save-receipt', {
        ...(receipt ? { goodsReceiptId: receipt.goodsReceiptId } : {}),
        supplierId: Number(supplierId),
        purchaseOrderId,
        supplierInvoiceNumber: billNumber.trim() === '' ? null : billNumber.trim(),
        supplierInvoiceDate: billDate === '' ? null : billDate,
        lines: parsed.lines,
        post,
        updateCosts: post && updateCosts
      })
      toast.success(
        post
          ? `${saved.receiptNumber} was posted and the goods are in stock.`
          : `${saved.receiptNumber} was saved as a draft.`
      )
      await refreshPurchases(queryClient)
      onSaved(saved)
    } catch (failure) {
      setLines(withServerLineErrors(lines, failure))
      const fields = fieldErrorsFrom(failure) ?? {}
      const own = Object.fromEntries(
        Object.entries(fields).filter(([k]) => !k.startsWith('lines.'))
      )
      setErrors(own)
      setError(Object.keys(own).length > 0 ? null : describeError(failure).message)
    } finally {
      setBusy(null)
    }
  }

  const total = draftTotal(lines, minorUnits)
  const title = receipt
    ? `Edit receipt ${receipt.receiptNumber}`
    : order
      ? `Receive goods for ${order.orderNumber}`
      : 'Receive goods without an order'

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={title}
      description="Enter what actually arrived and what you paid. Saved as a draft nothing changes; posting adds the goods to stock."
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
            icon={<PackageCheck />}
            loading={busy === 'post'}
            disabled={busy !== null}
            onClick={() => void save(true)}
          >
            Post and add to stock
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
          {orderNumber && (
            <Alert tone="info">
              Against order {orderNumber}. Items you leave off stay outstanding on the order.
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Supplier" required error={errors.supplierId}>
              {purchaseOrderId === null ? (
                <Select
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                  placeholder="Choose a supplier…"
                  options={suppliers.data.items.map((s) => ({
                    value: String(s.supplierId),
                    label: s.name
                  }))}
                />
              ) : (
                <TextInput readOnly value={receipt?.supplierName ?? order?.supplierName ?? ''} />
              )}
            </Field>
            <Field
              label="Supplier bill number"
              hint="Optional"
              error={errors.supplierInvoiceNumber}
            >
              <TextInput
                value={billNumber}
                maxLength={40}
                onChange={(event) => setBillNumber(event.target.value)}
              />
            </Field>
            <Field label="Supplier bill date" hint="Optional" error={errors.supplierInvoiceDate}>
              <TextInput
                type="date"
                value={billDate}
                onChange={(event) => setBillDate(event.target.value)}
              />
            </Field>
          </div>
          {purchaseOrderId === null && (
            <ItemPicker
              excluded={new Set(lines.map((l) => l.variantId))}
              onPick={(item) =>
                setLines((current) => [
                  ...current,
                  newDraftLine(item, minorUnits, undefined, undefined)
                ])
              }
            />
          )}
          <LineEditor lines={lines} onChange={setLines} />
          {lines.length > 0 && (
            <p className="text-right text-lg">
              Receipt total <Money minor={total} className="font-semibold" />
            </p>
          )}
          {can('product.manage') && (
            <CostUpdateOption checked={updateCosts} onChange={setUpdateCosts} />
          )}
        </div>
      )}
    </Dialog>
  )
}

/** M15-06: one receipt, with posting and deleting for a draft. */
export function GoodsReceiptDetailDialog({
  goodsReceiptId,
  onClose,
  onEdit,
  onOpenOrder
}: {
  goodsReceiptId: number
  onClose: () => void
  onEdit: (receipt: GoodsReceiptDetail) => void
  onOpenOrder: (purchaseOrderId: number) => void
}): React.JSX.Element {
  const can = useCan()
  const timeZone = useStoreTimeZone()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updateCosts, setUpdateCosts] = useState(false)
  const detail = useQuery({
    queryKey: ['purchases:get-receipt', { goodsReceiptId }],
    queryFn: () => invoke('purchases:get-receipt', { goodsReceiptId })
  })
  const receipt = detail.data

  const post = async (r: GoodsReceiptDetail): Promise<void> => {
    if (
      !(await confirm({
        title: `Add ${r.receiptNumber} to stock?`,
        description:
          'The goods are added to stock now. A posted receipt cannot be edited or deleted; correct a mistake with a stock adjustment.',
        confirmLabel: 'Add to stock'
      }))
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await invoke('purchases:post-receipt', { goodsReceiptId, updateCosts })
      toast.success(`${r.receiptNumber} was posted and the goods are in stock.`)
      await refreshPurchases(queryClient)
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (r: GoodsReceiptDetail): Promise<void> => {
    if (
      !(await confirm({
        title: `Delete draft ${r.receiptNumber}?`,
        description: 'The draft is removed. Nothing was added to stock. This cannot be undone.',
        confirmLabel: 'Delete draft',
        tone: 'danger'
      }))
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await invoke('purchases:delete-receipt', { goodsReceiptId })
      toast.success(`Draft ${r.receiptNumber} was deleted.`)
      await refreshPurchases(queryClient)
      onClose()
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<PurchaseLineDetail>[] = [
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
      id: 'qty',
      header: 'Quantity',
      align: 'right',
      cell: (l) => <Quantity milli={l.quantityMilli} unit={l.unitCode} />
    },
    {
      id: 'cost',
      header: 'Cost each',
      align: 'right',
      cell: (l) => <Money minor={l.unitCostMinor} />
    },
    { id: 'total', header: 'Total', align: 'right', cell: (l) => <Money minor={l.totalMinor} /> }
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={receipt ? `Receipt ${receipt.receiptNumber}` : 'Goods receipt'}
      footer={
        receipt && receipt.status === 'draft' && can('purchase.manage') ? (
          <>
            <Button onClick={onClose}>Close window</Button>
            <Button
              variant="danger"
              icon={<Trash2 />}
              disabled={busy}
              onClick={() => void remove(receipt)}
            >
              Delete draft
            </Button>
            <Button icon={<Pencil />} disabled={busy} onClick={() => onEdit(receipt)}>
              Edit
            </Button>
            <Button
              variant="primary"
              icon={<PackageCheck />}
              loading={busy}
              onClick={() => void post(receipt)}
            >
              Post and add to stock
            </Button>
          </>
        ) : undefined
      }
    >
      {detail.error ? (
        <Alert tone="danger">{describeError(detail.error).message}</Alert>
      ) : !receipt ? (
        <Spinner label="Loading" />
      ) : (
        <div className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-fg-muted">Supplier</dt>
              <dd className="font-medium">{receipt.supplierName}</dd>
            </div>
            <div>
              <dt className="text-sm text-fg-muted">Status</dt>
              <dd>
                <Badge tone={RECEIPT_STATUS[receipt.status].tone}>
                  {RECEIPT_STATUS[receipt.status].label}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-fg-muted">Order</dt>
              <dd>
                {receipt.purchaseOrderId !== null && receipt.orderNumber ? (
                  <button
                    type="button"
                    className="font-mono font-semibold text-accent-fg underline"
                    onClick={() => onOpenOrder(receipt.purchaseOrderId as number)}
                  >
                    {receipt.orderNumber}
                  </button>
                ) : (
                  <span className="text-fg-muted">Direct purchase</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-fg-muted">Supplier bill</dt>
              <dd>
                {receipt.supplierInvoiceNumber ?? <span className="text-fg-muted">–</span>}
                {receipt.supplierInvoiceDate && ` · ${receipt.supplierInvoiceDate}`}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-fg-muted">Entered by</dt>
              <dd>
                {receipt.createdByName} · {formatStoreTime(receipt.createdAt, timeZone)}
              </dd>
            </div>
            {receipt.postedAt !== null && (
              <div>
                <dt className="text-sm text-fg-muted">Posted</dt>
                <dd>
                  {receipt.postedByName} · {formatStoreTime(receipt.postedAt, timeZone)}
                </dd>
              </div>
            )}
          </dl>
          <DataTable
            caption={`Items on receipt ${receipt.receiptNumber}`}
            columns={columns}
            rows={receipt.lines}
            getRowId={(l) => l.variantId}
            density="compact"
          />
          <p className="text-right text-lg">
            Receipt total <Money minor={receipt.totalMinor} className="font-semibold" />
          </p>
          {receipt.status === 'draft' && can('purchase.manage') && can('product.manage') && (
            <CostUpdateOption checked={updateCosts} onChange={setUpdateCosts} />
          )}
        </div>
      )}
    </Dialog>
  )
}
