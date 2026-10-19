import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { TONE_ICONS, TONE_SOFT, type Tone } from './tones'

interface AlertProps {
  tone?: Tone
  title?: string
  children?: ReactNode
  /** e.g. a "Try again" button. */
  action?: ReactNode
  onDismiss?: () => void
  className?: string
}

/**
 * Inline message tied to a place on the screen. Danger alerts interrupt screen
 * readers (role=alert); the others are announced politely.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  className
}: AlertProps): React.JSX.Element {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-3 rounded-md border px-4 py-3',
        TONE_SOFT[tone],
        className
      )}
    >
      <span className="mt-0.5 inline-flex size-5 shrink-0 [&>svg]:size-full">
        {TONE_ICONS[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 inline-flex size-8 shrink-0 items-center justify-center rounded hover:bg-current/10"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  )
}
