import { describe, expect, it } from 'vitest'
import { PERMISSION_CODES } from '@shared/permissions'
import { NAVIGATION, visibleNavigation, type NavGroup } from './navigation'

const everything = { modules: ['grocery'], permissions: PERMISSION_CODES }

describe('visibleNavigation', () => {
  it('shows everything when the user has every permission', () => {
    const groups = visibleNavigation(NAVIGATION, everything)
    expect(groups.flatMap((g) => g.items).length).toBe(12)
  })

  it('hides items without permission and drops empty groups', () => {
    const groups = visibleNavigation(NAVIGATION, {
      modules: ['grocery'],
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
    expect(visibleNavigation(withModule, { ...everything, modules: ['restaurant'] })).toHaveLength(
      1
    )
  })

  it('never gives two screens the same shortcut', () => {
    const shortcuts = NAVIGATION.flatMap((g) => g.items)
      .map((i) => i.shortcut)
      .filter((shortcut) => shortcut !== undefined)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
  })
})
