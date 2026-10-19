import { createContext, useContext } from 'react'
import { formatMoney, type CurrencyFormat } from '@shared/money'
import { formatQuantity } from '@shared/quantity'
import { cx } from '../../lib/cx'

const DEFAULT_CURRENCY: CurrencyFormat = { currencyCode: 'INR', minorUnits: 2 }

/** The store's currency. Provided from the business profile once M03 exists; INR until then. */
export const CurrencyContext = createContext<CurrencyFormat>(DEFAULT_CURRENCY)

export function useCurrency(): CurrencyFormat {
  return useContext(CurrencyContext)
}

interface MoneyProps {
  minor: number
  className?: string
}

/** An amount in minor units, formatted for the store's currency with aligned (tabular) digits. */
export function Money({ minor, className }: MoneyProps): React.JSX.Element {
  const currency = useCurrency()
  return (
    <span className={cx('tabular whitespace-nowrap', className)}>
      {formatMoney(minor, currency)}
    </span>
  )
}

export function Quantity({
  milli,
  unit,
  className
}: {
  milli: number
  unit?: string
  className?: string
}): React.JSX.Element {
  return (
    <span className={cx('tabular whitespace-nowrap', className)}>
      {formatQuantity(milli)}
      {unit && <span className="text-fg-muted"> {unit}</span>}
    </span>
  )
}

interface TotalDisplayProps {
  label: string
  minor: number
  /** Secondary lines above the total, e.g. subtotal, discount, tax. */
  breakdown?: { label: string; minor: number }[]
  className?: string
}

/**
 * The amount the customer pays, as the most prominent element on the screen
 * (PRD §10.3). White on navy at display size; readable from across a counter.
 */
export function TotalDisplay({
  label,
  minor,
  breakdown,
  className
}: TotalDisplayProps): React.JSX.Element {
  return (
    <section
      aria-label={label}
      className={cx('on-dark rounded-lg bg-nav p-5 text-fg-inverse', className)}
    >
      {breakdown && breakdown.length > 0 && (
        <dl className="mb-3 space-y-1 border-b border-nav-divider pb-3 text-base">
          {breakdown.map((row) => (
            <div key={row.label} className="flex justify-between gap-4 text-nav-fg">
              <dt>{row.label}</dt>
              <dd>
                <Money minor={row.minor} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-lg font-medium text-nav-fg">{label}</span>
        <Money minor={minor} className="text-display font-bold" />
      </div>
    </section>
  )
}
