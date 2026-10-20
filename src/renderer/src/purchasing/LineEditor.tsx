import { useQuery } from '@tanstack/react-query'
import { Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ItemLookup, PurchaseLineInput } from '@shared/ipc/contract'
import { fieldErrorsFrom } from '../lib/describeError'
import { multiplyByQuantity, parseMoney, toDecimalString } from '@shared/money'
import { formatQuantity, parseQuantity } from '@shared/quantity'
import { Button, Field, Money, NumberInput, TextInput, useCurrency } from '../components/ui'
import { invoke } from '../ipc/client'
import { useSettled } from '../lib/useSettled'

/** One line of a purchase document as it is being typed. */
export interface DraftLine {
  variantId: number
  name: string
  sku: string
  unitCode: string
  allowsFraction: boolean
  quantityText: string
  costText: string
  error?: string | undefined
}

export interface LineItemInfo {
  variantId: number
  name: string
  sku: string
  unitCode: string
  allowsFraction: boolean
}

export function newDraftLine(
  item: LineItemInfo,
  minorUnits: number,
  quantityMilli?: number,
  unitCostMinor?: number | null
): DraftLine {
  return {
    variantId: item.variantId,
    name: item.name,
    sku: item.sku,
    unitCode: item.unitCode,
    allowsFraction: item.allowsFraction,
    quantityText: quantityMilli === undefined ? '' : formatQuantity(quantityMilli),
    costText:
      unitCostMinor === undefined || unitCostMinor === null
        ? ''
        : toDecimalString(unitCostMinor, minorUnits)
  }
}

type Parsed =
  { ok: true; quantityMilli: number; unitCostMinor: number } | { ok: false; error: string }

function parseLine(line: DraftLine, minorUnits: number): Parsed {
  let quantityMilli: number
  try {
    if (line.quantityText.trim() === '') return { ok: false, error: 'Enter a quantity' }
    quantityMilli = parseQuantity(line.quantityText, { allowsFraction: line.allowsFraction })
  } catch (error) {
    return {
      ok: false,
      error: error instanceof RangeError ? error.message : 'Enter a valid quantity'
    }
  }
  try {
    if (line.costText.trim() === '') return { ok: false, error: 'Enter the cost per unit' }
    const unitCostMinor = parseMoney(line.costText, minorUnits)
    if (unitCostMinor < 0) return { ok: false, error: "Cost can't be negative" }
    return { ok: true, quantityMilli, unitCostMinor }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof RangeError ? error.message : 'Enter a valid cost'
    }
  }
}

/** Every line as the main process expects it, or the lines marked with what to fix. */
export function parseLines(
  lines: readonly DraftLine[],
  minorUnits: number
): { ok: true; lines: PurchaseLineInput[] } | { ok: false; lines: DraftLine[] } {
  const parsed = lines.map((line) => parseLine(line, minorUnits))
  if (parsed.every((p) => p.ok)) {
    return {
      ok: true,
      lines: lines.map((line, index) => {
        const p = parsed[index]
        if (!p?.ok) throw new Error('unreachable')
        return {
          variantId: line.variantId,
          quantityMilli: p.quantityMilli,
          unitCostMinor: p.unitCostMinor
        }
      })
    }
  }
  return {
    ok: false,
    lines: lines.map((line, index) => {
      const p = parsed[index]
      return { ...line, error: p && !p.ok ? p.error : undefined }
    })
  }
}

/** Marks lines with the line-level errors a failed save reported (`lines.N.field`). */
export function withServerLineErrors(lines: readonly DraftLine[], failure: unknown): DraftLine[] {
  const found = fieldErrorsFrom(failure) ?? {}
  return lines.map((line, index) => {
    const message = Object.entries(found).find(([path]) => path.startsWith(`lines.${index}.`))?.[1]
    return message ? { ...line, error: message } : line
  })
}

/** Total of the lines that are filled in correctly so far. */
export function draftTotal(lines: readonly DraftLine[], minorUnits: number): number {
  return lines.reduce((sum, line) => {
    const p = parseLine(line, minorUnits)
    return p.ok ? sum + multiplyByQuantity(p.unitCostMinor, p.quantityMilli) : sum
  }, 0)
}

