import { ChevronDown } from 'lucide-react'
import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { controlClasses } from './Field'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: readonly SelectOption[]
  /** Adds a first, empty option such as "Choose a category". */
  placeholder?: string
}

/**
 * A native <select>: keyboard type-ahead, screen-reader support and Windows
 * behaviour for free. Only the closed state is styled.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, ...rest },
  ref
) {
  return (
    <div className="relative">
      <select ref={ref} className={cx(controlClasses, 'appearance-none pr-9', className)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted"
      />
    </div>
  )
})
