import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, PauseCircle, Percent, Plus, Printer, RotateCcw, Search, Trash2, Wallet } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CheckoutPaymentInput,
  HeldBillDetail,
  HeldBillSummary,
  ItemLookup,
  PaymentMethodInfo,
  SaleDetail
} from '@shared/ipc/contract'
import { formatMoney, multiplyByQuantity, parseMoney, toDecimalString } from '@shared/money'
import { planCashTender, UPI_RECORDED_NOTICE } from '@shared/payments'
import {
  discountAmount,
  PricingError,
  type BillCalculation,
  type Discount
} from '@shared/pricing'
import { formatQuantity } from '@shared/quantity'
import { formatStoreTime } from '@shared/storeTime'
import { useManagerApproval } from '../auth/ManagerApproval'
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Money,
  Select,
  Spinner,
  TextInput,
  TotalDisplay,
  useCurrency,
  useToast
} from '../components/ui'
import { refreshInventory } from '../inventory/InventoryDialogs'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useStoreTimeZone } from '../store/storeContext'
import {
  toCheckoutInput,
  toHoldBillInput,
  type CartLine,
  type CartState
} from './cart'

export async function refreshSalesAndInventory(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all([
    refreshInventory(queryClient),
    queryClient.invalidateQueries({ queryKey: ['sales:list'] }),
    queryClient.invalidateQueries({ queryKey: ['sales:list-held'] }),
    queryClient.invalidateQueries({ queryKey: ['products:search'] })
  ])
}

function parsePercentBp(text: string): { ok: true; bp: number } | { ok: false; error: string } {
  const trimmed = text.trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed)
  if (!match) return { ok: false, error: 'Enter a percentage between 0 and 100 (up to 2 decimals)' }
  const whole = Number(match[1])
  const frac = Number((match[2] ?? '').padEnd(2, '0'))
  const bp = whole * 100 + frac
  if (bp < 0 || bp > 10_000) return { ok: false, error: 'Percentage must be between 0% and 100%' }
  return { ok: true, bp }
}

function formatPercentBp(bp: number): string {
  return (bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)
}

