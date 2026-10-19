import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AuthGate } from './auth/AuthGate'
import { ConfirmProvider } from './components/ui/ConfirmDialog'
import { ToastProvider } from './components/ui/Toast'
import { createQueryClient } from './ipc/queryClient'
import { createRoutes } from './navigation/routes'
import { ShortcutProvider } from './shortcuts/ShortcutProvider'

/** Providers, outermost first: data, keyboard, feedback, sign-in, then the screens. */
export function App(): React.JSX.Element {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <ShortcutProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthGate>
              <SessionRouter />
            </AuthGate>
          </ConfirmProvider>
        </ToastProvider>
      </ShortcutProvider>
    </QueryClientProvider>
  )
}

/**
 * The screens for one signed-in session. AuthGate mounts this on sign-in and
 * unmounts it on sign-out (locking keeps it), so each person starts at the
 * home screen instead of on the last page the previous person had open.
 */
function SessionRouter(): React.JSX.Element {
  const [router] = useState(() => {
    window.history.replaceState(null, '', '/')
    return createBrowserRouter(createRoutes({ includeDevTools: import.meta.env.DEV }))
  })
  return <RouterProvider router={router} />
}
