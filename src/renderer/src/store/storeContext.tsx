import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { StoreProfile } from '@shared/ipc/contract'
import type { ModuleCode } from '@shared/modules'
import { CurrencyContext } from '../components/ui/Money'

const StoreContext = createContext<StoreProfile | null>(null)

/**
 * The store's profile for every screen: its currency (for Money) and time
 * zone (for dates). AuthGate provides it once setup is complete.
 */
export function StoreProvider({
  profile,
  children
}: {
  profile: StoreProfile
  children: ReactNode
}): React.JSX.Element {
  const currency = useMemo(
    () => ({
      currencyCode: profile.currency.currencyCode,
      minorUnits: profile.currency.minorUnits
    }),
    [profile.currency.currencyCode, profile.currency.minorUnits]
  )
  return (
    <StoreContext.Provider value={profile}>
      <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>
    </StoreContext.Provider>
  )
}

/** The store's profile. Only use below <AuthGate>, where setup is always complete. */
export function useStore(): StoreProfile {
  const profile = useContext(StoreContext)
  if (!profile) throw new Error('useStore used outside a set-up store')
  return profile
}

/** Modules switched on, which decide the screens and features shown (M04-03). */
export function useEnabledModules(): readonly ModuleCode[] {
  return useStore().enabledModules
}

/** The store's time zone, for showing and filtering dates (M03-05). */
export function useStoreTimeZone(): string {
  return useStore().timeZone
}
