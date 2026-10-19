import { useQuery } from '@tanstack/react-query'
import {
  Minus,
  PauseCircle,
  Percent,
  FolderOpen,
  Plus,
  RotateCcw,
  ScanBarcode,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  Wallet
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { HeldBillDetail, SaleDetail } from '@shared/ipc/contract'
import { discountExceedsLimit, type PricingRules } from '@shared/pricing'
import { formatQuantity, parseQuantity, QUANTITY_SCALE } from '@shared/quantity'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Kbd,
  Money,
  PageHeader,
  TextInput,
  TotalDisplay,
  useConfirm,
  useToast
} from '../components/ui'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'
import { ShortcutScope, useShortcuts } from '../shortcuts/ShortcutProvider'
import {
  BillDiscountDialog,
  CompletedSaleDialog,
  HeldBillsDialog,
  HoldBillDialog,
  LineEditDialog,
  PaymentDialog,
  ProductSearchDialog
} from '../sales/BillingDialogs'
import {
  addItemToCart,
  createEmptyCart,
  priceCart,
  removeLineFromCart,
  resumeHeldBillToCart,
  setBillDiscount,
  updateLinePriceAndDiscount,
  updateLineQuantity,
  type CartLine,
  type CartState
} from '../sales/cart'

type BillingModal =
  | { kind: 'search' }
  | { kind: 'line-edit'; line: CartLine }
  | { kind: 'bill-discount' }
  | { kind: 'hold' }
  | { kind: 'held-list' }
  | { kind: 'payment' }
  | { kind: 'completed'; sale: SaleDetail }
  | null

function formatRatePercent(rateBp: number): string {
  return `${(rateBp / 100).toFixed(rateBp % 100 === 0 ? 0 : 2)}%`
}

