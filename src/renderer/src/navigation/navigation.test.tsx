import { describe, expect, it } from 'vitest'
import { NAVIGATION, visibleNavigation, type NavGroup } from './navigation'

describe('visibleNavigation', () => {
  it('shows everything when the user has every permission', () => {
    const groups = visibleNavigation(NAVIGATION, { modules: ['grocery'], permissions: 'all' })
    expect(groups.flatMap((g) => g.items).length).toBe(11)
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
    expect(visibleNavigation(withModule, { modules: ['grocery'], permissions: 'all' })).toEqual([])
    expect(
      visibleNavigation(withModule, { modules: ['restaurant'], permissions: 'all' })
    ).toHaveLength(1)
  })

  it('never gives two screens the same shortcut', () => {
    const shortcuts = NAVIGATION.flatMap((g) => g.items)
      .map((i) => i.shortcut)
      .filter((shortcut) => shortcut !== undefined)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
  })
})
