import { Keyboard } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { usePermissions } from '../auth/permissions'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { useIpcQuery } from '../ipc/hooks'
import {
  DEV_NAVIGATION,
  findNavItem,
  NAVIGATION,
  visibleNavigation
} from '../navigation/navigation'
import { useUiStore } from '../state/uiStore'
import { useEnabledModules } from '../store/storeContext'
import {
  useActiveShortcuts,
  useShortcut,
  useShortcuts,
  type ActiveShortcut
} from '../shortcuts/ShortcutProvider'
import { Clock } from './Clock'
import { ConnectivityIndicator } from './ConnectivityIndicator'
import { ShortcutHelpDialog } from './ShortcutHelpDialog'
import { Sidebar } from './Sidebar'
import { UserMenu } from './UserMenu'

/** Below this width (scaled with the text size) the sidebar shows icons only. */
const NARROW_WIDTH_PX = 1152

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

export function AppShell(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const modules = useEnabledModules()
  const permissions = usePermissions()
  const {
    sidebarCollapsed,
    uiScale,
    toggleSidebar,
    changeScale,
    recoveryNoticeDismissed,
    dismissRecoveryNotice
  } = useUiStore()
  const width = useSyncExternalStore(subscribeResize, () => window.innerWidth)
  const narrow = width < (NARROW_WIDTH_PX * uiScale) / 100
  const [help, setHelp] = useState<readonly ActiveShortcut[] | null>(null)
  const activeShortcuts = useActiveShortcuts()

  const groups = useMemo(
    () =>
      visibleNavigation(import.meta.env.DEV ? [...NAVIGATION, DEV_NAVIGATION] : NAVIGATION, {
        modules,
        permissions
      }),
    [modules, permissions]
  )
  const current = findNavItem(location.pathname)
  const currentGroup = groups.find((group) => group.items.some((item) => item.id === current?.id))

  const { data: appInfo } = useIpcQuery('app:get-info')
  const { data: startup } = useIpcQuery('app:get-startup-status')

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', `${uiScale}%`)
  }, [uiScale])

  // After navigating, move focus to the new page's heading so keyboard and
  // screen-reader users land at the start of the content.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    document.querySelector<HTMLElement>('main [data-page-heading]')?.focus()
  }, [location.pathname])

  useShortcuts(
    groups.flatMap((group) =>
      group.items.flatMap((item) =>
        item.shortcut
          ? [
              {
                combo: item.shortcut,
                handler: () => navigate(item.path),
                description: `Go to ${item.label}`
              }
            ]
          : []
      )
    )
  )
  useShortcut('F1', () => setHelp(activeShortcuts), { description: 'Show keyboard shortcuts' })
  useShortcut('Ctrl+B', toggleSidebar, {
    description: 'Collapse or expand the sidebar',
    enabled: !narrow
  })
  useShortcut(['Ctrl+=', 'Ctrl++'], () => changeScale(1), { description: 'Larger text' })
  useShortcut('Ctrl+-', () => changeScale(-1), { description: 'Smaller text' })
  useShortcut('Ctrl+0', () => changeScale(0), { description: 'Reset text size' })

  return (
    <div className="flex h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to main content
      </a>
      <div className="flex min-h-0 flex-1">
        <Sidebar
          groups={groups}
          collapsed={sidebarCollapsed || narrow}
          canToggle={!narrow}
          onToggle={toggleSidebar}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-divider bg-surface px-6">
            <p className="truncate text-sm text-fg-muted">
              {currentGroup && current ? `${currentGroup.label} / ${current.label}` : ''}
            </p>
            <div className="flex items-center gap-4">
              <ConnectivityIndicator />
              <Clock />
              <Button
                variant="ghost"
                size="sm"
                icon={<Keyboard />}
                shortcut="F1"
                onClick={() => setHelp(activeShortcuts)}
              >
                Shortcuts
              </Button>
              <UserMenu />
            </div>
          </header>
          <main
            id="main"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto px-8 py-6 outline-none"
          >
            {startup?.recoveredFromUncleanShutdown && !recoveryNoticeDismissed && (
              <Alert
                tone="warning"
                title="StorePro didn't close properly last time"
                onDismiss={dismissRecoveryNotice}
                className="mb-6"
              >
                It restarted safely and your saved data is intact. Check the last bill before you
                continue.
              </Alert>
            )}
            <Outlet />
          </main>
          <footer className="flex h-8 shrink-0 items-center justify-between border-t border-divider bg-surface px-6 text-xs text-fg-muted">
            <span>
              {appInfo ? `StorePro ${appInfo.version}` : 'StorePro'} · Data is saved on this
              computer
            </span>
            {uiScale !== 100 && <span>Text size {uiScale}% · Ctrl+0 to reset</span>}
          </footer>
        </div>
      </div>
      <ShortcutHelpDialog
        open={help !== null}
        onClose={() => setHelp(null)}
        shortcuts={help ?? []}
      />
    </div>
  )
}
