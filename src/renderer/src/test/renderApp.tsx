import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { ConfirmProvider } from '../components/ui/ConfirmDialog'
import { ToastProvider } from '../components/ui/Toast'
import { createQueryClient } from '../ipc/queryClient'
import { createRoutes } from '../navigation/routes'
import { ShortcutProvider } from '../shortcuts/ShortcutProvider'

/** The full app (same providers and routes as App.tsx) at a given path. */
export function renderApp(path = '/') {
  const router = createMemoryRouter(createRoutes({ includeDevTools: true }), {
    initialEntries: [path]
  })
  const result = render(
    <QueryClientProvider client={createQueryClient()}>
      <ShortcutProvider>
        <ToastProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </ToastProvider>
      </ShortcutProvider>
    </QueryClientProvider>
  )
  return { ...result, router }
}
