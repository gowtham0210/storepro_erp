# StorePro

Offline-first Windows billing and inventory management for grocery stores and small retailers.
Built with Electron, React, TypeScript and SQLite (`node:sqlite`).

See [`docs/planning/PRD.md`](docs/planning/PRD.md), [`docs/planning/MODULES.md`](docs/planning/MODULES.md) and
[`docs/planning/MVP_TASKS.md`](docs/planning/MVP_TASKS.md) for the product requirements and the build plan.

## Requirements

- Node.js 22.12 or later
- Windows 10/11 x64 for running and packaging releases (development also works on Linux and macOS)

## Commands

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run dev`       | Start the app with the Vite dev server and hot reload              |
| `npm run build`     | Type-check, then build main, preload and renderer into `out/`      |
| `npm run preview`   | Run the production build locally                                   |
| `npm test`          | Run unit tests (Vitest)                                            |
| `npm run lint`      | ESLint                                                             |
| `npm run typecheck` | TypeScript for the Node (main/preload) and web (renderer) projects |
| `npm run format`    | Prettier                                                           |
| `npm run dist:win`  | Build the Windows x64 NSIS installer into `dist/`                  |
| `npm run dist:dir`  | Build an unpacked app for the current OS (packaging smoke test)    |

`npm install` also downloads the Electron binary (Electron 44 no longer does this by itself).
Building the Windows installer on Linux needs Wine (32- and 64-bit); CI builds it on a Windows
runner instead. See [`docs/testing.md`](docs/testing.md) for the test layers and the CI pipeline.

## Project layout

```
src/
  shared/             Code used by both sides of the IPC boundary (no runtime deps)
    ipc/contract.ts   Every renderer → main channel, with input/output types
    ipc/errors.ts     AppError and the IpcResult error envelope
    money.ts          Integer minor-unit money: parse, format, multiply, allocate
    quantity.ts       Quantities in thousandths of a unit
  main/               Electron main process (trusted)
    index.ts          Startup: single-instance lock, security, IPC, window, shutdown
    ipc/              Service host and handlers (validation, sender checks, errors)
    security/         app:// protocol, CSP, navigation/permission lockdown
    window/           Main window and persisted window state
    lifecycle/        Graceful shutdown, crash handling, unclean-shutdown detection
    logging/          Rotating file logger with redaction of sensitive fields
    db/               SQLite: connection wrapper, migrations, integrity check, repository base
      migrations/     Versioned schema (NNNN_name.sql), never edited once shipped
      dev/            Test-data builders and the performance seed
  preload/            Sandboxed bridge exposing window.storepro.invoke
  renderer/src/       React UI (untrusted: no Node.js, no filesystem)
    components/ui/    Design system: Button, Field, inputs, Money, DataTable, Dialog, toasts, ...
    layout/           App shell: sidebar, top bar, connectivity indicator, shortcut help
    navigation/       Navigation config, permission/module filtering, routes
    shortcuts/        Scoped keyboard shortcut framework
    forms/            useForm (Zod schemas shared with the main process)
    styles/           Design tokens (theme.css) and contrast tests
e2e/                  Playwright end-to-end tests against the built app
docs/                 Data model, UI guidelines, testing guide, planning documents
```

## Architecture notes

### Security model

- The renderer runs with `contextIsolation`, `sandbox`, and no Node.js integration. Its only
  access to the system is `window.storepro.invoke(channel, input)`, limited to channels in
  `src/shared/ipc/contract.ts`, and `window.storepro.on(event, listener)`, limited to the
  main → renderer events declared there (`IpcEvents`). ESLint blocks `electron` and `node:*`
  imports in renderer code.
- In production the UI is served from `app://storepro/` (a privileged custom scheme), not
  `file://`. Responses carry a strict CSP (`script-src 'self'`, no inline scripts or eval).
  Development uses a relaxed CSP that only the Vite dev server gets.
- Navigation away from the app, `window.open`, `<webview>` and all browser permission
  requests are denied. Plain `https:` links open in the system browser.
- The main process checks the sender origin of every IPC call and validates its input with
  Zod before a handler runs. Unexpected errors are logged in full but reach the renderer only
  as a generic `INTERNAL` error.
- The packaged binary has its Electron fuses set: no `ELECTRON_RUN_AS_NODE`, no
  `NODE_OPTIONS`, no `--inspect`, asar integrity validation, and loading only from the asar.

