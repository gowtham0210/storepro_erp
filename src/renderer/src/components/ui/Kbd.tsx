import { cx } from '../../lib/cx'

/** A keyboard key or shortcut hint, e.g. <Kbd>F12</Kbd>. */
export function Kbd({
  children,
  className
}: {
  children: string
  className?: string
}): React.JSX.Element {
  return (
    <kbd
      className={cx(
        'inline-flex min-w-[1.5em] items-center justify-center rounded border border-current/30 px-1',
        'font-sans text-xs leading-5 font-medium tabular opacity-80',
        className
      )}
    >
      {children}
    </kbd>
  )
}
