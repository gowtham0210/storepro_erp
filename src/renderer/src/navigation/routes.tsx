import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { Spinner } from '../components/ui/Spinner'
import { AppShell } from '../layout/AppShell'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { AccessDeniedPage, NotFoundPage } from '../pages/StatusPages'
import { useAccessStore } from '../state/accessStore'
import { DEV_NAVIGATION, isItemVisible, NAVIGATION, type NavItem } from './navigation'

const ComponentGallery = lazy(() => import('../pages/dev/ComponentGallery'))
const UsersPage = lazy(() => import('../pages/UsersPage'))

/** Screens that exist; every other navigation item shows its placeholder. */
const SCREENS: Partial<Record<string, ReactNode>> = {
  users: <UsersPage />
}

/** Route-level guard: a hidden screen shows a clear "no access" page, never a blank one. */
function RequireAccess({
  item,
  children
}: {
  item: NavItem
  children: ReactNode
}): React.JSX.Element {
  const modules = useAccessStore((s) => s.modules)
  const permissions = useAccessStore((s) => s.permissions)
  return isItemVisible(item, { modules, permissions }) ? (
    <>{children}</>
  ) : (
    <AccessDeniedPage screen={item.label} />
  )
}

export function createRoutes(options: { includeDevTools: boolean }): RouteObject[] {
  const screens: RouteObject[] = NAVIGATION.flatMap((group) => group.items).map((item) => ({
    path: item.path.slice(1),
    element: (
      <RequireAccess item={item}>
        <Suspense fallback={<Spinner label="Loading" />}>
          {SCREENS[item.id] ?? <PlaceholderPage item={item} />}
        </Suspense>
      </RequireAccess>
    )
  }))
  const devTools: RouteObject[] = options.includeDevTools
    ? DEV_NAVIGATION.items.map((item) => ({
        path: item.path.slice(1),
        element: (
          <Suspense fallback={<Spinner label="Loading" />}>
            <ComponentGallery />
          </Suspense>
        )
      }))
    : []
  return [
    {
      path: '/',
      element: <AppShell />,
      children: [
        // Cashiers are the most frequent users: start where the work happens.
        { index: true, element: <Navigate to="/billing" replace /> },
        // The packaged app's entry document, should anything load it by name.
        { path: 'index.html', element: <Navigate to="/billing" replace /> },
        ...screens,
        ...devTools,
        { path: '*', element: <NotFoundPage /> }
      ]
    }
  ]
}
