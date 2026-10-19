import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NavLink } from 'react-router'
import { cx } from '../lib/cx'
import type { NavGroup } from '../navigation/navigation'
import { formatCombo } from '../shortcuts/keys'

interface SidebarProps {
  groups: readonly NavGroup[]
  collapsed: boolean
  /** When the window is too narrow, the sidebar stays collapsed and the toggle is hidden. */
  canToggle: boolean
  onToggle: () => void
}

export function Sidebar({
  groups,
  collapsed,
  canToggle,
  onToggle
}: SidebarProps): React.JSX.Element {
  return (
    <aside
      className={cx(
        'on-dark flex shrink-0 flex-col bg-nav text-nav-fg transition-[width] duration-150',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      <div
        className={cx(
          'flex h-14 items-center border-b border-nav-divider',
          collapsed ? 'justify-center' : 'px-5'
        )}
      >
        <span className="text-lg font-bold text-nav-fg-active">
          {collapsed ? 'SP' : 'StorePro'}
        </span>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto py-3">
        {groups.map((group) => (
          <div key={group.id} className="mb-3">
            <h2
              className={cx(
                'px-5 pb-1 text-xs font-semibold tracking-wider text-nav-fg-muted uppercase',
                collapsed && 'sr-only'
              )}
            >
              {group.label}
            </h2>
            <ul>
              {group.items.map((item) => (
                <li key={item.id}>
                  <NavLink
                    to={item.path}
                    title={
                      collapsed
                        ? `${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`
                        : undefined
                    }
                    aria-keyshortcuts={item.shortcut}
                    className={({ isActive }) =>
                      cx(
                        'relative mx-2 flex h-10 items-center gap-3 rounded-md px-3 text-base',
                        collapsed && 'justify-center px-0',
                        isActive
                          ? // Active item: background, bold text and a side bar, not colour alone.
                            'bg-nav-active font-semibold text-nav-fg-active forced-colors:underline before:absolute before:inset-y-1.5 before:-left-2 before:w-1 before:rounded-r before:bg-focus-on-dark'
                          : 'hover:bg-nav-hover hover:text-nav-fg-active'
                      )
                    }
                  >
                    <span aria-hidden className="inline-flex size-5 shrink-0 [&>svg]:size-full">
                      {item.icon}
                    </span>
                    <span className={cx('flex-1 truncate', collapsed && 'sr-only')}>
                      {item.label}
                    </span>
                    {item.shortcut && !collapsed && (
                      <span aria-hidden className="text-xs text-nav-fg-muted tabular">
                        {formatCombo(item.shortcut)}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {canToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-keyshortcuts="Ctrl+B"
          className={cx(
            'flex h-12 items-center gap-3 border-t border-nav-divider text-sm hover:bg-nav-hover hover:text-nav-fg-active',
            collapsed ? 'justify-center' : 'px-5'
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="size-5" />
          ) : (
            <PanelLeftClose aria-hidden className="size-5" />
          )}
          {!collapsed && <span>Collapse</span>}
        </button>
      )}
    </aside>
  )
}
