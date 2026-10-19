import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  History,
  Plus,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  AdjustmentReasonCode,
  InventoryMovement,
  MovementType,
  StockAdjustmentDetail,
  StockListItem
} from '@shared/ipc/contract'
import { formatQuantity, parseQuantity } from '@shared/quantity'
import { formatStoreTime } from '@shared/storeTime'
import { useCan } from '../auth/permissions'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Quantity,
  Select,
  Spinner,
  TextInput,
  useToast,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'
import { useStoreTimeZone } from '../store/storeContext'

const HISTORY_PAGE_SIZE = 25

const OUTFLOW_REASONS = new Set<AdjustmentReasonCode>(['damage', 'expiry', 'theft_loss'])

const MOVEMENT_LABELS: Record<MovementType, string> = {
  sale: 'Sale',
  sale_void: 'Sale voided',
  sale_return: 'Customer return',
  goods_receipt: 'Goods received',
  adjustment: 'Adjustment'
}

export async function refreshInventory(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all(
    [
      'inventory:list',
      'inventory:movements',
      'inventory:list-adjustments',
      'products:list',
      'products:get'
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))
  )
}

interface DraftAdjustmentLine {
  variantId: number
  name: string
  sku: string
  unitCode: string
  allowsFraction: boolean
  onHandMilli: number
  direction: 'add' | 'remove'
  quantityText: string
  error?: string | undefined
}

function defaultDirectionFor(reason: AdjustmentReasonCode): 'add' | 'remove' {
  return OUTFLOW_REASONS.has(reason) ? 'remove' : 'add'
}

function parseNonNegativeQuantity(
  input: string,
  allowsFraction: boolean
): { ok: true; milli: number } | { ok: false; error: string } {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, error: 'Enter a quantity' }
  if (/^0+(?:\.0+)?$/.test(trimmed)) {
    return { ok: true, milli: 0 }
  }
  try {
    return { ok: true, milli: parseQuantity(trimmed, { allowsFraction }) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof RangeError ? error.message : 'Enter a valid quantity'
    }
  }
}