/** M11-04: Product search popup for adding items without a barcode. */
export function ProductSearchDialog({
  onSelect,
  onClose
}: {
  onSelect: (item: ItemLookup) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()

  const search = useQuery({
    queryKey: ['products:search', trimmed],
    queryFn: () =>
      trimmed.length > 0
        ? invoke('products:search', { query: trimmed, limit: 25 })
        : Promise.resolve([] as ItemLookup[])
  })

  const items = search.data ?? []

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Find product"
      description="Search by product name, variant, SKU or barcode to add an item to the bill."
    >
      <div className="space-y-4">
        <Field label="Search item">
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type product name, SKU or barcode…"
            autoFocus
          />
        </Field>

        {search.isLoading ? (
          <div className="py-8">
            <Spinner label="Searching products" />
          </div>
        ) : trimmed.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="Type to search the catalogue"
            description="Enter part of an item's name, SKU or barcode above."
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No matching products"
            description={`Nothing matched “${trimmed}”.`}
          />
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-base">
              <thead className="border-b border-border bg-surface-subtle text-sm font-medium text-fg-muted">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2 text-right">On hand</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.variantId} className="hover:bg-surface-subtle">
                    <td className="px-3 py-2.5 font-medium text-fg">{item.name}</td>
                    <td className="px-3 py-2.5 font-mono text-sm text-fg-muted">{item.sku}</td>
                    <td className="px-3 py-2.5 text-right">
                      {item.tracksInventory && item.onHandMilli !== null ? (
                        <Badge tone={item.onHandMilli <= 0 ? 'danger' : 'neutral'}>
                          {`${formatQuantity(item.onHandMilli)} ${item.unitCode}`}
                        </Badge>
                      ) : (
                        <span className="text-sm text-fg-subtle">Not tracked</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      <Money minor={item.sellingPriceMinor} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Plus />}
                        aria-label={`Add ${item.name} to bill`}
                        onClick={() => {
                          onSelect(item)
                          onClose()
                        }}
                      >
                        Add
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  )
}

/** M11-05: Edit unit price and line discount for a cart line. */
export function LineEditDialog({
  line,
  onSave,
  onClose
}: {
  line: CartLine
  onSave: (unitPriceMinor: number, discount: Discount | null) => void
  onClose: () => void
}): React.JSX.Element {
  const currency = useCurrency()
  const [priceText, setPriceText] = useState(() =>
    toDecimalString(line.unitPriceMinor, currency.minorUnits)
  )
  const [discountKind, setDiscountKind] = useState<'none' | 'percent' | 'amount'>(
    line.discount?.kind ?? 'none'
  )
  const [discountText, setDiscountText] = useState(() => {
    if (!line.discount) return ''
    return line.discount.kind === 'percent'
      ? formatPercentBp(line.discount.bp)
      : toDecimalString(line.discount.minor, currency.minorUnits)
  })
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    setError(null)

    let nextPriceMinor: number
    try {
      nextPriceMinor = parseMoney(priceText, currency.minorUnits)
    } catch {
      setError('Enter a valid unit price')
      return
    }
    if (nextPriceMinor < 0) {
      setError("Unit price can't be negative")
      return
    }
    if (line.item.mrpMinor !== null && nextPriceMinor > line.item.mrpMinor) {
      setError(
        `Unit price cannot exceed MRP (${formatMoney(line.item.mrpMinor, currency)})`
      )
      return
    }

    const grossMinor = multiplyByQuantity(nextPriceMinor, line.quantityMilli)
    let nextDiscount: Discount | null = null
    if (discountKind === 'percent') {
      const parsed = parsePercentBp(discountText)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      if (parsed.bp > 0) nextDiscount = { kind: 'percent', bp: parsed.bp }
    } else if (discountKind === 'amount') {
      let minor: number
      try {
        minor = parseMoney(discountText, currency.minorUnits)
      } catch {
        setError('Enter a valid discount amount')
        return
      }
      if (minor < 0) {
        setError("Discount can't be negative")
        return
      }
      try {
        discountAmount({ kind: 'amount', minor }, grossMinor, 0)
      } catch (err) {
        setError(err instanceof PricingError ? err.message : 'Invalid discount')
        return
      }
      if (minor > 0) nextDiscount = { kind: 'amount', minor }
    }

    onSave(nextPriceMinor, nextDiscount)
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Edit ${line.item.name}`}
      description={`Catalogue price: ${formatMoney(line.item.sellingPriceMinor, currency)}${
        line.item.mrpMinor !== null
          ? ` · MRP: ${formatMoney(line.item.mrpMinor, currency)}`
          : ''
      }`}
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field
          label="Unit price"
          hint="Changing the catalogue price requires price-override permission or manager approval at checkout."
        >
          <TextInput
            value={priceText}
            onChange={(event) => setPriceText(event.target.value)}
            inputMode="decimal"
            autoFocus
          />
        </Field>

        <Field label="Line discount">
          <Select
            value={discountKind}
            onChange={(event) => {
              setDiscountKind(event.target.value as 'none' | 'percent' | 'amount')
              setDiscountText('')
            }}
            options={[
              { value: 'none', label: 'No line discount' },
              { value: 'percent', label: 'Percentage (%)' },
              { value: 'amount', label: `Flat amount (${currency.currencyCode})` }
            ]}
          />
        </Field>

        {discountKind !== 'none' && (
          <Field
            label={discountKind === 'percent' ? 'Discount percentage (%)' : 'Discount amount'}
          >
            <TextInput
              value={discountText}
              onChange={(event) => setDiscountText(event.target.value)}
              inputMode="decimal"
              placeholder={discountKind === 'percent' ? 'e.g. 5' : 'e.g. 10.00'}
            />
          </Field>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            Apply
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** M11-05: Bill-level discount dialog (F6). */
export function BillDiscountDialog({
  current,
  afterLineDiscountsMinor,
  maxDiscountBp,
  onSave,
  onClose
}: {
  current: Discount | null
  afterLineDiscountsMinor: number
  maxDiscountBp: number
  onSave: (discount: Discount | null) => void
  onClose: () => void
}): React.JSX.Element {
  const currency = useCurrency()
  const [kind, setKind] = useState<'none' | 'percent' | 'amount'>(current?.kind ?? 'percent')
  const [valueText, setValueText] = useState(() => {
    if (!current) return ''
    return current.kind === 'percent'
      ? formatPercentBp(current.bp)
      : toDecimalString(current.minor, currency.minorUnits)
  })
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    setError(null)
    if (kind === 'none' || valueText.trim() === '') {
      onSave(null)
      onClose()
      return
    }
    if (kind === 'percent') {
      const parsed = parsePercentBp(valueText)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      onSave(parsed.bp > 0 ? { kind: 'percent', bp: parsed.bp } : null)
      onClose()
      return
    }
    let minor: number
    try {
      minor = parseMoney(valueText, currency.minorUnits)
    } catch {
      setError('Enter a valid discount amount')
      return
    }
    if (minor < 0) {
      setError("Discount can't be negative")
      return
    }
    if (minor > afterLineDiscountsMinor) {
      setError("The discount can't be more than the bill")
      return
    }
    onSave(minor > 0 ? { kind: 'amount', minor } : null)
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Bill discount"
      description={`Cashier discount limit: ${formatPercentBp(maxDiscountBp)}%. Higher discounts ask for manager approval at checkout.`}
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Discount type">
          <Select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as 'none' | 'percent' | 'amount')
              setValueText('')
            }}
            options={[
              { value: 'percent', label: 'Percentage (%)' },
              { value: 'amount', label: `Flat amount (${currency.currencyCode})` },
              { value: 'none', label: 'No bill discount' }
            ]}
          />
        </Field>

        {kind !== 'none' && (
          <Field label={kind === 'percent' ? 'Discount percentage (%)' : 'Discount amount'}>
            <TextInput
              value={valueText}
              onChange={(event) => setValueText(event.target.value)}
              inputMode="decimal"
              placeholder={kind === 'percent' ? 'e.g. 5' : 'e.g. 25.00'}
              autoFocus
            />
          </Field>
        )}

        <div className="flex justify-between gap-3 pt-2">
          {current ? (
            <Button
              variant="ghost"
              onClick={() => {
                onSave(null)
                onClose()
              }}
            >
              Remove discount
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" icon={<Percent />}>
              Apply discount
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

/** M11-09: Hold / park current bill (F9). */
export function HoldBillDialog({
  cart,
  calculated,
  onHeld,
  onClose
}: {
  cart: CartState
  calculated: BillCalculation
  onHeld: (summary: HeldBillSummary) => void
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const held = await invoke('sales:hold', toHoldBillInput(cart, calculated, label))
      await queryClient.invalidateQueries({ queryKey: ['sales:list-held'] })
      toast.success(
        held.label ? `Held bill “${held.label}”.` : `Held bill #${held.heldBillId}.`
      )
      onHeld(held)
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Hold bill"
      description="Park this bill so you can serve the next customer and resume it when they are ready."
    >
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field
          label="Note or customer label (optional)"
          hint="Helps identify the bill when resuming, e.g. “Counter 2” or “Blue bag”."
        >
          <TextInput
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. Counter 2"
            maxLength={80}
            autoFocus
          />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={<PauseCircle />} loading={submitting}>
            Hold bill
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** M11-09: View, resume, or discard held bills (F8). */
export function HeldBillsDialog({
  onCounterHeldBillId = null,
  onResume,
  onClose
}: {
  /** The held bill the current cart was resumed from: it stays held until the sale is done. */
  onCounterHeldBillId?: number | null
  onResume: (detail: HeldBillDetail) => void
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const timeZone = useStoreTimeZone()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const heldQuery = useQuery({
    queryKey: ['sales:list-held'],
    queryFn: () => invoke('sales:list-held')
  })

  const bills = heldQuery.data ?? []

  const handleResume = async (bill: HeldBillSummary): Promise<void> => {
    setError(null)
    setBusyId(bill.heldBillId)
    try {
      const detail = await invoke('sales:resume-held', { heldBillId: bill.heldBillId })
      toast.info(
        detail.label ? `Resumed “${detail.label}”.` : `Resumed held bill #${detail.heldBillId}.`
      )
      onResume(detail)
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setBusyId(null)
    }
  }

  const handleDiscard = async (bill: HeldBillSummary): Promise<void> => {
    setError(null)
    setBusyId(bill.heldBillId)
    try {
      await invoke('sales:discard-held', { heldBillId: bill.heldBillId })
      await queryClient.invalidateQueries({ queryKey: ['sales:list-held'] })
      toast.info('Held bill discarded.')
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Held bills"
      description="Resume a parked bill into the billing counter or discard it if the customer left."
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {heldQuery.isLoading ? (
          <div className="py-8">
            <Spinner label="Loading held bills" />
          </div>
        ) : bills.length === 0 ? (
          <EmptyState
            icon={<PauseCircle />}
            title="No held bills"
            description="Bills parked with F9 or Hold bill appear here."
          />
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-base">
              <thead className="border-b border-border bg-surface-subtle text-sm font-medium text-fg-muted">
                <tr>
                  <th className="px-3 py-2">Bill</th>
                  <th className="px-3 py-2">Items</th>
                  <th className="px-3 py-2">Held by</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bills.map((bill) => {
                  const title = bill.label ?? `Held bill #${bill.heldBillId}`
                  const onCounter = bill.heldBillId === onCounterHeldBillId
                  return (
                    <tr key={bill.heldBillId}>
                      <td className="px-3 py-2.5 font-medium text-fg">
                        {title}
                        {onCounter && (
                          <span className="block text-sm font-normal text-fg-muted">
                            On the counter now
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-fg-muted">
                        <span className="font-medium text-fg">{bill.lineCount}</span> ·{' '}
                        {bill.itemSummary}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-fg-muted">{bill.heldByName}</td>
                      <td className="px-3 py-2.5 text-sm text-fg-muted">
                        {formatStoreTime(bill.heldAt, timeZone)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            loading={busyId === bill.heldBillId}
                            disabled={onCounter}
                            aria-label={`Resume ${title}`}
                            onClick={() => void handleResume(bill)}
                          >
                            Resume
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 />}
                            disabled={busyId === bill.heldBillId}
                            aria-label={`Discard ${title}`}
                            onClick={() => void handleDiscard(bill)}
                          >
                            Discard
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  )
}

interface PaymentEntryDraft {
  id: number
  paymentMethodId: number
  amountText: string
  tenderedText: string
  reference: string
}

/** M11-06, M12-02, M12-03: Payment dialog supporting Cash, UPI, Card and split payments. */
export function PaymentDialog({
  cart,
  calculated,
  methods,
  onCompleted,
  onClose
}: {
  cart: CartState
  calculated: BillCalculation
  methods: readonly PaymentMethodInfo[]
  onCompleted: (sale: SaleDetail) => void
  onClose: () => void
}): React.JSX.Element {
  const currency = useCurrency()
  const queryClient = useQueryClient()
  const withApproval = useManagerApproval()
  const activeMethods = useMemo(() => methods.filter((m) => m.active), [methods])
  const defaultMethod = activeMethods[0]

  const [entries, setEntries] = useState<PaymentEntryDraft[]>(() => [
    {
      id: 1,
      paymentMethodId: defaultMethod?.paymentMethodId ?? 1,
      amountText: toDecimalString(calculated.payableMinor, currency.minorUnits),
      tenderedText: toDecimalString(calculated.payableMinor, currency.minorUnits),
      reference: ''
    }
  ])
  const [nextId, setNextId] = useState(2)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const methodById = useMemo(
    () => new Map(activeMethods.map((m) => [m.paymentMethodId, m])),
    [activeMethods]
  )

  const parsedAmounts = entries.map((entry) => {
    try {
      return Math.max(0, parseMoney(entry.amountText, currency.minorUnits))
    } catch {
      return 0
    }
  })
  const allocatedMinor = parsedAmounts.reduce((sum, n) => sum + n, 0)
  const remainingMinor = calculated.payableMinor - allocatedMinor

  const handleAddSplit = (): void => {
    const fallback =
      activeMethods.find((m) => !entries.some((e) => e.paymentMethodId === m.paymentMethodId)) ??
      defaultMethod
    if (!fallback) return
    const remainder = Math.max(0, remainingMinor)
    const amountStr = toDecimalString(remainder, currency.minorUnits)
    setEntries((prev) => [
      ...prev,
      {
        id: nextId,
        paymentMethodId: fallback.paymentMethodId,
        amountText: amountStr,
        tenderedText: amountStr,
        reference: ''
      }
    ])
    setNextId((n) => n + 1)
  }

  const updateEntry = (id: number, patch: Partial<PaymentEntryDraft>): void => {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
  }

  const removeEntry = (id: number): void => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id))
  }

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)

    const payments: CheckoutPaymentInput[] = []
    if (calculated.payableMinor > 0) {
      for (const [i, entry] of entries.entries()) {
        const resolvedId = entry.paymentMethodId || defaultMethod?.paymentMethodId || 0
        const method = methodById.get(resolvedId)
        if (!method) {
          setError('Choose a payment method')
          return
        }
        let amountMinor: number
        try {
          amountMinor = parseMoney(entry.amountText, currency.minorUnits)
        } catch {
          setError(`Payment #${i + 1}: enter a valid amount`)
          return
        }
        if (amountMinor <= 0) {
          setError(`Payment #${i + 1}: amount must be greater than zero`)
          return
        }

        let tenderedMinor: number | null = null
        if (method.kind === 'cash') {
          const rawTender = entry.tenderedText.trim()
          if (rawTender !== '') {
            try {
              tenderedMinor = parseMoney(rawTender, currency.minorUnits)
            } catch {
              setError(`Payment #${i + 1}: enter a valid cash tendered amount`)
              return
            }
          } else {
            tenderedMinor = amountMinor
          }
          if (tenderedMinor < amountMinor) {
            setError(`Payment #${i + 1}: cash tendered is less than the amount due`)
            return
          }
        }

        payments.push({
          paymentMethodId: method.paymentMethodId,
          amountMinor,
          tenderedMinor,
          reference: entry.reference.trim() ? entry.reference.trim() : null
        })
      }

      const sumPaid = payments.reduce((sum, p) => sum + p.amountMinor, 0)
      if (sumPaid !== calculated.payableMinor) {
        setError(
          `Payments (${formatMoney(sumPaid, currency)}) must equal the bill total (${formatMoney(
            calculated.payableMinor,
            currency
          )})`
        )
        return
      }
    }

    setSubmitting(true)
    try {
      const completed = await withApproval((overrideId) =>
        invoke('sales:checkout', toCheckoutInput(cart, payments, overrideId))
      )
      if (!completed) return
      await refreshSalesAndInventory(queryClient)
      onCompleted(completed)
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Take payment"
      description="Record how the customer is paying. Split across multiple payment methods if needed."
    >
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <TotalDisplay label="Total payable" minor={calculated.payableMinor} />

        {calculated.payableMinor > 0 && (
          <div className="space-y-3">
            {entries.map((entry, index) => {
              const resolvedId = entry.paymentMethodId || defaultMethod?.paymentMethodId || 0
              const method = methodById.get(resolvedId)
              const amountMinor = parsedAmounts[index] ?? 0
              let cashChangeMinor: number | null = null
              if (method?.kind === 'cash') {
                try {
                  const tendered =
                    entry.tenderedText.trim() === ''
                      ? amountMinor
                      : parseMoney(entry.tenderedText, currency.minorUnits)
                  if (tendered >= amountMinor && amountMinor > 0) {
                    cashChangeMinor = planCashTender(amountMinor, tendered).changeMinor
                  }
                } catch {
                  cashChangeMinor = null
                }
              }

              return (
                <div
                  key={entry.id}
                  className="rounded-md border border-border bg-surface-subtle p-3 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-fg">
                      {entries.length === 1 ? 'Payment' : `Split payment #${index + 1}`}
                    </span>
                    {entries.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 />}
                        aria-label={`Remove split payment #${index + 1}`}
                        onClick={() => removeEntry(entry.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Payment method">
                      <Select
                        value={String(resolvedId)}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            paymentMethodId: Number(event.target.value)
                          })
                        }
                        options={activeMethods.map((m) => ({
                          value: String(m.paymentMethodId),
                          label: m.name
                        }))}
                      />
                    </Field>

                    <Field label="Amount">
                      <TextInput
                        value={entry.amountText}
                        onChange={(event) => {
                          const val = event.target.value
                          updateEntry(entry.id, {
                            amountText: val,
                            ...(entry.tenderedText === entry.amountText
                              ? { tenderedText: val }
                              : {})
                          })
                        }}
                        inputMode="decimal"
                        disabled={entries.length === 1}
                      />
                    </Field>
                  </div>

                  {method?.kind === 'cash' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 items-end">
                      <Field label="Cash tendered">
                        <TextInput
                          value={entry.tenderedText}
                          onChange={(event) =>
                            updateEntry(entry.id, { tenderedText: event.target.value })
                          }
                          inputMode="decimal"
                          autoFocus={index === 0}
                        />
                      </Field>
                      <div className="rounded-md border border-border bg-surface px-3 py-2">
                        <div className="text-xs font-medium text-fg-muted">Change to return</div>
                        <div className="text-lg font-bold text-fg">
                          <Money minor={cashChangeMinor ?? 0} />
                        </div>
                      </div>
                    </div>
                  )}

                  {method?.kind === 'upi' && (
                    <Field
                      label="UPI reference (optional)"
                      hint={`${UPI_RECORDED_NOTICE} — check your UPI app or soundbox before completing the bill.`}
                    >
                      <TextInput
                        value={entry.reference}
                        onChange={(event) =>
                          updateEntry(entry.id, { reference: event.target.value })
                        }
                        placeholder="Last 4 digits or UTR reference"
                        maxLength={100}
                        autoFocus={index === 0}
                      />
                    </Field>
                  )}

                  {(method?.kind === 'card' || method?.kind === 'other') && (
                    <Field label="Reference / slip number (optional)">
                      <TextInput
                        value={entry.reference}
                        onChange={(event) =>
                          updateEntry(entry.id, { reference: event.target.value })
                        }
                        placeholder="Approval code or reference"
                        maxLength={100}
                        autoFocus={index === 0}
                      />
                    </Field>
                  )}
                </div>
              )
            })}

            <div className="flex items-center justify-between">
              <Button size="sm" icon={<Plus />} onClick={handleAddSplit}>
                Add split payment
              </Button>
              {entries.length > 1 && (
                <div className="text-sm text-fg-muted">
                  Remaining to allocate:{' '}
                  <strong className={remainingMinor === 0 ? 'text-fg' : 'text-danger'}>
                    <Money minor={remainingMinor} />
                  </strong>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose}>Back to bill</Button>
          <Button type="submit" variant="primary" icon={<Wallet />} loading={submitting}>
            Complete sale
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * M11-06, M13-04: Shown immediately after checkout completes so the cashier
 * sees the invoice number, change due, and receipt preview, and can print or
 * retry printing without losing the saved sale.
 */
export function CompletedSaleDialog({
  sale,
  onDone
}: {
  sale: SaleDetail
  onDone: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)
  const [printedOnce, setPrintedOnce] = useState(false)
  const autoPrintTriggeredRef = useRef(false)

  const printerConfig = useQuery({
    queryKey: ['printers:get-config'],
    queryFn: () => invoke('printers:get-config')
  })

  const preview = useQuery({
    queryKey: ['receipts:preview', sale.saleId, false],
    queryFn: () => invoke('receipts:preview', { saleId: sale.saleId, isReprint: false })
  })

  const handlePrint = useCallback(async (): Promise<void> => {
    setPrintError(null)
    setPrinting(true)
    try {
      await invoke('receipts:print', { saleId: sale.saleId, isReprint: false })
      setPrintedOnce(true)
      toast.success(`Printed receipt for ${sale.invoiceNumber}.`)
    } catch (failure) {
      setPrintError(describeError(failure).message)
    } finally {
      setPrinting(false)
    }
  }, [sale.saleId, sale.invoiceNumber, toast])

  useEffect(() => {
    if (printerConfig.data?.autoPrintReceipt && !autoPrintTriggeredRef.current) {
      autoPrintTriggeredRef.current = true
      void handlePrint()
    }
  }, [printerConfig.data?.autoPrintReceipt, handlePrint])

  return (
    <Dialog
      open
      onClose={onDone}
      size="md"
      title={`Sale completed · ${sale.invoiceNumber}`}
      description="Stock has been updated and the invoice has been recorded."
    >
      <div className="space-y-4">
        <TotalDisplay label="Amount paid" minor={sale.grandTotalMinor} />

        {sale.changeMinor > 0 && (
          <Alert tone="success" title="Change to return to customer">
            <span className="text-lg font-bold">
              <Money minor={sale.changeMinor} />
            </span>{' '}
            (Cash tendered: <Money minor={sale.tenderedMinor} />)
          </Alert>
        )}

        {printError && (
          <Alert tone="warning" title="Sale is saved, but receipt printing failed">
            <div className="space-y-2">
              <p>{printError}</p>
              <Button
                size="sm"
                icon={<RotateCcw />}
                loading={printing}
                onClick={() => void handlePrint()}
              >
                Retry print
              </Button>
            </div>
          </Alert>
        )}

        <div className="rounded-md border border-border p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-fg-muted">Invoice number</span>
            <span className="font-mono font-semibold text-fg">{sale.invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-muted">Items</span>
            <span className="font-medium text-fg">{sale.lines.length}</span>
          </div>
          {sale.payments.map((p) => (
            <div key={p.salePaymentId} className="flex justify-between">
              <span className="text-fg-muted">
                {p.methodName}
                {p.reference ? ` (${p.reference})` : ''}
                {p.verificationNotice ? ` · ${p.verificationNotice}` : ''}
              </span>
              <span className="font-medium text-fg">
                <Money minor={p.amountMinor} />
              </span>
            </div>
          ))}
        </div>

        {preview.data && (
          <details className="rounded-md border border-border bg-surface-subtle p-3 text-xs">
            <summary className="cursor-pointer font-medium text-fg">
              Receipt preview ({preview.data.paperWidthMm} mm)
            </summary>
            <pre
              aria-label="Receipt preview"
              className="mt-2 max-h-56 overflow-y-auto rounded bg-surface p-2 font-mono text-xs leading-snug text-fg"
            >
              {preview.data.lines.join('\n')}
            </pre>
          </details>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button
            icon={<Printer />}
            loading={printing}
            onClick={() => void handlePrint()}
          >
            {printedOnce ? 'Print again' : 'Print receipt'}
          </Button>
          <Button variant="primary" icon={<CheckCircle2 />} onClick={onDone} autoFocus>
            Start next bill
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
