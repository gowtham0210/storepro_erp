import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Split, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReturnableLine, ReturnableSale, ReturnDetail } from '@shared/ipc/contract'
import { formatMoney, parseMoney, toDecimalString } from '@shared/money'
import { formatQuantity, parseQuantity } from '@shared/quantity'
import {
  checkRefunds,
  quoteReturn,
  RETURN_DISPOSITION_LABELS,
  RETURN_DISPOSITIONS,
  ReturnError,
  type ReturnDisposition,
  type ReturnLineRequest
} from '@shared/returns'
import { formatStoreTime } from '@shared/storeTime'
import { useManagerApproval } from '../auth/ManagerApproval'
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Field,
  Money,
  NumberInput,
  Select,
  Spinner,
  TextInput,
  useCurrency,
  useToast
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError, fieldErrorsFrom } from '../lib/describeError'
import { useStoreTimeZone } from '../store/storeContext'
import { refreshReturns } from './refresh'

interface ReturnRow {
  key: number
  saleItemId: number
  quantityText: string
  disposition: ReturnDisposition
}

interface RefundRow {
  key: number
  methodId: string
  amountText: string
  reference: string
}

const DISPOSITION_OPTIONS = RETURN_DISPOSITIONS.map((d) => ({
  value: d,
  label: RETURN_DISPOSITION_LABELS[d]
}))

/**
 * M16-01 to M16-04: take a return against an invoice. Choose how much of each
 * line comes back and what happens to the goods, see what is due, and record
 * how it is refunded. A cashier is asked for a manager's approval when saving.
 */