/** Find an item by name, SKU or barcode and pick it. Only active, stock-tracked items can be bought. */
export function ItemPicker({
  excluded,
  onPick,
  label = 'Add an item'
}: {
  excluded: ReadonlySet<number>
  onPick: (item: ItemLookup) => void
  label?: string
}): React.JSX.Element {
  const [text, setText] = useState('')
  const query = useSettled(text.trim())
  const results = useQuery({
    queryKey: ['products:search', 'purchasing', query],
    queryFn: () => invoke('products:search', { query, limit: 12 }),
    enabled: query.length > 0
  })
  const choices = (results.data ?? []).filter((item) => item.tracksInventory)
  const available = choices.filter((item) => !excluded.has(item.variantId))

  const pick = (item: ItemLookup): void => {
    onPick(item)
    setText('')
  }

  return (
    <div>
      <Field label={label} hint="Search by name, SKU or scan a barcode, then press Enter">
        <TextInput
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const first = available[0]
            if (first) pick(first)
          }}
        />
      </Field>
      {query.length > 0 && !results.isPending && (
        <ul
          aria-label="Matching items"
          className="mt-1 max-h-48 divide-y divide-border-subtle overflow-auto rounded-md border border-border-subtle"
        >
          {available.length === 0 ? (
            <li className="px-3 py-2 text-sm text-fg-muted">
              {choices.length > 0
                ? 'Those items are already on this document.'
                : 'No stock-tracked items match.'}
            </li>
          ) : (
            available.map((item) => (
              <li key={item.variantId}>
                <button
                  type="button"
                  onClick={() => pick(item)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted"
                >
                  <span>
                    <Search aria-hidden className="mr-2 inline size-4 text-fg-subtle" />
                    {item.name}
                    <span className="ml-2 text-sm text-fg-muted">{item.sku}</span>
                  </span>
                  <span className="text-sm text-fg-muted">
                    {item.onHandMilli === null
                      ? ''
                      : `${formatQuantity(item.onHandMilli)} ${item.unitCode} in stock`}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

/** The lines of a purchase document: quantity and cost per unit for each item. */
export function LineEditor({
  lines,
  onChange,
  allowRemove = true
}: {
  lines: readonly DraftLine[]
  onChange: (lines: DraftLine[]) => void
  allowRemove?: boolean
}): React.JSX.Element {
  const { minorUnits } = useCurrency()
  const update = (variantId: number, patch: Partial<DraftLine>): void =>
    onChange(
      lines.map((line) =>
        line.variantId === variantId ? { ...line, ...patch, error: undefined } : line
      )
    )

  if (lines.length === 0) {
    return <p className="text-sm text-fg-muted">No items yet. Search above to add one.</p>
  }
  return (
    <div className="space-y-3">
      {lines.map((line) => {
        const parsed = parseLine(line, minorUnits)
        return (
          <div
            key={line.variantId}
            className="space-y-2 rounded-md border border-border-subtle bg-surface-raised p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{line.name}</div>
                <div className="text-sm text-fg-muted">{line.sku}</div>
              </div>
              {allowRemove && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 />}
                  aria-label={`Remove ${line.name}`}
                  onClick={() => onChange(lines.filter((l) => l.variantId !== line.variantId))}
                />
              )}
            </div>
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={`Quantity (${line.unitCode})`} error={line.error}>
                <NumberInput
                  value={line.quantityText}
                  onValueChange={(value) => update(line.variantId, { quantityText: value })}
                  decimals={line.allowsFraction ? 3 : 0}
                  suffix={line.unitCode}
                  inputMode="decimal"
                />
              </Field>
              <Field label={`Cost per ${line.unitCode}`}>
                <NumberInput
                  value={line.costText}
                  onValueChange={(value) => update(line.variantId, { costText: value })}
                  decimals={minorUnits}
                  inputMode="decimal"
                />
              </Field>
              <div className="pb-2 text-right">
                <div className="text-sm text-fg-muted">Line total</div>
                {parsed.ok ? (
                  <Money
                    minor={multiplyByQuantity(parsed.unitCostMinor, parsed.quantityMilli)}
                    className="font-medium"
                  />
                ) : (
                  <span className="text-fg-muted">–</span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
