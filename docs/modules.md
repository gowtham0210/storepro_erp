# Modules

How StorePro is one app with industry modules on top of a shared core (PRD §7; module M04).

## 1. Core and modules

Every store gets the **core**: billing, sales, customers, products, stock, purchases, suppliers,
expenses, reports, users, the audit log and settings. **Modules** add what one kind of store
needs on top of that:

| Module             | For               | In this version         |
| ------------------ | ----------------- | ----------------------- |
| Grocery and retail | Grocery stores    | Yes: always on for them |
| Electronics        | Electronics shops | Planned for Release 1.2 |
| Restaurant         | Restaurants       | Planned for Release 1.3 |
| Pharmacy           | Pharmacies        | Planned for Release 1.4 |

## 2. The manifest (M04-01)

Each module is described once in [`src/shared/modules.ts`](../src/shared/modules.ts):

| Field           | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `code`, `name`  | Matches the `modules` table; a test fails if they drift                         |
| `availability`  | `available`, or `planned` (listed, but can't be switched on), with `plannedFor` |
| `businessTypes` | Store types it is built for. A store's own type's module is always on           |
| `requires`      | Modules that must be on first                                                   |
| `navigation`    | Screens it adds: label, path, the group it joins, the permission it needs       |
| `permissions`   | Permissions only it uses (added to the catalogue with the module)               |

The renderer adds each module's screens to navigation from the manifest (`withModuleScreens()`
in `navigation.tsx`), choosing their icons there. The screens appear only while the module is on.

## 3. Switching modules on and off (M04-02)

- Setup switches on the store type's module (grocery). It can't be switched off.
- Administrators switch other available modules on and off under **Settings → Modules**.
  Managers see the list read-only.
- Rules, enforced by `ModuleService` and shown on screen: planned modules can't be switched on;
  a module whose requirements are off can't be switched on; a module others need can't be
  switched off.
- **Switching off never deletes anything** (PRD §7.3). It removes the module from
  `enabled_modules`, which hides its screens and refuses its requests. Its data and past invoices
  are untouched, and switching it back on brings everything back.
- Every switch is audited (`module.enabled`, `module.disabled`).

## 4. Feature flags (M04-03)

- **Services.** A handler that belongs to a module declares `module: 'restaurant'`. The service
  host then refuses its requests with `MODULE_DISABLED` while the module is off, before the
  handler runs. Services can also call `modules.assertEnabled(code)`.
- **UI.** The store profile carries `enabledModules`. `useEnabledModules()` gives them to any
  screen. Navigation filters on them. A module's screen opened directly while the module is off
  explains that, instead of saying the person lacks access.

## 5. Adding a module's feature

1. Set the module's `availability` to `available` when its first feature ships.
2. Add its screens to `navigation` in the manifest, and their icons to `MODULE_ICONS`.
3. Give its IPC handlers `module: '<code>'`, and add their sample inputs to
   `src/main/ipc/accessControl.test.ts`.
4. New permissions go in the catalogue and a migration, as for any permission
   (`docs/permissions.md`).
