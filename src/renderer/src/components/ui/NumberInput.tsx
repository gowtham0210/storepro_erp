import { Minus, Plus } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import { cx } from '../../lib/cx'
import { controlClasses } from './Field'

export interface NumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'prefix' | 'step'
> {
  /** The text as typed. Parsing (to minor units or thousandths) happens in the form schema. */
  value: string
  onValueChange: (value: string) => void
  /** Maximum digits after the decimal point; 0 for whole numbers. */
  decimals?: number
  allowNegative?: boolean
  /** Shown inside the field, e.g. "₹" or "kg". */
  prefix?: string
  suffix?: string
  /** Enables ArrowUp/ArrowDown and +/− buttons that change the value by this amount. */
  step?: number
  min?: number
}

/** Accept only characters that can form a valid number, so typing errors are prevented, not reported. */
export function sanitizeNumberText(
  text: string,
  decimals: number,
  allowNegative: boolean
): string | null {
  const pattern = new RegExp(
    `^${allowNegative ? '-?' : ''}\\d*${decimals > 0 ? `(\\.\\d{0,${decimals}})?` : ''}$`
  )
  const normalised = text.replace(/,/g, '')
  return pattern.test(normalised) ? normalised : null
}

export function stepValue(
  text: string,
  delta: number,
  decimals: number,
  min: number | undefined
): string {
  const current = Number(text || '0')
  if (!Number.isFinite(current)) return text
  const scale = 10 ** decimals
  let next = Math.round((current + delta) * scale) / scale
  if (min !== undefined && next < min) next = min
  if (decimals === 0) return String(next)
  // Drop trailing zeros after the decimal point only: 2.500 -> 2.5, 3.000 -> 3.
  return next
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
}

/**
 * Numeric entry as text: right-aligned tabular digits, a decimal keypad on
 * touch screens, and the whole value selected on focus so it can be typed over.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  {
    value,
    onValueChange,
    decimals = 0,
    allowNegative = false,
    prefix,
    suffix,
    step,
    min,
    className,
    onKeyDown,
    onFocus,
    disabled,
    ...rest
  },
  ref
) {
  const change = (next: string): void => {
    const clean = sanitizeNumberText(next, decimals, allowNegative)
    if (clean !== null) onValueChange(clean)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (step !== undefined && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      onValueChange(stepValue(value, event.key === 'ArrowUp' ? step : -step, decimals, min))
    }
    onKeyDown?.(event)
  }

  const input = (
    <div className="relative flex-1">
      {prefix && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
        >
          {prefix}
        </span>
      )}
      <input
        ref={ref}
        type="text"
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          event.target.select()
          onFocus?.(event)
        }}
        className={cx(
          controlClasses,
          'text-right tabular',
          prefix && 'pl-8',
          suffix && 'pr-10',
          className
        )}
        data-autofocus={rest.autoFocus ? '' : undefined}
        {...rest}
      />
      {suffix && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-fg-muted"
        >
          {suffix}
        </span>
      )}
    </div>
  )

  if (step === undefined) return input
  // Large +/− targets for touch screens; skipped in tab order because arrow keys do the same.
  return (
    <div className="flex items-stretch gap-1">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Decrease"
        disabled={disabled}
        onClick={() => onValueChange(stepValue(value, -step, decimals, min))}
        className="flex w-10 items-center justify-center rounded-md border border-input bg-surface hover:bg-surface-muted disabled:opacity-50"
      >
        <Minus aria-hidden className="size-4" />
      </button>
      {input}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Increase"
        disabled={disabled}
        onClick={() => onValueChange(stepValue(value, step, decimals, min))}
        className="flex w-10 items-center justify-center rounded-md border border-input bg-surface hover:bg-surface-muted disabled:opacity-50"
      >
        <Plus aria-hidden className="size-4" />
      </button>
    </div>
  )
})