/** M14-04: record a stock adjustment for one or more items with a reason and note. */
export function StockAdjustmentDialog({
  initialItem,
  onClose
}: {
  initialItem?: StockListItem | undefined
  onClose: () => void
}): React.JSX.Element {
  const reasons = useIpcQuery('inventory:list-reasons')
  const stockPage = useIpcQuery('inventory:list', { limit: 200 })
  const queryClient = useQueryClient()
  const toast = useToast()

  const [reasonCode, setReasonCode] = useState<AdjustmentReasonCode>('opening_stock')
  const [notes, setNotes] = useState('')
  const [pickVariantId, setPickVariantId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<DraftAdjustmentLine[]>(() =>
    initialItem
      ? [
          {
            variantId: initialItem.variantId,
            name: initialItem.name,
            sku: initialItem.sku,
            unitCode: initialItem.unitCode,
            allowsFraction: initialItem.allowsFraction,
            onHandMilli: initialItem.onHandMilli,
            direction: 'add',
            quantityText: ''
          }
        ]
      : []
  )

  const allItems = stockPage.data?.items ?? []
  const usedIds = new Set(lines.map((line) => line.variantId))
  const availableItems = allItems.filter((item) => !usedIds.has(item.variantId))

  const handleReasonChange = (nextReason: AdjustmentReasonCode): void => {
    setReasonCode(nextReason)
    const nextDir = defaultDirectionFor(nextReason)
    setLines((current) =>
      current.map((line) =>
        line.quantityText.trim() === '' ? { ...line, direction: nextDir } : line
      )
    )
  }

  const addPickedItem = (variantIdText: string): void => {
    const id = Number(variantIdText)
    const found = allItems.find((item) => item.variantId === id)
    if (!found || usedIds.has(found.variantId)) return
    setLines((current) => [
      ...current,
      {
        variantId: found.variantId,
        name: found.name,
        sku: found.sku,
        unitCode: found.unitCode,
        allowsFraction: found.allowsFraction,
        onHandMilli: found.onHandMilli,
        direction: defaultDirectionFor(reasonCode),
        quantityText: ''
      }
    ])
    setPickVariantId('')
  }

  const updateLine = (
    variantId: number,
    patch: Partial<Pick<DraftAdjustmentLine, 'direction' | 'quantityText' | 'error'>>
  ): void => {
    setLines((current) =>
      current.map((line) =>
        line.variantId === variantId ? { ...line, ...patch, error: undefined } : line
      )
    )
  }

  const removeLine = (variantId: number): void => {
    setLines((current) => current.filter((line) => line.variantId !== variantId))
  }

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    if (lines.length === 0) {
      setError('Choose at least one item to adjust.')
      return
    }

    let hasLineError = false
    const validatedLines: { variantId: number; quantityDeltaMilli: number }[] = []
    const nextLines = lines.map((line) => {
      try {
        const milli = parseQuantity(line.quantityText, { allowsFraction: line.allowsFraction })
        validatedLines.push({
          variantId: line.variantId,
          quantityDeltaMilli: line.direction === 'remove' ? -milli : milli
        })
        return { ...line, error: undefined }
      } catch (err) {
        hasLineError = true
        return {
          ...line,
          error: err instanceof RangeError ? err.message : 'Enter a valid quantity'
        }
      }
    })

    if (hasLineError) {
      setLines(nextLines)
      return
    }

    setSubmitting(true)
    try {
      const created = await invoke('inventory:adjust', {
        reasonCode,
        notes: notes.trim() === '' ? null : notes.trim(),
        items: validatedLines
      })
      toast.success(`Stock adjustment ${created.adjustmentNumber} was recorded.`)
      await refreshInventory(queryClient)
      onClose()
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setSubmitting(false)
    }
  }

  const loadError = reasons.error ?? stockPage.error

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Adjust stock"
      description="Record opening stock, damaged or expired goods, or other stock changes. Every adjustment is saved to the stock ledger and audit log."
      closeOnBackdrop={false}
    >
      {loadError ? (
        <Alert tone="danger">{describeError(loadError).message}</Alert>
      ) : !reasons.data || !stockPage.data ? (
        <Spinner label="Loading" />
      ) : (
        <form noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Reason">
              <Select
                value={reasonCode}
                onChange={(event) => handleReasonChange(event.target.value as AdjustmentReasonCode)}
                options={reasons.data.map((r) => ({
                  value: r.adjustmentReasonCode,
                  label: r.name
                }))}
              />
            </Field>
            <Field label="Note" hint="Optional">
              <TextInput
                value={notes}
                maxLength={300}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. Damaged during unloading"
              />
            </Field>
          </div>

          {availableItems.length > 0 && (
            <Field label={lines.length === 0 ? 'Item' : 'Add another item'}>
              <Select
                value={pickVariantId}
                onChange={(event) => addPickedItem(event.target.value)}
                placeholder="Choose an item to adjust…"
                options={availableItems.map((item) => ({
                  value: String(item.variantId),
                  label: `${item.name} (${item.sku}) — ${formatQuantity(item.onHandMilli)} ${item.unitCode} in stock`
                }))}
              />
            </Field>
          )}

          {lines.length > 0 && (
            <div className="space-y-3">
              {lines.map((line) => {
                const parsed = parseNonNegativeQuantity(line.quantityText, line.allowsFraction)
                const deltaMilli =
                  parsed.ok && parsed.milli > 0
                    ? line.direction === 'remove'
                      ? -parsed.milli
                      : parsed.milli
                    : null
                const afterMilli = deltaMilli === null ? null : line.onHandMilli + deltaMilli
                return (
                  <div
                    key={line.variantId}
                    className="rounded-md border border-border-subtle bg-surface-raised p-3 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{line.name}</div>
                        <div className="text-sm text-fg-muted">
                          {line.sku} · In stock:{' '}
                          <Quantity milli={line.onHandMilli} unit={line.unitCode} />
                          {afterMilli !== null && (
                            <>
                              {' → New stock: '}
                              <Quantity
                                milli={afterMilli}
                                unit={line.unitCode}
                                className={
                                  afterMilli < 0 ? 'text-danger font-medium' : 'font-medium'
                                }
                              />
                            </>
                          )}
                        </div>
                      </div>
                      {lines.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 />}
                          aria-label={`Remove ${line.name}`}
                          onClick={() => removeLine(line.variantId)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={`Action for ${line.name}`}>
                        <Select
                          value={line.direction}
                          onChange={(event) =>
                            updateLine(line.variantId, {
                              direction: event.target.value as 'add' | 'remove'
                            })
                          }
                          options={[
                            { value: 'add', label: 'Add to stock (+)' },
                            { value: 'remove', label: 'Remove from stock (−)' }
                          ]}
                        />
                      </Field>
                      <Field
                        label={`Quantity (${line.unitCode})`}
                        error={line.error}
                        hint={line.allowsFraction ? 'Up to 3 decimal places' : 'Whole numbers'}
                      >
                        <TextInput
                          aria-label={`Quantity for ${line.name}`}
                          inputMode={line.allowsFraction ? 'decimal' : 'numeric'}
                          value={line.quantityText}
                          onChange={(event) =>
                            updateLine(line.variantId, { quantityText: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              icon={<SlidersHorizontal />}
              loading={submitting}
            >
              Record adjustment
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

/**
 * M14-06: physical stock count sheet. The user enters counted quantities for
 * any items they checked, sees the live variance against recorded stock, and
 * approves the reconciliation in one step.
 */
export function StockCountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const stockPage = useIpcQuery('inventory:list', { limit: 200 })
  const queryClient = useQueryClient()
  const toast = useToast()

  const [search, setSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const items = useMemo(() => stockPage.data?.items ?? [], [stockPage.data])
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.barcodes.some((code) => code.toLowerCase().includes(q))
    )
  }, [items, search])

  const summary = useMemo(() => {
    let counted = 0
    let withVariance = 0
    for (const item of items) {
      const raw = counts[item.variantId]?.trim() ?? ''
      if (!raw) continue
      counted++
      const parsed = parseNonNegativeQuantity(raw, item.allowsFraction)
      if (parsed.ok && parsed.milli !== item.onHandMilli) withVariance++
    }
    return { counted, withVariance }
  }, [items, counts])

  const setCountText = (variantId: number, text: string): void => {
    setCounts((current) => ({ ...current, [variantId]: text }))
    setRowErrors((current) => {
      if (!(variantId in current)) return current
      return Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== variantId))
    })
  }

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)

    const nextRowErrors: Record<number, string> = {}
    const payloadItems: { variantId: number; countedMilli: number }[] = []

    for (const item of items) {
      const raw = counts[item.variantId]?.trim() ?? ''
      if (!raw) continue
      const parsed = parseNonNegativeQuantity(raw, item.allowsFraction)
      if (!parsed.ok) {
        nextRowErrors[item.variantId] = parsed.error
      } else {
        payloadItems.push({ variantId: item.variantId, countedMilli: parsed.milli })
      }
    }

    if (Object.keys(nextRowErrors).length > 0) {
      setRowErrors(nextRowErrors)
      return
    }
    if (payloadItems.length === 0) {
      setError('Enter the counted quantity for at least one item.')
      return
    }

    setSubmitting(true)
    try {
      const created = await invoke('inventory:reconcile', {
        notes: notes.trim() === '' ? null : notes.trim(),
        items: payloadItems
      })
      if (created) {
        toast.success(`Stock count ${created.adjustmentNumber} was recorded.`)
      } else {
        toast.success('Recorded stock already matches your count.')
      }
      await refreshInventory(queryClient)
      onClose()
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setSubmitting(false)
    }
  }

  const columns: Column<StockListItem>[] = [
    {
      id: 'item',
      header: 'Item',
      cell: (item) => (
        <div>
          <span className="font-medium">{item.name}</span>
          <div className="text-sm text-fg-muted">{item.sku}</div>
        </div>
      )
    },
    {
      id: 'recorded',
      header: 'Recorded',
      align: 'right',
      cell: (item) => <Quantity milli={item.onHandMilli} unit={item.unitCode} />
    },
    {
      id: 'counted',
      header: 'Counted',
      cell: (item) => (
        <div className="max-w-40">
          <TextInput
            aria-label={`Counted quantity for ${item.name}`}
            inputMode={item.allowsFraction ? 'decimal' : 'numeric'}
            placeholder={formatQuantity(item.onHandMilli)}
            value={counts[item.variantId] ?? ''}
            aria-invalid={rowErrors[item.variantId] ? true : undefined}
            onChange={(event) => setCountText(item.variantId, event.target.value)}
          />
          {rowErrors[item.variantId] && (
            <p className="mt-1 text-xs text-danger">{rowErrors[item.variantId]}</p>
          )}
        </div>
      )
    },
    {
      id: 'variance',
      header: 'Difference',
      align: 'right',
      cell: (item) => {
        const raw = counts[item.variantId]?.trim() ?? ''
        if (!raw) return <span className="text-fg-muted">–</span>
        const parsed = parseNonNegativeQuantity(raw, item.allowsFraction)
        if (!parsed.ok) return <span className="text-fg-muted">–</span>
        const diff = parsed.milli - item.onHandMilli
        if (diff === 0) return <Badge tone="neutral">No change</Badge>
        return (
          <span className={diff > 0 ? 'font-medium text-success' : 'font-medium text-danger'}>
            {diff > 0 ? '+' : ''}
            {formatQuantity(diff)} {item.unitCode}
          </span>
        )
      }
    }
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Count stock"
      description="Enter the physical quantity on the shelf for the items you counted. StorePro calculates the difference and records a stock count adjustment."
      closeOnBackdrop={false}
    >
      {stockPage.error ? (
        <Alert tone="danger">{describeError(stockPage.error).message}</Alert>
      ) : !stockPage.data ? (
        <Spinner label="Loading" />
      ) : (
        <form noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Find on sheet" hint="Filter by name, SKU or barcode">
              <TextInput
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Field label="Note" hint="Optional">
              <TextInput
                value={notes}
                maxLength={300}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. Monthly shelf count"
              />
            </Field>
          </div>

          <DataTable
            caption="Stock count sheet"
            columns={columns}
            rows={filteredItems}
            getRowId={(item) => item.variantId}
            density="compact"
          />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-sm text-fg-muted" role="status">
              {summary.counted === 0
                ? 'Leave uncounted items blank.'
                : `${summary.counted} counted · ${summary.withVariance} with a difference`}
            </p>
            <span className="flex gap-3">
              <Button onClick={onClose}>Cancel</Button>
              <Button
                type="submit"
                variant="primary"
                icon={<ClipboardCheck />}
                loading={submitting}
              >
                Approve count
              </Button>
            </span>
          </div>
        </form>
      )}
    </Dialog>
  )
}

/** M14-07: stock movement history for one item, newest first. */
export function MovementHistoryDialog({
  variantId,
  onClose,
  onAdjust
}: {
  variantId: number
  onClose: () => void
  onAdjust?: (() => void) | undefined
}): React.JSX.Element {
  const canAdjust = useCan()('stock.adjust')
  const timeZone = useStoreTimeZone()
  const [movementType, setMovementType] = useState<MovementType | ''>('')
  const [page, setPage] = useState(0)

  const filter = useMemo(
    () => ({
      variantId,
      ...(movementType ? { movementType } : {}),
      offset: page * HISTORY_PAGE_SIZE,
      limit: HISTORY_PAGE_SIZE
    }),
    [variantId, movementType, page]
  )

  const history = useQuery({
    queryKey: ['inventory:movements', filter],
    queryFn: () => invoke('inventory:movements', filter),
    placeholderData: keepPreviousData
  })

  const data = history.data
  const total = data?.total ?? 0
  const first = total === 0 ? 0 : page * HISTORY_PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * HISTORY_PAGE_SIZE)

  const columns: Column<InventoryMovement>[] = [
    {
      id: 'when',
      header: 'When',
      cell: (m) => (
        <span className="tabular text-sm">{formatStoreTime(m.occurredAt, timeZone)}</span>
      )
    },
    {
      id: 'movement',
      header: 'Movement',
      cell: (m) => (
        <div>
          <span className="font-medium">
            {MOVEMENT_LABELS[m.movementType]}
            {m.reasonName ? ` · ${m.reasonName}` : ''}
          </span>
          {m.notes && <div className="text-sm text-fg-muted">{m.notes}</div>}
        </div>
      )
    },
    {
      id: 'document',
      header: 'Document',
      cell: (m) => <span className="tabular">{m.documentNumber}</span>
    },
    {
      id: 'by',
      header: 'By',
      cell: (m) => m.actorName ?? <span className="text-fg-muted">–</span>
    },
    {
      id: 'change',
      header: 'Change',
      align: 'right',
      cell: (m) => (
        <span
          className={`tabular font-medium ${m.quantityDeltaMilli > 0 ? 'text-success' : 'text-danger'}`}
        >
          {m.quantityDeltaMilli > 0 ? '+' : ''}
          {formatQuantity(m.quantityDeltaMilli)} {data?.unitCode ?? ''}
        </span>
      )
    },
    {
      id: 'balance',
      header: 'Balance after',
      align: 'right',
      cell: (m) => <Quantity milli={m.balanceAfterMilli} unit={data?.unitCode ?? ''} />
    }
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={data ? `${data.name} — Stock movements` : 'Stock movements'}
      description={
        data
          ? `${data.sku} · In stock: ${formatQuantity(data.onHandMilli)} ${data.unitCode}${
              data.reorderLevelMilli !== null
                ? ` · Low-stock level: ${formatQuantity(data.reorderLevelMilli)} ${data.unitCode}`
                : ''
            }`
          : undefined
      }
    >
      {history.error ? (
        <Alert tone="danger">{describeError(history.error).message}</Alert>
      ) : !data ? (
        <Spinner label="Loading" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-64">
              <Field label="Movement type">
                <Select
                  value={movementType}
                  onChange={(event) => {
                    setMovementType(event.target.value as MovementType | '')
                    setPage(0)
                  }}
                  options={[
                    { value: '', label: 'All movements' },
                    { value: 'sale', label: 'Sales' },
                    { value: 'sale_void', label: 'Voided sales' },
                    { value: 'sale_return', label: 'Customer returns' },
                    { value: 'goods_receipt', label: 'Goods received' },
                    { value: 'adjustment', label: 'Stock adjustments' }
                  ]}
                />
              </Field>
            </div>
            {canAdjust && onAdjust && (
              <Button icon={<Plus />} onClick={onAdjust}>
                Adjust this item
              </Button>
            )}
          </div>

          <DataTable
            caption={`Stock movements for ${data.name}`}
            columns={columns}
            rows={data.items}
            getRowId={(m) => `${m.movementType}-${m.sourceTable}-${m.sourceId}`}
            density="compact"
            empty={
              <EmptyState
                icon={<History />}
                title="No stock movements yet"
                description="Sales, goods receipts, returns and adjustments for this item will appear here."
              />
            }
          />

          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted" role="status">
              {total === 0 ? '' : `Showing ${first}–${last} of ${total}`}
            </p>
            {total > HISTORY_PAGE_SIZE && (
              <span className="flex gap-2">
                <Button
                  size="sm"
                  icon={<ChevronLeft />}
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Newer
                </Button>
                <Button
                  size="sm"
                  icon={<ChevronRight />}
                  disabled={last >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Older
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

/** Past stock adjustments and stock counts (`stock_adjustments`). */
export function AdjustmentHistoryDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const timeZone = useStoreTimeZone()
  const reasons = useIpcQuery('inventory:list-reasons')
  const [reasonCode, setReasonCode] = useState<AdjustmentReasonCode | ''>('')
  const [page, setPage] = useState(0)

  const filter = useMemo(
    () => ({
      ...(reasonCode ? { reasonCode } : {}),
      offset: page * HISTORY_PAGE_SIZE,
      limit: HISTORY_PAGE_SIZE
    }),
    [reasonCode, page]
  )

  const adjustments = useQuery({
    queryKey: ['inventory:list-adjustments', filter],
    queryFn: () => invoke('inventory:list-adjustments', filter),
    placeholderData: keepPreviousData
  })

  const data = adjustments.data
  const total = data?.total ?? 0
  const first = total === 0 ? 0 : page * HISTORY_PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * HISTORY_PAGE_SIZE)

  const columns: Column<StockAdjustmentDetail>[] = [
    {
      id: 'number',
      header: 'Adjustment',
      cell: (a) => (
        <div>
          <span className="font-medium tabular">{a.adjustmentNumber}</span>
          <div className="text-sm text-fg-muted">{formatStoreTime(a.adjustedAt, timeZone)}</div>
        </div>
      )
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (a) => (
        <div>
          <span>{a.reasonName}</span>
          {a.notes && <div className="text-sm text-fg-muted">{a.notes}</div>}
        </div>
      )
    },
    {
      id: 'items',
      header: 'Items changed',
      cell: (a) => (
        <div className="space-y-0.5 text-sm">
          {a.items.map((item) => (
            <div key={item.variantId}>
              <span className="font-medium">{item.name}</span>:{' '}
              <span
                className={
                  item.quantityDeltaMilli > 0 ? 'tabular text-success' : 'tabular text-danger'
                }
              >
                {item.quantityDeltaMilli > 0 ? '+' : ''}
                {formatQuantity(item.quantityDeltaMilli)} {item.unitCode}
              </span>
            </div>
          ))}
        </div>
      )
    },
    {
      id: 'by',
      header: 'By',
      cell: (a) => a.adjustedByName
    }
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Stock adjustments"
      description="Every manual stock adjustment and physical stock count."
    >
      {adjustments.error ? (
        <Alert tone="danger">{describeError(adjustments.error).message}</Alert>
      ) : !data ? (
        <Spinner label="Loading" />
      ) : (
        <div className="space-y-4">
          <div className="w-64">
            <Field label="Reason">
              <Select
                value={reasonCode}
                onChange={(event) => {
                  setReasonCode(event.target.value as AdjustmentReasonCode | '')
                  setPage(0)
                }}
                options={[
                  { value: '', label: 'All reasons' },
                  ...(reasons.data ?? []).map((r) => ({
                    value: r.adjustmentReasonCode,
                    label: r.name
                  }))
                ]}
              />
            </Field>
          </div>

          <DataTable
            caption="Stock adjustments"
            columns={columns}
            rows={data.items}
            getRowId={(a) => a.stockAdjustmentId}
            density="compact"
            empty={
              <EmptyState
                icon={<History />}
                title="No adjustments yet"
                description="Opening stock, damage write-offs and stock counts will appear here."
              />
            }
          />

          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted" role="status">
              {total === 0 ? '' : `Showing ${first}–${last} of ${total}`}
            </p>
            {total > HISTORY_PAGE_SIZE && (
              <span className="flex gap-2">
                <Button
                  size="sm"
                  icon={<ChevronLeft />}
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Newer
                </Button>
                <Button
                  size="sm"
                  icon={<ChevronRight />}
                  disabled={last >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Older
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
