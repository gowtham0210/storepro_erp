import { useEffect, useRef, type ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'
import { SetupWizard } from '../setup/SetupWizard'
import { StoreProvider } from '../store/storeContext'
import { useShortcut } from '../shortcuts/ShortcutProvider'
import { ForcedPasswordChangeScreen } from './ForcedPasswordChangeScreen'
import { AuthLayout } from './AuthLayout'
import { ManagerApprovalProvider } from './ManagerApproval'
import { useCan } from './permissions'
import { LockScreen } from './LockScreen'
import { SignInScreen } from './SignInScreen'
import { useAuthState, useRefreshAuth } from './useAuth'

/** Lock automatically after this long without keyboard or mouse input. A setting in M03. */
export const IDLE_LOCK_MS = 15 * 60_000

/**
 * Decides what the person at the computer sees: first-run setup, sign-in, a
 * forced password change, or the app (with the lock screen over it when
 * locked). The app only opens once the store is set up (M03-03, FR-005).
 */
export function AuthGate({ children }: { children: ReactNode }): React.JSX.Element {
  const { state } = useAuthState()

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Starting StorePro" />
      </div>
    )
  }
  if (state.status === 'setup-required') return <SetupWizard mode="new-store" />
  if (state.status === 'signed-out') return <SignInScreen />
  if (state.user.mustChangePassword) return <ForcedPasswordChangeScreen user={state.user} />

  const locked = state.status === 'locked'
  return (
    <>
      <div inert={locked} aria-hidden={locked || undefined} className="contents">
        <SessionControls enabled={!locked} />
        <RequireStore>
          <ManagerApprovalProvider>{children}</ManagerApprovalProvider>
        </RequireStore>
      </div>
      {locked && <LockScreen user={state.user} />}
    </>
  )
}

/** The store's profile for the app; setup first if it was never saved. */
function RequireStore({ children }: { children: ReactNode }): React.JSX.Element {
  const profile = useIpcQuery('store:get-profile')
  const can = useCan()
  if (profile.isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Loading the store" />
      </div>
    )
  }
  if (profile.error) {
    return (
      <AuthLayout title="StorePro couldn't open the store">
        <Alert tone="danger">{describeError(profile.error).message}</Alert>
        <Button className="mt-4" onClick={() => void profile.refetch()}>
          Try again
        </Button>
      </AuthLayout>
    )
  }
  if (profile.data === null) {
    // An administrator from before store setup existed: finish it now.
    return can('settings.edit') ? <SetupWizard mode="store-only" /> : <SetupBlocked />
  }
  return <StoreProvider profile={profile.data}>{children}</StoreProvider>
}

/** Billing can't start until an administrator finishes setup (FR-005). */
function SetupBlocked(): React.JSX.Element {
  const refresh = useRefreshAuth()
  return (
    <AuthLayout
      title="StorePro isn't set up yet"
      description="An administrator needs to enter the store's details before anyone can start billing."
    >
      <Button
        icon={<LogOut />}
        onClick={() => {
          void invoke('auth:sign-out').then(() => refresh({ forgetData: true }))
        }}
      >
        Sign out
      </Button>
    </AuthLayout>
  )
}

/** Ctrl+L locks now; inactivity locks after IDLE_LOCK_MS. */
function SessionControls({ enabled }: { enabled: boolean }): null {
  const refresh = useRefreshAuth()
  const lock = useRef(async () => {
    await invoke('auth:lock')
    await refresh()
  })
  useEffect(() => {
    lock.current = async () => {
      await invoke('auth:lock')
      await refresh()
    }
  }, [refresh])

  useShortcut('Ctrl+L', () => void lock.current(), { description: 'Lock StorePro', enabled })

  useEffect(() => {
    if (!enabled) return
    let timer = setTimeout(() => void lock.current(), IDLE_LOCK_MS)
    const reset = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => void lock.current(), IDLE_LOCK_MS)
    }
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const
    for (const name of events) window.addEventListener(name, reset, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const name of events) window.removeEventListener(name, reset)
    }
  }, [enabled])
  return null
}
