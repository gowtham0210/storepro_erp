import { Wifi, WifiOff } from 'lucide-react'
import { cx } from '../lib/cx'
import { useOnlineStatus } from './useOnlineStatus'

/**
 * Always visible (PRD FR-004). Being offline is normal for StorePro, so it is
 * shown calmly with reassurance, not as an error.
 */
export function ConnectivityIndicator(): React.JSX.Element {
  const online = useOnlineStatus()
  return (
    <div
      role="status"
      title={
        online
          ? 'Connected to the internet.'
          : 'No internet connection. Billing, stock and reports keep working; online features resume when the connection returns.'
      }
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium',
        online
          ? 'border-divider text-fg-muted'
          : 'border-warning/40 bg-warning-soft text-warning-fg'
      )}
    >
      {online ? (
        <Wifi aria-hidden className="size-4" />
      ) : (
        <WifiOff aria-hidden className="size-4" />
      )}
      {online ? 'Online' : 'Offline · billing still works'}
    </div>
  )
}