### Sign-in and sessions

- **First run** asks for the administrator account. After that, everyone signs in with their own
  username and password.
- **Password storage.** Passwords are hashed with scrypt (N = 2^17, r = 8, p = 1; OWASP's
  recommended minimum), using Node's built-in crypto. The parameters are stored with each hash,
  and older hashes are upgraded at the next sign-in.
- **Password policy** (NIST 800-63B). At least 8 characters, any characters allowed, and no
  composition rules. Common passwords and passwords containing the username are refused.
- **Sign-in errors.** Wrong username and wrong password get the same message and the same timing,
  so usernames can't be probed.
- **Throttling.** After 5 failures, sign-in is blocked for 30 s, doubling up to 15 min. Counters
  are stored, so restarting doesn't reset them.
- **Sessions.** The session lives only in the main process and ends when the app closes. Ctrl+L
  or 15 minutes of inactivity locks the screen without losing work underneath. A password reset by
  an administrator must be changed at the next sign-in.
- **Permissions.** Every IPC handler declares who may call it, and the service host checks it
  before the handler runs. The user is re-read on every request, so deactivation and role changes
  apply immediately. Hiding screens in the UI is only a convenience. See
  [`docs/permissions.md`](docs/permissions.md) for the roles, the no-escalation rule and manager
  approvals.
- **Audit.** Sign-ins (including failures), sign-outs, refused requests, manager approvals and
  every user change are written to the append-only audit log, in the same transaction as the
  change. Passwords never are. Administrators and managers can read it under **Manage → Audit
  log**. See [`docs/audit-log.md`](docs/audit-log.md).

### Store setup

On first launch a short wizard sets up the store: details, business type, currency, time zone,
GST, receipts and the administrator account. It works offline and saves everything at once.
Until it's done, the main process refuses every other request. Administrators change the details
later under **Manage → Settings**. Dates follow the store's time zone, not the computer's. See
[`docs/store-setup.md`](docs/store-setup.md).

### Modules

Every store gets the shared core; industry modules add what one kind of store needs. The grocery
module is always on for grocery stores; the others are planned for later releases. A module's
screens appear, and its requests are accepted, only while it is switched on. Switching a module
off never deletes its data. See [`docs/modules.md`](docs/modules.md).

### Products

**Stock → Products** holds what the store sells: products, their pack sizes (each with its own
price, MRP, cost, unit and barcodes), categories and units. A barcode belongs to one item; SKUs are
assigned if left empty. Items are archived, never deleted, so past bills keep them. Price changes
apply to the next bill and are audited with the old and new amounts. Billing finds items by
barcode, SKU or name prefix. See [`docs/catalogue.md`](docs/catalogue.md).

### Pricing, discounts and tax

`src/shared/pricing.ts` calculates line totals, line and bill-level discounts (allocated across
lines by largest remainder), GST (split equally into CGST and SGST, plus cess) or single-rate tax
for both tax-inclusive and tax-exclusive prices, and bill round-off. Administrators manage tax
classes and set bill rounding and the cashier discount limit under **Manage → Settings**; discounts
beyond the limit or price overrides require manager approval. See
[`docs/pricing-and-tax.md`](docs/pricing-and-tax.md).

### Inventory and stock ledger

**Stock → Inventory** shows stock on hand, low-stock and out-of-stock alerts, movement history with
running balances across sales, voids, returns, goods receipts and adjustments, manual stock
adjustments (`ADJ000001`, …) with reasons, and physical stock count reconciliation. Negative stock
is blocked by default unless enabled in store settings. See [`docs/inventory.md`](docs/inventory.md).

### Billing, payments, printing and hardware

