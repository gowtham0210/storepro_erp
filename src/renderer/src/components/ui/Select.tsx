import { ChevronDown } from 'lucide-react'
import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { controlClasses } from './Field'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** Options with the same group are shown together under that heading (<optgroup>). */
  group?: string
}

function renderOption(option: SelectOption): React.JSX.Element {
  return (
    <option key={option.value} value={option.value} disabled={option.disabled}>
      {option.label}
    </option>
  )
}

/** Ungrouped options first, then each group in order of first appearance. */
function renderOptions(options: readonly SelectOption[]): React.JSX.Element[] {
  const groups = new Map<string, SelectOption[]>()
  for (const option of options) {
    if (option.group === undefined) continue
    groups.set(option.group, [...(groups.get(option.group) ?? []), option])
  }
  return [
    ...options.filter((option) => option.group === undefined).map(renderOption),
    ...[...groups].map(([label, grouped]) => (
      <optgroup key={label} label={label}>
        {grouped.map(renderOption)}
      </optgroup>
    ))
  ]
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
        {renderOptions(options)}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted"
      />
    </div>
  )
})
