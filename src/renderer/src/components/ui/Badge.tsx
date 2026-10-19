import { cx } from '../../lib/cx'
import { TONE_ICONS, TONE_SOFT, type Tone } from './tones'

/** A short status label, e.g. "Voided", "Low stock". Always text + icon. */
export function Badge({
  tone = 'neutral',
  children,
  icon = true
}: {
  tone?: Tone
  children: string
  icon?: boolean
}): React.JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-5 font-medium whitespace-nowrap',
        TONE_SOFT[tone]
      )}
    >
      {icon && tone !== 'neutral' && (
        <span className="inline-flex size-3.5 [&>svg]:size-full">{TONE_ICONS[tone]}</span>
      )}
      {children}
    </span>
  )
}
