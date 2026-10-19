import { Wifi, WifiOff } from 'lucide-react'
import { formatStoreTime } from '@shared/storeTime'
import { cx } from '../lib/cx'
import { useStoreTimeZone } from '../store/storeContext'
import { useConnectivity } from './useConnectivity'

/**
 * Always visible (PRD FR-004, M08-02). Being offline is normal for StorePro,
 * so it is shown calmly with reassurance, not as an error. Changes are
 * announced politely to screen readers (role="status").
 */
export function ConnectivityIndicator(): React.JSX.Element {
  const status = useConnectivity()
  const timeZone = useStoreTimeZone()
  const online = status?.online ?? true
  const since = status ? formatStoreTime(status.changedAt, timeZone, 'dateTime') : null
  return (
    <div
      role="status"
      title={
        online
          ? 'Connected to a network.'
          : `No network connection${since ? ` since ${since}` : ''}. Billing, stock and reports keep working; online features resume when the connection returns.`
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