**Sell → Billing** is the keyboard-driven Point of Sale counter: barcode/SKU scan (including a
global keyboard-wedge burst detector `M21-01` and variable-weight EAN-13 grocery scale barcodes
`M24-02`), FTS item search (`F4`), fractional quantities for weight/volume items (`M24-01`), line
and bill discounts (`F6`) with manager override support, held bills (`F8`/`F9`), and single or
split payments (`F12`) across Cash (with tendered/change calculation), UPI (labelled `Recorded (not
verified)`), and Card. Checkout saves the sale, tax snapshot, payments, sequential invoice number
(`INV000001`, …) and stock deduction in one atomic transaction with idempotency protection.
Receipts format for 58 mm (32-col) and 80 mm (48-col) thermal paper (`M13-02`, `M13-03`), support
Windows driver and ESC/POS raw printing with cash-drawer kick (`M21-02`, `M21-04`), never block a
saved sale if printing fails (`M13-04`), and require `sale.reprint` (or manager approval) with a
`*** DUPLICATE / REPRINT ***` banner and audit log entry when reprinting (`M13-05`). **Stock →
Products** also prints Code-128B shelf and pre-pack price labels (`M24-03`). See
[`docs/billing-and-payments.md`](docs/billing-and-payments.md) and
[`docs/printing-and-hardware.md`](docs/printing-and-hardware.md).

### Offline and connectivity

StorePro needs no internet connection: everything is stored on this computer. The header always
shows whether the computer is online. The main process watches the connection (Electron's
`net.isOnline()`, a local check that sends nothing over the network) every few seconds and after
sleep, and pushes changes to the window as `connectivity:changed` events. A network without
internet access, such as a router whose line is down, still shows as online. Nothing depends on
the status: it only tells people what to expect from online features (none in this release).

### Adding an IPC channel

1. Declare it in `IpcContract` and `channelRegistry` in `src/shared/ipc/contract.ts`.
2. Add a handler under `src/main/ipc/handlers/` and include it in `createHandlers`. It needs a Zod
   `input` schema and an `access` rule: `'public'`, `'signed-in'` or a permission code such as
   `'stock.adjust'`. The compiler reports a channel that has no handler or no access rule.
3. Call it from the renderer with `invoke('channel:name', input)` from `src/renderer/src/ipc/client.ts`.
   Failures throw `AppError` with a `code`.

A guarded handler receives the signed-in user as `context.actor` and passes it to the service. The
service checks the permission again with `assertCan(actor, ...)`. Add a sample input for the new
channel to `SAMPLE_INPUTS` in `src/main/ipc/accessControl.test.ts`, which proves the channel
refuses signed-out users and roles without the permission. Guarded channels are also refused until
store setup is complete; mark a handler `beforeSetup: true` only if setup itself needs it.

To push something from the main process to the window, declare it in `IpcEvents` and
`eventRegistry` in the contract and send it with the publisher from `src/main/ipc/events.ts`; the
renderer listens with `window.storepro.on(event, listener)`.

### Reliability

- **Single instance:** starting StorePro again focuses the open window.
- **Graceful shutdown:** modules register cleanup with `ShutdownCoordinator`. Hooks run in
  reverse order with a per-hook timeout, on quit, SIGINT/SIGTERM and Windows log-off.
- **Unclean-shutdown detection:** a session marker in the user data folder is removed only after
  a clean shutdown. If it's still there at startup, the app reports `recoveredFromUncleanShutdown`
  and the UI shows a notice. Later modules (e.g. the M02 database integrity check) hook in here.
- **Crashes:** a crashed renderer is reloaded up to 3 times per minute, then the user is asked to
  restart. An uncaught main-process error is logged and the app relaunches, unless it has crashed
  more than 3 times in 10 minutes.
- **Logs** are written to `%APPDATA%\StorePro\logs\main.log` (5 MB × 5 files). Fields such as
  `password`, `pin`, `token` or `secret` are masked. Renderer errors are forwarded to the same log.

### User interface

React with Tailwind CSS v4, using semantic design tokens only. Routing is React Router, server
state is TanStack Query over IPC, and UI state is Zustand. Icons are Lucide. See
[`docs/ui-guidelines.md`](docs/ui-guidelines.md) for the UX principles, tokens, component rules,
keyboard map and the review checklist for new screens. In development, **Developer → Components**
shows every component.

### Database

The store's data is one SQLite file, `%APPDATA%\StorePro\data\storepro.db`. It's opened at startup,
checked for integrity if the last session ended uncleanly, migrated (after a backup into
`%APPDATA%\StorePro\backups`), and closed cleanly on shutdown. The schema is in third normal form.
See [`docs/data-model.md`](docs/data-model.md) for the principles, the table-by-table 3NF analysis,
documented exceptions, migration rules and performance results.

### User data

The database, backups, window state, the session marker, crash history and logs live in `%APPDATA%\StorePro`. The
installer never deletes this folder on uninstall or upgrade.
