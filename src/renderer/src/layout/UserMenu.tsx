import { ChevronDown, KeyRound, Lock, LogOut, UserRound } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { ChangePasswordForm } from '../auth/ChangePasswordForm'
import { useCurrentUser, useRefreshAuth } from '../auth/useAuth'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Kbd } from '../components/ui/Kbd'
import { useToast } from '../components/ui/Toast'
import { invoke } from '../ipc/client'
import { cx } from '../lib/cx'

/**
 * Who is signed in, with Change password, Lock and Sign out. A disclosure
 * (button + list): opens with Enter/Space/click, closes with Esc or a click
 * outside, and returns focus to the button.
 */
export function UserMenu(): React.JSX.Element {
  const user = useCurrentUser()
  const refresh = useRefreshAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    rootRef.current?.querySelector<HTMLButtonElement>('[data-menu-item]')?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const close = (): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  const item = (label: string, icon: React.ReactNode, onSelect: () => void, hint?: string) => (
    <li>
      <button
        type="button"
        data-menu-item
        onClick={() => {
          setOpen(false)
          onSelect()
        }}
        className="flex h-10 w-full items-center gap-3 rounded px-3 text-left hover:bg-surface-muted"
      >
        <span aria-hidden className="inline-flex size-4 [&>svg]:size-full">
          {icon}
        </span>
        <span className="flex-1">{label}</span>
        {hint && <Kbd>{hint}</Kbd>}
      </button>
    </li>
  )

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => event.key === 'Escape' && open && close()}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-transparent px-2 text-sm hover:bg-surface-muted"
      >
        <UserRound aria-hidden className="size-4 text-fg-muted" />
        <span className="font-medium">{user.displayName}</span>
        <span className="text-fg-muted">· {user.roleName}</span>
        <ChevronDown
          aria-hidden
          className={cx('size-4 text-fg-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul
          id={menuId}
          aria-label="Account"
          className="absolute top-full right-0 z-30 mt-1 w-60 rounded-md border border-divider bg-surface p-1 shadow-lg"
        >
          {item('Change password', <KeyRound />, () => setChangingPassword(true))}
          {item(
            'Lock StorePro',
            <Lock />,
            async () => {
              await invoke('auth:lock')
              await refresh()
            },
            'Ctrl+L'
          )}
          {item('Sign out', <LogOut />, async () => {
            await invoke('auth:sign-out')
            await refresh({ forgetData: true })
          })}
        </ul>
      )}
      <Dialog
        open={changingPassword}
        onClose={() => setChangingPassword(false)}
        title="Change your password"
        closeOnBackdrop={false}
      >
        <ChangePasswordForm
          username={user.username}
          onChanged={async () => {
            setChangingPassword(false)
            toast.success('Your password was changed.')
            await refresh()
          }}
          secondaryAction={<Button onClick={() => setChangingPassword(false)}>Cancel</Button>}
        />
      </Dialog>
    </div>
  )
}
