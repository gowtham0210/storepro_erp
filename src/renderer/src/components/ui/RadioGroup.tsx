import { useId, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { FieldError } from './Field'

export interface RadioOption {
  value: string
  label: string
  /** One line saying what the choice means. */
  description?: string | undefined
  disabled?: boolean
}

interface RadioGroupProps {
  /** The question, e.g. "Is the store registered for GST?". */
  legend: string
  name: string
  value: string
  options: readonly RadioOption[]
  onChange: (value: string) => void
  hint?: ReactNode
  error?: string | undefined
  /** Lay the options side by side (short options only). */
  inline?: boolean
}

/**
 * A choice between a few spelled-out options, as native radio buttons in a
 * fieldset: arrow keys move between them, and screen readers announce the
 * question with each one. Prefer it over a checkbox when "off" needs words too.
 */
export function RadioGroup({
  legend,
  name,
  value,
  options,
  onChange,
  hint,
  error,
  inline = false
}: RadioGroupProps): React.JSX.Element {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <fieldset
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      aria-invalid={error ? true : undefined}
      className="flex flex-col gap-2"
    >
      <legend className="mb-1 text-sm font-medium text-fg">{legend}</legend>
      {hint && (
        <p id={hintId} className="-mt-1 text-sm text-fg-subtle">
          {hint}
        </p>
      )}
      <div className={cx('flex gap-2', inline ? 'flex-row flex-wrap' : 'flex-col')}>
        {options.map((option) => {
          const optionId = `${id}-${option.value}`
          const checked = option.value === value
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={cx(
                'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5',
                // Selection shows in the radio itself and a thicker border, not colour alone.
                checked
                  ? 'border-2 border-accent bg-accent-soft px-[11px] py-[9px]'
                  : 'border-input bg-surface',
                option.disabled && 'cursor-not-allowed opacity-60'
              )}
            >
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                {option.description && (
                  <span className="block text-sm text-fg-muted">{option.description}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </fieldset>
  )
}
