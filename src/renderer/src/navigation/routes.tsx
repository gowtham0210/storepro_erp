import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { usePermissions } from '../auth/permissions'
import { Spinner } from '../components/ui/Spinner'
import { AppShell } from '../layout/AppShell'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { AccessDeniedPage, NoScreensPage, NotFoundPage } from '../pages/StatusPages'
import { useAccessStore } from '../state/accessStore'
import {
  DEV_NAVIGATION,
  isItemVisible,
  NAVIGATION,
  visibleNavigation,
  type NavItem
} from './navigation'

const ComponentGallery = lazy(() => import('../pages/dev/ComponentGallery'))
const UsersPage = lazy(() => import('../pages/UsersPage'))
const AuditLogPage = lazy(() => import('../pages/AuditLogPage'))

/** Screens that exist; every other navigation item shows its placeholder. */
const SCREENS: Partial<Record<string, ReactNode>> = {
  users: <UsersPage />,
  audit: <AuditLogPage />
}

/**
 * The home screen: Billing for most people (cashiers are the most frequent
 * users, so start where the work happens), otherwise the first screen this
 * user may open.
 */
function Home(): React.JSX.Element {
  const modules = useAccessStore((s) => s.modules)
  const permissions = usePermissions()
  const first = visibleNavigation(NAVIGATION, { modules, permissions })[0]?.items[0]
  return first ? <Navigate to={first.path} replace /> : <NoScreensPage />
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
  const permissions = usePermissions()
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
        { index: true, element: <Home /> },
        // The packaged app's entry document, should anything load it by name.
        { path: 'index.html', element: <Home /> },
        ...screens,
        ...devTools,
        { path: '*', element: <NotFoundPage /> }
      ]
    }
  ]
}
