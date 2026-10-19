import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { ConfirmProvider } from './components/ui/ConfirmDialog'
import { ToastProvider } from './components/ui/Toast'
import { createQueryClient } from './ipc/queryClient'
import { createRoutes } from './navigation/routes'
import { ShortcutProvider } from './shortcuts/ShortcutProvider'

/** Providers, outermost first: data, keyboard, feedback, then the screens. */
export function App(): React.JSX.Element {
  const [queryClient] = useState(createQueryClient)
  const [router] = useState(() =>
    createBrowserRouter(createRoutes({ includeDevTools: import.meta.env.DEV }))
  )
  return (
    <QueryClientProvider client={queryClient}>
      <ShortcutProvider>
        <ToastProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </ToastProvider>
      </ShortcutProvider>
    </QueryClientProvider>
  )
}