export function NewReturnDialog({
  initialInvoiceNumber,
  onClose,
  onDone
}: {
  initialInvoiceNumber?: string | undefined
  onClose: () => void
  onDone: (made: ReturnDetail) => void
}): React.JSX.Element {
  const { minorUnits, currencyCode } = useCurrency()
  const currency = useMemo(() => ({ currencyCode, minorUnits }), [currencyCode, minorUnits])
  const timeZone = useStoreTimeZone()
  const queryClient = useQueryClient()
  const toast = useToast()
  const withApproval = useManagerApproval()
  const methods = useQuery({
    queryKey: ['payments:list-methods'],
    queryFn: () => invoke('payments:list-methods')
  })

  const [invoiceText, setInvoiceText] = useState(initialInvoiceNumber ?? '')
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [sale, setSale] = useState<ReturnableSale | null>(null)

  const nextKey = useRef(1)
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [reason, setReason] = useState('')
  // null means "refund everything in one go the way the customer paid", until the person edits it.
  const [refunds, setRefunds] = useState<RefundRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const find = async (text: string): Promise<void> => {
    const invoiceNumber = text.trim()
    if (invoiceNumber === '') {
      setLookupError('Enter an invoice number')
      return
    }
    setLooking(true)
    setLookupError(null)
    try {
      const found = await invoke('returns:find-sale', { invoiceNumber })
      if (!found) {
        setLookupError(`No invoice ${invoiceNumber} was found.`)
        return
      }
      setSale(found)
      setRows(
        found.lines.map((line) => ({
          key: nextKey.current++,
          saleItemId: line.saleItemId,
          quantityText: '',
          disposition: 'restock'
        }))
      )
      setRefunds(null)
      setError(null)
    } catch (failure) {
      setLookupError(describeError(failure).message)
    } finally {
      setLooking(false)
    }
  }

  const initial = useRef(initialInvoiceNumber)
  useEffect(() => {
    if (initial.current) void find(initial.current)
  }, [])

  // ---- What the rows come to, using the same calculation as the main process ----
  const lineOf = (saleItemId: number): ReturnableLine | undefined =>
    sale?.lines.find((l) => l.saleItemId === saleItemId)

  const analysis = useMemo(() => {
    const rowErrors = new Map<number, string>()
    const requests: ReturnLineRequest[] = []
    const requestRows: ReturnRow[] = []
    if (sale) {
      for (const row of rows) {
        const line = sale.lines.find((l) => l.saleItemId === row.saleItemId)
        const text = row.quantityText.trim()
        if (!line || text === '' || Number(text) === 0) continue
        try {
          const quantityMilli = parseQuantity(text, { allowsFraction: line.allowsFraction })
          requests.push({
            saleItemId: row.saleItemId,
            quantityMilli,
            disposition: row.disposition
          })
          requestRows.push(row)
        } catch (failure) {
          rowErrors.set(
            row.key,
            failure instanceof RangeError ? failure.message : 'Enter a quantity'
          )
        }
      }
    }
    if (!sale || requests.length === 0) {
      return { requests, requestRows, rowErrors, quote: null }
    }
    try {
      const quote = quoteReturn(
        sale.lines.map((l) => ({
          saleItemId: l.saleItemId,
          soldMilli: l.soldMilli,
          netMinor: l.netMinor,
          taxes: l.taxes,
          priorReturnedMilli: l.returnedMilli
        })),
        requests,
        sale.pricesIncludeTax
      )
      return { requests, requestRows, rowErrors, quote }
    } catch (failure) {
      if (failure instanceof ReturnError) {
        const row = failure.line === null ? undefined : requestRows[failure.line]
        if (row) rowErrors.set(row.key, failure.message)
        return { requests, requestRows, rowErrors, quote: null, quoteError: failure.message }
      }
      throw failure
    }
  }, [rows, sale])

  const dueMinor = analysis.quote?.refundDueMinor ?? 0
  const activeMethods = (methods.data ?? []).filter((m) => m.active)
  const defaultMethodId = useMemo(() => {
    const paidBy = sale?.payments.find((p) =>
      activeMethods.some((m) => m.paymentMethodId === p.paymentMethodId)
    )
    const cash = activeMethods.find((m) => m.kind === 'cash')
    return String(
      paidBy?.paymentMethodId ?? cash?.paymentMethodId ?? activeMethods[0]?.paymentMethodId ?? ''
    )
  }, [sale, activeMethods])

  const refundRows: RefundRow[] =
    refunds ??
    (dueMinor > 0
      ? [
          {
            key: 0,
            methodId: defaultMethodId,
            amountText: toDecimalString(dueMinor, minorUnits),
            reference: ''
          }
        ]
      : [])

  const parsedRefunds = refundRows.map((row) => {
    try {
      return {
        row,
        amountMinor: row.amountText.trim() === '' ? 0 : parseMoney(row.amountText, minorUnits)
      }
    } catch {
      return { row, amountMinor: 0, invalid: true }
    }
  })
  const { remainingMinor } = checkRefunds(dueMinor, parsedRefunds)

  const updateRow = (key: number, patch: Partial<ReturnRow>): void => {
    setFieldErrors({})
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  const editRefunds = (change: (current: RefundRow[]) => RefundRow[]): void => {
    setRefunds(change(refundRows))
  }

  const submit = async (): Promise<void> => {
    if (!sale) return
    setError(null)
    setFieldErrors({})
    if (analysis.rowErrors.size > 0 || analysis.requests.length === 0 || !analysis.quote) {
      setError(
        analysis.requests.length === 0
          ? 'Enter how much of at least one item is coming back.'
          : 'Fix the items marked below.'
      )
      return
    }
    if (parsedRefunds.some((r) => 'invalid' in r)) {
      setFieldErrors({ refunds: 'Enter each refund as an amount, like 120.50' })
      return
    }
    if (remainingMinor !== 0) {
      setFieldErrors({
        refunds:
          remainingMinor > 0
            ? `${formatMoney(remainingMinor, currency)} is still to be refunded.`
            : `The refunds are ${formatMoney(-remainingMinor, currency)} more than is due.`
      })
      return
    }
    setSaving(true)
    try {
      const made = await withApproval((overrideId) =>
        invoke('returns:create', {
          saleId: sale.saleId,
          reason: reason.trim() === '' ? null : reason.trim(),
          lines: analysis.requests,
          refunds: parsedRefunds.map(({ row, amountMinor }) => ({
            paymentMethodId: Number(row.methodId),
            amountMinor,
            reference: row.reference.trim() === '' ? null : row.reference.trim()
          })),
          ...(overrideId === undefined ? {} : { overrideId })
        })
      )
      if (!made) return
      toast.success(`Return ${made.returnNumber} was recorded.`)
      await refreshReturns(queryClient)
      onDone(made)
    } catch (failure) {
      const fields = fieldErrorsFrom(failure)
      if (fields && Object.keys(fields).length > 0) setFieldErrors(fields)
      setError(describeError(failure).message)
    } finally {
      setSaving(false)
    }
  }

  const creditFor = (row: ReturnRow): number | null => {
    const index = analysis.requestRows.findIndex((r) => r.key === row.key)
    return analysis.quote && index >= 0 ? (analysis.quote.lines[index]?.creditMinor ?? null) : null
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Take a return"
      description="Find the invoice, choose what is coming back and what happens to it, then record the refund."
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {sale && !sale.isVoided && (
            <Button
              variant="primary"
              loading={saving}
              disabled={analysis.quote === null}
              onClick={() => void submit()}
            >
              Record return and refund
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void find(invoiceText)
          }}
          className="flex items-start gap-2"
        >
          <Field label="Invoice number" error={lookupError} className="flex-1">
            <TextInput
              value={invoiceText}
              autoFocus={!initialInvoiceNumber}
              placeholder="INV000123"
              onChange={(event) => setInvoiceText(event.target.value)}
            />
          </Field>
          <Button type="submit" icon={<Search />} loading={looking} className="mt-6">
            Find invoice
          </Button>
        </form>

        {looking && !sale && <Spinner label="Looking up the invoice" />}

        {sale && (
          <>
            <div className="rounded-md border border-border-subtle bg-surface-raised p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-mono font-semibold">{sale.invoiceNumber}</span>
                <span className="text-fg-muted">{formatStoreTime(sale.completedAt, timeZone)}</span>
                {sale.customerName && <span>{sale.customerName}</span>}
                {sale.isVoided && <Badge tone="danger">Voided</Badge>}
              </div>
              <p className="mt-1 text-sm text-fg-muted">
                Paid by{' '}
                {sale.payments.map((p) => p.methodName).join(' and ') || 'no recorded payment'}.
                {sale.returns.length > 0 &&
                  ` Earlier returns: ${sale.returns.map((r) => r.returnNumber).join(', ')}.`}
              </p>
            </div>

            {sale.isVoided ? (
              <Alert tone="danger" title="This invoice was voided">
                Nothing can be returned against a voided invoice.
              </Alert>
            ) : sale.lines.every((l) => l.returnableMilli === 0) ? (
              <Alert tone="info" title="Everything on this invoice has already been returned" />
            ) : (
              <>
                {error && <Alert tone="danger">{error}</Alert>}
                <div className="space-y-3">
                  {rows.map((row, index) => {
                    const line = lineOf(row.saleItemId)
                    if (!line) return null
                    const isFirst = rows.findIndex((r) => r.saleItemId === row.saleItemId) === index
                    const credit = creditFor(row)
                    const message = analysis.rowErrors.get(row.key)
                    return (
                      <div
                        key={row.key}
                        className="space-y-2 rounded-md border border-border-subtle p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{line.description}</div>
                            <div className="text-sm text-fg-muted">
                              Sold {formatQuantity(line.soldMilli)} {line.unitCode}
                              {line.returnedMilli > 0 &&
                                `, already returned ${formatQuantity(line.returnedMilli)}`}
                              {' · '}
                              {formatQuantity(line.returnableMilli)} can come back
                            </div>
                          </div>
                          <span className="inline-flex gap-1">
                            {isFirst && line.returnableMilli > 1 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Split />}
                                aria-label={`Split ${line.description} into another row`}
                                onClick={() =>
                                  setRows((current) => {
                                    const at = current
                                      .map((r) => r.saleItemId)
                                      .lastIndexOf(row.saleItemId)
                                    const copy = [...current]
                                    copy.splice(at + 1, 0, {
                                      key: nextKey.current++,
                                      saleItemId: row.saleItemId,
                                      quantityText: '',
                                      disposition: 'write_off'
                                    })
                                    return copy
                                  })
                                }
                              >
                                Split
                              </Button>
                            )}
                            {!isFirst && (
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Trash2 />}
                                aria-label={`Remove this row for ${line.description}`}
                                onClick={() =>
                                  setRows((current) => current.filter((r) => r.key !== row.key))
                                }
                              />
                            )}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
                          <Field label={`Quantity returned (${line.unitCode})`} error={message}>
                            <NumberInput
                              value={row.quantityText}
                              disabled={line.returnableMilli === 0}
                              onValueChange={(value) => updateRow(row.key, { quantityText: value })}
                              decimals={line.allowsFraction ? 3 : 0}
                              inputMode="decimal"
                              aria-label={`Quantity of ${line.description} to return${isFirst ? '' : ' (another row)'}`}
                            />
                          </Field>
                          <Field label="The goods">
                            <Select
                              value={row.disposition}
                              onChange={(event) =>
                                updateRow(row.key, {
                                  disposition: event.target.value as ReturnDisposition
                                })
                              }
                              options={DISPOSITION_OPTIONS}
                              aria-label={`What happens to ${line.description}${isFirst ? '' : ' (another row)'}`}
                            />
                          </Field>
                          <div className="pb-2 text-right">
                            <div className="text-sm text-fg-muted">Credit</div>
                            {credit === null ? (
                              <span className="text-fg-muted">–</span>
                            ) : (
                              <Money minor={credit} className="font-medium" />
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <Field label="Reason" hint="Optional">
                  <TextInput
                    value={reason}
                    maxLength={200}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>

                <section
                  aria-label="Refund"
                  className="space-y-3 rounded-md border border-border-subtle p-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-medium">Refund to the customer</h3>
                    <p className="text-lg" role="status">
                      Due <Money minor={dueMinor} className="font-semibold" />
                      {sale.pricesIncludeTax || analysis.quote === null ? null : (
                        <span className="text-sm text-fg-muted">
                          {' '}
                          (includes {formatMoney(analysis.quote.taxMinor, currency)} tax)
                        </span>
                      )}
                    </p>
                  </div>
                  {dueMinor === 0 ? (
                    <p className="text-sm text-fg-muted">
                      Enter the quantity coming back to see what is due.
                    </p>
                  ) : (
                    <>
                      {refundRows.map((row, index) => {
                        const kind = activeMethods.find(
                          (m) => String(m.paymentMethodId) === row.methodId
                        )?.kind
                        return (
                          <div
                            key={row.key}
                            className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_2fr_auto]"
                          >
                            <Field label="Refund by">
                              <Select
                                value={row.methodId}
                                onChange={(event) =>
                                  editRefunds((current) =>
                                    current.map((r) =>
                                      r.key === row.key ? { ...r, methodId: event.target.value } : r
                                    )
                                  )
                                }
                                options={activeMethods.map((m) => ({
                                  value: String(m.paymentMethodId),
                                  label: m.name
                                }))}
                                aria-label={`Refund method ${index + 1}`}
                              />
                            </Field>
                            <Field label="Amount">
                              <NumberInput
                                value={row.amountText}
                                decimals={minorUnits}
                                inputMode="decimal"
                                onValueChange={(value) =>
                                  editRefunds((current) =>
                                    current.map((r) =>
                                      r.key === row.key ? { ...r, amountText: value } : r
                                    )
                                  )
                                }
                                aria-label={`Refund amount ${index + 1}`}
                              />
                            </Field>
                            {kind === 'upi' ? (
                              <Field label="UPI reference (optional)">
                                <TextInput
                                  value={row.reference}
                                  maxLength={60}
                                  onChange={(event) =>
                                    editRefunds((current) =>
                                      current.map((r) =>
                                        r.key === row.key
                                          ? { ...r, reference: event.target.value }
                                          : r
                                      )
                                    )
                                  }
                                />
                              </Field>
                            ) : (
                              <span />
                            )}
                            {refundRows.length > 1 ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Trash2 />}
                                aria-label={`Remove refund method ${index + 1}`}
                                onClick={() =>
                                  editRefunds((current) => current.filter((r) => r.key !== row.key))
                                }
                              />
                            ) : (
                              <span />
                            )}
                          </div>
                        )
                      })}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Button
                          size="sm"
                          icon={<Plus />}
                          onClick={() =>
                            editRefunds((current) => [
                              ...current,
                              {
                                key: nextKey.current++,
                                methodId: defaultMethodId,
                                amountText:
                                  remainingMinor > 0
                                    ? toDecimalString(remainingMinor, minorUnits)
                                    : '',
                                reference: ''
                              }
                            ])
                          }
                        >
                          Refund part another way
                        </Button>
                        <p
                          className={
                            remainingMinor === 0 ? 'text-fg-muted' : 'font-medium text-danger'
                          }
                          role="status"
                        >
                          {remainingMinor === 0
                            ? 'The refund adds up.'
                            : remainingMinor > 0
                              ? `${formatMoney(remainingMinor, currency)} still to refund`
                              : `${formatMoney(-remainingMinor, currency)} too much`}
                        </p>
                      </div>
                    </>
                  )}
                  {fieldErrors.refunds && <Alert tone="danger">{fieldErrors.refunds}</Alert>}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
