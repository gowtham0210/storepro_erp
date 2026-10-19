import { describe, expect, it } from 'vitest'
import { MODULES } from '@shared/modules'
import { PERMISSION_CODES } from '@shared/permissions'
import { NAVIGATION, visibleNavigation, withModuleScreens, type NavGroup } from './navigation'

const everything = { modules: ['grocery'] as const, permissions: PERMISSION_CODES }

describe('visibleNavigation', () => {
  it('shows everything when the user has every permission', () => {
    const groups = visibleNavigation(NAVIGATION, everything)
    expect(groups.flatMap((g) => g.items).length).toBe(12)
  })

  it('hides items without permission and drops empty groups', () => {
    const groups = visibleNavigation(NAVIGATION, {
      modules: ['grocery'] as const,
      permissions: ['sale.create', 'sale.view']
    })
    expect(groups.map((g) => g.id)).toEqual(['sell'])
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['billing', 'sales'])
  })

  it('hides items of modules that are not enabled', () => {
    const withModule: NavGroup[] = [
      {
        id: 'restaurant',
        label: 'Restaurant',
        items: [
          {
            id: 'tables',
            label: 'Tables',
            path: '/tables',
            icon: null,
            module: 'restaurant',
            plannedIn: '',
            description: ''
          }
        ]
      }
    ]
    expect(visibleNavigation(withModule, everything)).toEqual([])
    expect(
      visibleNavigation(withModule, { ...everything, modules: ['restaurant'] as const })
    ).toHaveLength(1)
  })

  it('never gives two screens the same shortcut', () => {
    const shortcuts = NAVIGATION.flatMap((g) => g.items)
      .map((i) => i.shortcut)
      .filter((shortcut) => shortcut !== undefined)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
  })

  it("adds each module's screens to its group, shown only while the module is on", () => {
    const all = withModuleScreens([{ id: 'sell', label: 'Sell', items: [] }], MODULES)
    expect(all[0]?.items.map((i) => [i.id, i.module, i.plannedIn])).toEqual([
      ['tables', 'restaurant', 'Restaurant · Release 1.3']
    ])
    expect(visibleNavigation(all, everything)).toEqual([])
    expect(
      visibleNavigation(all, { ...everything, modules: ['grocery', 'restaurant'] as const })[0]
        ?.items
    ).toHaveLength(1)
    // Every module screen is in the real navigation, under a unique path.
    const paths = NAVIGATION.flatMap((g) => g.items).map((i) => i.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const entry of MODULES.flatMap((m) => m.navigation)) expect(paths).toContain(entry.path)
  })
})
