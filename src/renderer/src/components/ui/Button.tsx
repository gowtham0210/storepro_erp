import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Kbd } from './Kbd'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface BaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  /** sm 32px (dense tables), md 40px (default), lg 48px (touch / primary POS actions). */
  size?: ButtonSize
  /** Shows a spinner, keeps the width, and blocks repeat clicks. */
  loading?: boolean
  icon?: ReactNode
  /** Shortcut hint shown on the button and exposed as aria-keyshortcuts. Registration is separate (useShortcut). */
  shortcut?: string
  fullWidth?: boolean
}

/** Icon-only buttons must have an accessible name. */
export type ButtonProps = BaseProps &
  ({ children: ReactNode; 'aria-label'?: string } | { children?: undefined; 'aria-label': string })

// Filled and ghost buttons keep a transparent border: it costs no space and
// becomes visible in Windows High Contrast mode.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-accent text-fg-inverse hover:bg-accent-hover',
  secondary: 'border-input bg-surface text-fg hover:bg-surface-muted',
  ghost: 'border-transparent bg-transparent text-fg hover:bg-surface-muted',
  danger: 'border-transparent bg-danger text-fg-inverse hover:bg-danger-hover'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-base gap-2',
  lg: 'h-12 px-5 text-lg gap-2.5'
}

const ICON_ONLY: Record<ButtonSize, string> = { sm: 'w-8', md: 'w-10', lg: 'w-12' }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    shortcut,
    fullWidth = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  const iconOnly = children === undefined
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center rounded-md border font-medium',
        'transition-colors duration-150 select-none disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        iconOnly && cx(ICON_ONLY[size], 'px-0'),
        fullWidth && 'w-full',
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-keyshortcuts={shortcut}
      data-autofocus={rest.autoFocus ? '' : undefined}
      {...rest}
    >
      {loading ? <Spinner className="absolute" /> : null}
      <span className={cx('inline-flex items-center gap-[inherit]', loading && 'invisible')}>
        {icon && (
          <span aria-hidden className="inline-flex size-[1.15em] items-center [&>svg]:size-full">
            {icon}
          </span>
        )}
        {children}
        {shortcut && <Kbd className="ml-1">{shortcut}</Kbd>}
      </span>
    </button>
  )
})
