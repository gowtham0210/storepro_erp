import { X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { cx } from '../../lib/cx'
import { TONE_ICONS, TONE_SOFT } from './tones'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastOptions {
  title?: string
  /** Milliseconds; errors stay until dismissed unless set. */
  duration?: number
}

interface ToastItem extends ToastOptions {
  id: number
  tone: ToastTone
  message: string
}

export interface Toaster {
  info(message: string, options?: ToastOptions): void
  success(message: string, options?: ToastOptions): void
  warning(message: string, options?: ToastOptions): void
  error(message: string, options?: ToastOptions): void
}

const ToastContext = createContext<Toaster | null>(null)

const DEFAULT_DURATION: Record<ToastTone, number | null> = {
  info: 5000,
  success: 4000,
  warning: 8000,
  // Errors need action or acknowledgement; they never disappear on their own.
  danger: null
}
const MAX_VISIBLE = 3

export function useToast(): Toaster {
  const toaster = useContext(ToastContext)
  if (!toaster) throw new Error('useToast must be used inside <ToastProvider>')
  return toaster
}

/**
 * Brief, non-blocking feedback for actions that finished elsewhere on the
 * screen. Shown bottom-right, where it does not cover billing totals.
 */
export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback(
    (id: number) => setToasts((current) => current.filter((t) => t.id !== id)),
    []
  )
  const show = useCallback((tone: ToastTone, message: string, options: ToastOptions = {}) => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, tone, message, ...options }].slice(-MAX_VISIBLE))
  }, [])

  const toaster = useMemo<Toaster>(
    () => ({
      info: (message, options) => show('info', message, options),
      success: (message, options) => show('success', message, options),
      warning: (message, options) => show('warning', message, options),
      error: (message, options) => show('danger', message, options)
    }),
    [show]
  )

  const polite = toasts.filter((t) => t.tone !== 'danger')
  const assertive = toasts.filter((t) => t.tone === 'danger')
  return (
    <ToastContext.Provider value={toaster}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-12 z-50 flex w-96 flex-col gap-2"
      >
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {polite.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="flex flex-col gap-2">
          {assertive.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
      </section>
    </ToastContext.Provider>
  )
}

function ToastCard({
  toast,
  onDismiss
}: {
  toast: ToastItem
  onDismiss: (id: number) => void
}): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  const duration = toast.duration ?? DEFAULT_DURATION[toast.tone]

  useEffect(() => {
    if (duration === null || paused) return
    const timer = setTimeout(() => onDismiss(toast.id), duration)
    return () => clearTimeout(timer)
  }, [duration, paused, toast.id, onDismiss])

  return (
    <div
      // Pause while the user is reading or interacting with it.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cx(
        'pointer-events-auto flex items-start gap-3 rounded-md border px-4 py-3 shadow-lg animate-enter',
        TONE_SOFT[toast.tone]
      )}
    >
      <span className="mt-0.5 inline-flex size-5 shrink-0 [&>svg]:size-full">
        {TONE_ICONS[toast.tone]}
      </span>
      <div className="min-w-0 flex-1">
        {toast.title && <p className="font-semibold">{toast.title}</p>}
        <p>{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-1 inline-flex size-8 shrink-0 items-center justify-center rounded hover:bg-current/10"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}
