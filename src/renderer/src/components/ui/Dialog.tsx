import { X } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { cx } from '../../lib/cx'
import { ShortcutScope } from '../../shortcuts/ShortcutProvider'
import { Button } from './Button'

export interface DialogProps {
  open: boolean
  /** Called for Esc, the close button, and (if enabled) a backdrop click. */
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  /** Action buttons; put the primary action last (right). */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Clicking outside closes the dialog. Turn off for forms with unsaved input. */
  closeOnBackdrop?: boolean
  /** Element to focus when the dialog opens; defaults to the first field marked `autoFocus`. */
  initialFocusRef?: RefObject<HTMLElement | null>
}

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }

/**
 * Modal dialog on the native <dialog> element: focus is trapped, the page
 * behind is inert, Esc closes it, and focus returns to the opener afterwards.
 * Global shortcuts are suspended while it is open.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  initialFocusRef
}: DialogProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyScrolls, setBodyScrolls] = useState(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
      // React's autoFocus runs while the dialog is still closed, where focus can't land, and the
      // browser would then focus the Close button. So focus the field that asked for it, now.
      const preferred =
        initialFocusRef?.current ?? dialog.querySelector<HTMLElement>('[data-autofocus]')
      preferred?.focus()
      return () => {
        // Most dialogs are removed from the page rather than closed, and a removed dialog doesn't
        // give focus back. Return it to where it was (the scan field, the button that opened
        // the dialog), unless the page has already put it somewhere on purpose.
        const stranded =
          document.activeElement === null ||
          document.activeElement === document.body ||
          dialog.contains(document.activeElement)
        if (stranded && opener?.isConnected) opener.focus()
      }
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open, initialFocusRef])

  // A body that scrolls must be reachable by keyboard so it can be scrolled with the arrow keys.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!open || !body) return
    const measure = (): void => setBodyScrolls(body.scrollHeight > body.clientHeight)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(body)
    return () => observer?.disconnect()
  }, [open, children])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // Esc fires "cancel"; keep the dialog controlled by React state.
    const onCancel = (event: Event): void => {
      event.preventDefault()
      onCloseRef.current()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(event) => {
        // A click on the <dialog> element itself (not its content) is the backdrop.
        if (closeOnBackdrop && event.target === ref.current) onClose()
      }}
      className={cx(
        'm-auto w-[calc(100%-2rem)] rounded-lg border border-divider bg-surface p-0 text-fg shadow-2xl',
        'open:animate-enter',
        SIZES[size]
      )}
    >
      {open && (
        <ShortcutScope name={title} exclusive>
          <div className="flex max-h-[85vh] flex-col">
            <header className="flex items-start justify-between gap-4 border-b border-divider px-6 py-4">
              <div>
                <h2 id={titleId} className="text-xl font-semibold">
                  {title}
                </h2>
                {description && (
                  <div id={descriptionId} className="mt-1 text-base text-fg-muted">
                    {description}
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" aria-label="Close" icon={<X />} onClick={onClose} />
            </header>
            {children && (
              <div
                ref={bodyRef}
                tabIndex={bodyScrolls ? 0 : undefined}
                role={bodyScrolls ? 'region' : undefined}
                aria-labelledby={bodyScrolls ? titleId : undefined}
                className="overflow-y-auto px-6 py-5"
              >
                {children}
              </div>
            )}
            {footer && (
              <footer className="flex justify-end gap-3 border-t border-divider bg-surface-muted px-6 py-4">
                {footer}
              </footer>
            )}
          </div>
        </ShortcutScope>
      )}
    </dialog>
  )
}