/** M11: Point of Sale (Billing) counter screen. */
export default function BillingPage(): React.JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const barcodeInputRef = useRef<HTMLInputElement | null>(null)
  const [cart, setCart] = useState<CartState>(() => createEmptyCart())
  const [barcodeText, setBarcodeText] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [modal, setModal] = useState<BillingModal>(null)

  const pricingSettings = useIpcQuery('pricing:get-settings')
  const taxClasses = useIpcQuery('tax:list-classes')
  const paymentMethods = useIpcQuery('payments:list-methods')
  const heldBills = useQuery({
    queryKey: ['sales:list-held'],
    queryFn: () => invoke('sales:list-held')
  })

  const rules: PricingRules = useMemo(
    () => ({
      pricesIncludeTax: pricingSettings.data?.pricesIncludeTax ?? true,
      regime: pricingSettings.data?.regime ?? 'gst',
      roundingMinor: pricingSettings.data?.roundingMinor ?? 1
    }),
    [pricingSettings.data]
  )

  const maxDiscountBp = pricingSettings.data?.maxDiscountBp ?? 10_000

  const calculated = useMemo(
    () => priceCart(cart, rules, taxClasses.data ?? []),
    [cart, rules, taxClasses.data]
  )

  const afterLineDiscountsMinor = useMemo(
    () =>
      calculated.lines.reduce(
        (sum, line) => sum + (line.grossMinor - line.lineDiscountMinor),
        0
      ),
    [calculated.lines]
  )

  const exceedsDiscountCap =
    cart.lines.length > 0 && discountExceedsLimit(calculated, maxDiscountBp)

  const breakdown = useMemo(() => {
    const rows: { label: string; minor: number }[] = [
      { label: 'Gross amount', minor: calculated.grossMinor }
    ]
    if (calculated.discountMinor > 0) {
      rows.push({ label: 'Discount', minor: -calculated.discountMinor })
    }
    for (const tax of calculated.taxSummary) {
      rows.push({
        label: `${tax.code} ${formatRatePercent(tax.rateBp)}${
          rules.pricesIncludeTax ? ' (incl.)' : ''
        }`,
        minor: tax.amountMinor
      })
    }
    if (calculated.roundOffMinor !== 0) {
      rows.push({ label: 'Round off', minor: calculated.roundOffMinor })
    }
    return rows
  }, [calculated, rules.pricesIncludeTax])

  const handleBarcodeSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const code = barcodeText.trim()
    if (!code) return
    setScanError(null)
    setScanning(true)
    try {
      const found = await invoke('products:find-by-barcode', { barcode: code })
      if (!found) {
        setScanError(`No product matches barcode or SKU “${code}”.`)
        return
      }
      setCart((prev) => addItemToCart(prev, found))
      setBarcodeText('')
      barcodeInputRef.current?.focus()
    } catch (failure) {
      setScanError(describeError(failure).message)
    } finally {
      setScanning(false)
    }
  }

  const handleResumeHeld = (detail: HeldBillDetail): void => {
    setCart(resumeHeldBillToCart(detail))
    setModal(null)
  }

  const handleCancelBill = async (): Promise<void> => {
    if (cart.lines.length === 0) return
    const ok = await confirm({
      title: 'Cancel this bill?',
      description: 'All items and discounts on the current unfinished bill will be cleared.',
      confirmLabel: 'Clear bill',
      tone: 'danger'
    })
    if (!ok) return
    setCart(createEmptyCart())
    toast.info('Current bill cleared.')
    barcodeInputRef.current?.focus()
  }

  const heldCount = heldBills.data?.length ?? 0

  return (
    <ShortcutScope name="Billing">
      <BillingCounterShortcuts
        hasItems={cart.lines.length > 0}
        onOpenModal={setModal}
        onCancelBill={() => void handleCancelBill()}
      />
      <div className="space-y-5">
      <PageHeader
        title="Billing"
        description="Scan a barcode or SKU, adjust quantities or discounts, and take payment."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={<Search />}
              onClick={() => setModal({ kind: 'search' })}
            >
              Find item <Kbd>F4</Kbd>
            </Button>
            <Button
              icon={<FolderOpen />}
              onClick={() => setModal({ kind: 'held-list' })}
            >
              Held bills {heldCount > 0 ? `(${heldCount})` : ''} <Kbd>F8</Kbd>
            </Button>
            <Button
              icon={<RotateCcw />}
              disabled={cart.lines.length === 0}
              onClick={() => void handleCancelBill()}
            >
              Cancel bill <Kbd>F2</Kbd>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left column: Scan bar + Cart lines */}
        <div className="lg:col-span-8 space-y-4">
          <Card>
            <form
              noValidate
              onSubmit={(event) => void handleBarcodeSubmit(event)}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <div className="flex-1">
                <Field label="Scan barcode or enter SKU">
                  <TextInput
                    ref={barcodeInputRef}
                    value={barcodeText}
                    onChange={(event) => {
                      setBarcodeText(event.target.value)
                      if (scanError) setScanError(null)
                    }}
                    placeholder="Scan barcode or type SKU and press Enter…"
                    autoFocus
                  />
                </Field>
              </div>
              <Button
                type="submit"
                variant="primary"
                icon={<ScanBarcode />}
                loading={scanning}
              >
                Add item
              </Button>
            </form>

            {scanError && (
              <div className="mt-3">
                <Alert tone="danger">{scanError}</Alert>
              </div>
            )}
          </Card>

          {cart.lines.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart />}
              title="No items on this bill yet"
              description="Scan a barcode above or press F4 to search for a product."
              action={
                <Button
                  variant="primary"
                  icon={<Search />}
                  onClick={() => setModal({ kind: 'search' })}
                >
                  Find item (F4)
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table
                aria-label="Current bill items"
                className="w-full border-collapse text-left text-base"
              >
                <thead className="border-b border-border bg-surface-subtle text-sm font-medium text-fg-muted">
                  <tr>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-3 py-3">Quantity</th>
                    <th className="px-3 py-3 text-right">Unit price</th>
                    <th className="px-3 py-3 text-right">Discount</th>
                    <th className="px-3 py-3 text-right">Total</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cart.lines.map((line, index) => {
                    const calc = calculated.lines[index]
                    const step = line.item.allowsFraction ? QUANTITY_SCALE : QUANTITY_SCALE
                    const priceOverridden = line.unitPriceMinor !== line.item.sellingPriceMinor
                    return (
                      <CartLineRow
                        key={line.variantId}
                        line={line}
                        lineDiscountMinor={calc?.lineDiscountMinor ?? 0}
                        totalMinor={calc?.totalMinor ?? 0}
                        priceOverridden={priceOverridden}
                        step={step}
                        onQuantityChange={(nextMilli) =>
                          setCart((prev) =>
                            updateLineQuantity(prev, line.variantId, nextMilli)
                          )
                        }
                        onEdit={() => setModal({ kind: 'line-edit', line })}
                        onRemove={() =>
                          setCart((prev) => removeLineFromCart(prev, line.variantId))
                        }
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column: TotalDisplay + Action buttons */}
        <div className="lg:col-span-4 space-y-4">
          <TotalDisplay
            label="Total payable"
            minor={calculated.payableMinor}
            breakdown={breakdown}
          />

          {exceedsDiscountCap && (
            <Alert tone="warning" title="Manager approval needed at checkout">
              Total discount exceeds the cashier limit ({formatRatePercent(maxDiscountBp)}). A
              manager will be asked to approve when you complete the sale.
            </Alert>
          )}

          <Card>
            <div className="space-y-3">
              <Button
                variant="primary"
                className="w-full justify-center py-3 text-lg"
                icon={<Wallet />}
                disabled={cart.lines.length === 0}
                onClick={() => setModal({ kind: 'payment' })}
              >
                Take payment <Kbd>F12</Kbd>
              </Button>

              <div className="grid grid-cols-2 gap-2.5">
                <Button
                  icon={<Percent />}
                  disabled={cart.lines.length === 0}
                  onClick={() => setModal({ kind: 'bill-discount' })}
                >
                  Bill discount <Kbd>F6</Kbd>
                </Button>
                <Button
                  icon={<PauseCircle />}
                  disabled={cart.lines.length === 0}
                  onClick={() => setModal({ kind: 'hold' })}
                >
                  Hold bill <Kbd>F9</Kbd>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {modal?.kind === 'search' && (
        <ProductSearchDialog
          onSelect={(item) => {
            setCart((prev) => addItemToCart(prev, item))
            barcodeInputRef.current?.focus()
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'line-edit' && (
        <LineEditDialog
          line={modal.line}
          onSave={(unitPriceMinor, discount) =>
            setCart((prev) =>
              updateLinePriceAndDiscount(
                prev,
                modal.line.variantId,
                unitPriceMinor,
                discount
              )
            )
          }
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'bill-discount' && (
        <BillDiscountDialog
          current={cart.billDiscount}
          afterLineDiscountsMinor={afterLineDiscountsMinor}
          maxDiscountBp={maxDiscountBp}
          onSave={(discount) => setCart((prev) => setBillDiscount(prev, discount))}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'hold' && (
        <HoldBillDialog
          cart={cart}
          calculated={calculated}
          onHeld={() => {
            setCart(createEmptyCart())
            setModal(null)
            barcodeInputRef.current?.focus()
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'held-list' && (
        <HeldBillsDialog
          onResume={handleResumeHeld}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'payment' && (
        <PaymentDialog
          cart={cart}
          calculated={calculated}
          methods={paymentMethods.data ?? []}
          onCompleted={(sale) => {
            setCart(createEmptyCart())
            setModal({ kind: 'completed', sale })
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'completed' && (
        <CompletedSaleDialog
          sale={modal.sale}
          onDone={() => {
            setModal(null)
            barcodeInputRef.current?.focus()
          }}
        />
      )}
      </div>
    </ShortcutScope>
  )
}

function BillingCounterShortcuts({
  hasItems,
  onOpenModal,
  onCancelBill
}: {
  hasItems: boolean
  onOpenModal: (modal: BillingModal) => void
  onCancelBill: () => void
}): null {
  useShortcuts([
    {
      combo: 'F2',
      description: 'Cancel current bill',
      enabled: hasItems,
      handler: onCancelBill
    },
    {
      combo: 'F4',
      description: 'Find item to add to bill',
      handler: () => onOpenModal({ kind: 'search' })
    },
    {
      combo: 'F6',
      description: 'Bill discount',
      enabled: hasItems,
      handler: () => onOpenModal({ kind: 'bill-discount' })
    },
    {
      combo: 'F8',
      description: 'Held bills',
      handler: () => onOpenModal({ kind: 'held-list' })
    },
    {
      combo: 'F9',
      description: 'Hold current bill',
      enabled: hasItems,
      handler: () => onOpenModal({ kind: 'hold' })
    },
    {
      combo: 'F12',
      description: 'Take payment',
      enabled: hasItems,
      handler: () => onOpenModal({ kind: 'payment' })
    }
  ])
  return null
}

function CartLineRow({
  line,
  lineDiscountMinor,
  totalMinor,
  priceOverridden,
  step,
  onQuantityChange,
  onEdit,
  onRemove
}: {
  line: CartLine
  lineDiscountMinor: number
  totalMinor: number
  priceOverridden: boolean
  step: number
  onQuantityChange: (nextMilli: number) => void
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  const [draftQty, setDraftQty] = useState<string | null>(null)
  const qtyText = draftQty ?? formatQuantity(line.quantityMilli)

  const commitQty = (raw: string): void => {
    setDraftQty(null)
    try {
      const parsed = parseQuantity(raw, { allowsFraction: line.item.allowsFraction })
      if (parsed > 0) {
        onQuantityChange(parsed)
      }
    } catch {
      // Fall back to current quantity on invalid input
    }
  }

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium text-fg">{line.item.name}</div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <span className="font-mono">{line.item.sku}</span>
          {line.item.tracksInventory && line.item.onHandMilli !== null && (
            <Badge tone={line.item.onHandMilli < line.quantityMilli ? 'warning' : 'neutral'}>
              {`Stock: ${formatQuantity(line.item.onHandMilli)} ${line.item.unitCode}`}
            </Badge>
          )}
        </div>
      </td>

      <td className="px-3 py-3">
        <div className="inline-flex items-center gap-1.5">
          <Button
            size="sm"
            icon={<Minus />}
            aria-label={`Decrease quantity of ${line.item.name}`}
            onClick={() => onQuantityChange(line.quantityMilli - step)}
          />
          <TextInput
            aria-label={`Quantity of ${line.item.name}`}
            value={qtyText}
            onChange={(event) => setDraftQty(event.target.value)}
            onBlur={() => commitQty(qtyText)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitQty(qtyText)
              }
            }}
            className="w-20 text-center"
            inputMode="decimal"
          />
          <Button
            size="sm"
            icon={<Plus />}
            aria-label={`Increase quantity of ${line.item.name}`}
            onClick={() => onQuantityChange(line.quantityMilli + step)}
          />
        </div>
      </td>

      <td className="px-3 py-3 text-right">
        <div className="font-medium text-fg">
          <Money minor={line.unitPriceMinor} />
        </div>
        {priceOverridden && (
          <div className="text-xs text-warning">Overridden</div>
        )}
      </td>

      <td className="px-3 py-3 text-right">
        {lineDiscountMinor > 0 ? (
          <span className="font-medium text-fg">
            -<Money minor={lineDiscountMinor} />
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>

      <td className="px-3 py-3 text-right font-semibold text-fg">
        <Money minor={totalMinor} />
      </td>

      <td className="px-3 py-3 text-right">
        <div className="inline-flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<SlidersHorizontal />}
            aria-label={`Edit ${line.item.name}`}
            onClick={onEdit}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 />}
            aria-label={`Remove ${line.item.name}`}
            onClick={onRemove}
          />
        </div>
      </td>
    </tr>
  )
}
