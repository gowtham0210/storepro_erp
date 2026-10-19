import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  /** Say why it is empty and what to do next. */
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && (
        <span aria-hidden className="mb-3 inline-flex size-12 text-fg-subtle [&>svg]:size-full">
          {icon}
        </span>
      )}
      <p className="text-lg font-semibold">{title}</p>
      {description && <div className="mt-1 max-w-md text-fg-muted">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
