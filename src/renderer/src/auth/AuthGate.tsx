import { useEffect, useRef, type ReactNode } from 'react'
import { Spinner } from '../components/ui/Spinner'
import { invoke } from '../ipc/client'
import { useShortcut } from '../shortcuts/ShortcutProvider'
import { useAccessStore } from '../state/accessStore'
import { ForcedPasswordChangeScreen } from './ForcedPasswordChangeScreen'
import { interimPermissionsFor } from './interimPermissions'
import { LockScreen } from './LockScreen'
import { SetupAdminScreen } from './SetupAdminScreen'
import { SignInScreen } from './SignInScreen'
import { useAuthState, useRefreshAuth } from './useAuth'

/** Lock automatically after this long without keyboard or mouse input. A setting in M03. */
export const IDLE_LOCK_MS = 15 * 60_000

/**
 * Decides what the person at the computer sees: first-run setup, sign-in, a
 * forced password change, or the app (with the lock screen over it when locked).
 */
export function AuthGate({ children }: { children: ReactNode }): React.JSX.Element {
  const { state } = useAuthState()
  const setAccess = useAccessStore((s) => s.setAccess)
  const user = state?.status === 'signed-in' || state?.status === 'locked' ? state.user : null

  useEffect(() => {
    if (user) setAccess({ modules: ['grocery'], permissions: interimPermissionsFor(user.roleCode) })
  }, [user, setAccess])

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Starting StorePro" />
      </div>
    )
  }
  if (state.status === 'setup-required') return <SetupAdminScreen />
  if (state.status === 'signed-out') return <SignInScreen />
  if (state.user.mustChangePassword) return <ForcedPasswordChangeScreen user={state.user} />

  const locked = state.status === 'locked'
  return (
    <>
      <div inert={locked} aria-hidden={locked || undefined} className="contents">
        <SessionControls enabled={!locked} />
        {children}
      </div>
      {locked && <LockScreen user={state.user} />}
    </>
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
