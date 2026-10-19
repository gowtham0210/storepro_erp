import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

interface CardProps {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Remove body padding, e.g. for a full-width table. */
  flush?: boolean
}

export function Card({ title, actions, children, className, flush }: CardProps): React.JSX.Element {
  return (
    <section
      className={cx('rounded-lg border border-divider bg-surface', className)}
      aria-label={title}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-divider px-5 py-3">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions && <div className="flex gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(!flush && 'p-5')}>{children}</div>
    </section>
  )
}
