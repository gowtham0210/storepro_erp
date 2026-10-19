import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export interface ConfirmOptions {
  title: string
  /** State the consequence plainly, e.g. "Stock for 3 items will be returned. This can't be undone." */
  description: ReactNode
  /** The action as a verb, e.g. "Void sale". Never "OK" or "Yes". */
  confirmLabel: string
  cancelLabel?: string
  /** Destructive actions use a red button and start with focus on Cancel. */
  tone?: 'default' | 'danger'
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/** `const confirm = useConfirm(); if (await confirm({...})) { ... }` */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [request, setRequest] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setRequest({ ...options, resolve })
      }),
    []
  )

  const settle = (result: boolean): void => {
    request?.resolve(result)
    setRequest(null)
  }

  const danger = request?.tone === 'danger'
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={request !== null}
        onClose={() => settle(false)}
        title={request?.title ?? ''}
        description={request?.description}
        size="sm"
        closeOnBackdrop={false}
        // Error prevention: Enter right after opening must not destroy anything.
        initialFocusRef={danger ? cancelRef : confirmRef}
        footer={
          <>
            <Button ref={cancelRef} onClick={() => settle(false)}>
              {request?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              ref={confirmRef}
              variant={danger ? 'danger' : 'primary'}
              onClick={() => settle(true)}
            >
              {request?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  )
}
