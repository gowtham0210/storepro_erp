import { LoaderCircle } from 'lucide-react'
import { cx } from '../../lib/cx'

interface SpinnerProps {
  /** Announced to screen readers; omit when a surrounding element already says what is loading. */
  label?: string
  className?: string
}

export function Spinner({ label, className }: SpinnerProps): React.JSX.Element {
  return (
    <span role={label ? 'status' : undefined} className={cx('inline-flex items-center', className)}>
      <LoaderCircle aria-hidden className="size-[1.1em] animate-spin motion-reduce:animate-none" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
