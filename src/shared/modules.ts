/**
 * The module manifest (M04-01, PRD §7.2–7.3).
 *
 * StorePro is one application with a shared core (catalogue, billing, stock,
 * purchases, customers, reports) and industry modules on top. Each module is
 * described here once: what it is, whether this version includes it, which
 * store types it is for, what it needs, and the screens and permissions it
 * adds. Migration 0001 seeds the same codes and names into `modules`; a test
 * keeps the two identical.
 *
 * The rest of the app reads this:
 *  - the main process refuses a module's requests while it is switched off
 *    (handlers declare `module`), and services can ask the module service;
 *  - navigation shows a module's screens only while it is switched on;
 *  - Settings → Modules lists them.
 *
 * Switching a module off hides it. It never deletes data or changes past
 * invoices; switching it back on brings everything back.
 *
 * Runtime-dependency free: used by both processes.
 */
import type { PermissionCode } from './permissions'

export type ModuleCode = 'grocery' | 'electronics' | 'restaurant' | 'pharmacy'

/** A screen a module adds. Its icon is chosen by the renderer (navigation.tsx). */
export interface ModuleNavEntry {
  id: string
  label: string
  path: string
  /** Which navigation group it joins. */
  group: 'sell' | 'stock' | 'manage'
  permission?: PermissionCode
  description: string
}

export interface ModuleManifest {
  code: ModuleCode
  name: string
  description: string
  /** 'planned' modules are listed so people know they are coming, but can't be switched on. */
  availability: 'available' | 'planned'
  /** For planned modules: when they arrive. */
  plannedFor?: string
  /** Store types this module is built for. A store's own type's module is always on. */
  businessTypes: readonly string[]
  /** Other modules that must be on for this one to work. */
  requires: readonly ModuleCode[]
  navigation: readonly ModuleNavEntry[]
  /** Permissions only this module uses (added to the catalogue with the module). */
  permissions: readonly PermissionCode[]
}

export const MODULES: readonly ModuleManifest[] = [
  {
    code: 'grocery',
    name: 'Grocery and retail',
    description: 'Loose and weighed items, barcode price labels and weighing scales.',
    availability: 'available',
    businessTypes: ['grocery'],
    requires: [],
    navigation: [],
    permissions: []
  },
  {
    code: 'electronics',
    name: 'Electronics',
    description: 'Serial and IMEI numbers, warranties and device returns.',
    availability: 'planned',
    plannedFor: 'Release 1.2',
    businessTypes: ['electronics'],
    requires: [],
    navigation: [
      {
        id: 'serials',
        label: 'Serial numbers',
        path: '/serials',
        group: 'stock',
        permission: 'inventory.view',
        description: 'Find a device by its serial or IMEI number.'
      }
    ],
    permissions: []
  },
  {
    code: 'restaurant',
    name: 'Restaurant',
    description: 'Tables, kitchen tickets, menu modifiers and service charges.',
    availability: 'planned',
    plannedFor: 'Release 1.3',
    businessTypes: ['restaurant'],
    requires: [],
    navigation: [
      {
        id: 'tables',
        label: 'Tables',
        path: '/tables',
        group: 'sell',
        permission: 'sale.create',
        description: 'Open tables and their running orders.'
      }
    ],
    permissions: []
  },
  {
    code: 'pharmacy',
    name: 'Pharmacy',
    description: 'Batches and expiry dates, prescriptions and regulated medicines.',
    availability: 'planned',
    plannedFor: 'Release 1.4',
    businessTypes: ['pharmacy'],
    requires: [],
    navigation: [
      {
        id: 'batches',
        label: 'Batches and expiry',
        path: '/batches',
        group: 'stock',
        permission: 'inventory.view',
        description: 'Stock by batch, and what expires soon.'
      }
    ],
    permissions: []
  }
]

export function moduleManifest(code: string): ModuleManifest | undefined {
  return MODULES.find((manifest) => manifest.code === code)
}

/** The module a store type runs on, which can't be switched off. */
export function moduleForBusinessType(businessTypeCode: string): ModuleManifest | undefined {
  return MODULES.find((manifest) => manifest.businessTypes.includes(businessTypeCode))
}
