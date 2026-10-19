import {
  BarChart3,
  Boxes,
  Code2,
  Package,
  ReceiptText,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  Warehouse
} from 'lucide-react'
import type { ReactNode } from 'react'
import { hasPermission, type AccessState } from '../state/accessStore'

export interface NavItem {
  id: string
  label: string
  path: string
  icon: ReactNode
  /** Fixed per item, so muscle memory survives items being hidden. */
  shortcut?: string
  /** Hidden unless the user has this permission. */
  permission?: string
  /** Hidden unless this business module is enabled. */
  module?: string
  /** Planned module that builds the screen; shown on placeholders. */
  plannedIn: string
  description: string
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

/** PRD §10.2, grouped by task so the list scans quickly. */
export const NAVIGATION: readonly NavGroup[] = [
  {
    id: 'sell',
    label: 'Sell',
    items: [
      {
        id: 'billing',
        label: 'Billing',
        path: '/billing',
        icon: <ShoppingCart />,
        shortcut: 'Ctrl+1',
        permission: 'sale.create',
        plannedIn: 'M11 · Point of Sale',
        description: 'Scan items, take payment and print the receipt.'
      },
      {
        id: 'sales',
        label: 'Sales',
        path: '/sales',
        icon: <ReceiptText />,
        shortcut: 'Ctrl+2',
        permission: 'sale.view',
        plannedIn: 'M11 · Point of Sale',
        description: 'Find past bills, reprint receipts and process returns.'
      },
      {
        id: 'customers',
        label: 'Customers',
        path: '/customers',
        icon: <Users />,
        shortcut: 'Ctrl+3',
        permission: 'customer.view',
        plannedIn: 'M17 · Customers',
        description: 'Customer details and purchase history.'
      }
    ]
  },
  {
    id: 'stock',
    label: 'Stock',
    items: [
      {
        id: 'products',
        label: 'Products',
        path: '/products',
        icon: <Package />,
        shortcut: 'Ctrl+4',
        permission: 'product.view',
        plannedIn: 'M09 · Product Catalogue',
        description: 'Items, prices, barcodes and categories.'
      },
      {
        id: 'inventory',
        label: 'Inventory',
        path: '/inventory',
        icon: <Warehouse />,
        shortcut: 'Ctrl+5',
        permission: 'inventory.view',
        plannedIn: 'M14 · Inventory',
        description: 'Stock levels, low-stock alerts, adjustments and stock counts.'
      },
      {
        id: 'purchases',
        label: 'Purchases',
        path: '/purchases',
        icon: <Boxes />,
        shortcut: 'Ctrl+6',
        permission: 'purchase.view',
        plannedIn: 'M15 · Suppliers & Purchases',
        description: 'Purchase orders and goods received.'
      },
      {
        id: 'suppliers',
        label: 'Suppliers',
        path: '/suppliers',
        icon: <Truck />,
        shortcut: 'Ctrl+7',
        permission: 'supplier.view',
        plannedIn: 'M15 · Suppliers & Purchases',
        description: 'Supplier contacts.'
      }
    ]
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      {
        id: 'reports',
        label: 'Reports',
        path: '/reports',
        icon: <BarChart3 />,
        shortcut: 'Ctrl+8',
        permission: 'report.view',
        plannedIn: 'M19 · Reports & Dashboard',
        description: 'Daily sales, top products, stock and purchase reports.'
      },
      {
        id: 'expenses',
        label: 'Expenses',
        path: '/expenses',
        icon: <Wallet />,
        shortcut: 'Ctrl+9',
        permission: 'expense.view',
        plannedIn: 'M18 · Expenses',
        description: 'Rent, salaries and other running costs.'
      },
      {
        id: 'settings',
        label: 'Settings',
        path: '/settings',
        icon: <Settings />,
        shortcut: 'Ctrl+,',
        permission: 'settings.view',
        plannedIn: 'M03 · Store Setup',
        description: 'Store profile, receipts, users, printers and backups.'
      }
    ]
  }
]

/** Development-only tools; never shown in packaged builds. */
export const DEV_NAVIGATION: NavGroup = {
  id: 'developer',
  label: 'Developer',
  items: [
    {
      id: 'components',
      label: 'Components',
      path: '/dev/components',
      icon: <Code2 />,
      plannedIn: 'M23 · UI Shell',
      description: 'Every design-system component, for review.'
    }
  ]
}

export function isItemVisible(
  item: NavItem,
  access: Pick<AccessState, 'modules' | 'permissions'>
): boolean {
  return (
    hasPermission(access, item.permission) &&
    (item.module === undefined || access.modules.includes(item.module))
  )
}

/** Groups and items the user may see; empty groups are dropped. */
export function visibleNavigation(
  groups: readonly NavGroup[],
  access: Pick<AccessState, 'modules' | 'permissions'>
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isItemVisible(item, access))
    }))
    .filter((group) => group.items.length > 0)
}

export function findNavItem(path: string): NavItem | undefined {
  return [...NAVIGATION, DEV_NAVIGATION]
    .flatMap((group) => group.items)
    .find((item) => path.startsWith(item.path))
}
