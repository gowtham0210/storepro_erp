import { CircleAlert } from 'lucide-react'
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface FieldControlProps {
  id?: string | undefined
  'aria-invalid'?: boolean | undefined
  'aria-describedby'?: string | undefined
  'aria-required'?: boolean | undefined
}

interface FieldProps {
  label: string
  /** Shown under the label; explains format or purpose. */
  hint?: string | undefined
  error?: string | null | undefined
  required?: boolean | undefined
  /** Visually hide the label (it stays available to screen readers). Use sparingly. */
  hideLabel?: boolean | undefined
  className?: string | undefined
  children: ReactElement<FieldControlProps>
}

/**
 * Label + control + hint + error, wired together for assistive technology.
 * Labels are always present (placeholders are not labels); errors appear next
 * to the field with an icon, not only in red.
 */
export function Field({
  label,
  hint,
  error,
  required,
  hideLabel,
  className,
  children
}: FieldProps): React.JSX.Element {
  const generatedId = useId()
  const id = children.props.id ?? generatedId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy =
    [hintId, errorId, children.props['aria-describedby']].filter(Boolean).join(' ') || undefined

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className={cx('text-sm font-medium text-fg', hideLabel && 'sr-only')}>
        {label}
        {required && (
          <span className="text-fg-subtle font-normal">
            {' '}
            <span aria-hidden>*</span>
            <span className="sr-only">(required)</span>
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-fg-subtle">
          {hint}
        </p>
      )}
      {isValidElement(children) &&
        cloneElement(children, {
          id,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          'aria-required': required || undefined
        })}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  )
}

export function FieldError({
  id,
  children
}: {
  id?: string | undefined
  children: ReactNode
}): React.JSX.Element {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Shared look for text-like controls. Invalid state adds a thicker border, not just a colour change. */
export const controlClasses = cx(
  'h-10 w-full rounded-md border border-input bg-surface px-3 text-base text-fg',
  'placeholder:text-fg-subtle disabled:bg-surface-muted disabled:text-fg-subtle disabled:cursor-not-allowed',
  'aria-invalid:border-danger aria-invalid:border-2'
)
