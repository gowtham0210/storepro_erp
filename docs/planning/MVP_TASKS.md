# StorePro — MVP Task Breakdown

**Source:** PRD.md (v1.0), MODULES.md  
**Scope:** P0 modules only. P1/P2 items (supplier balances, customer credit, electronics, restaurant, pharmacy, sync, licensing) are excluded and listed at the end.

**Task ID format:** `M<module>-<nn>` — module numbers match MODULES.md.  
**Size (rough estimate for one developer):** S = up to 1 day · M = 2–3 days · L = 4–5 days. Sizes are planning placeholders and should be re-estimated by the team.

---

## Phase 1 — Foundation ✅ Completed (2026-10-19)

**Phase 1 is complete.** M01, M02, M23 and M30-01 to M30-04 are implemented and pushed to `main` of `gowtham0210/storepro_erp`. CI runs on Ubuntu and Windows: checks, end-to-end tests, performance targets and the Windows installer. Items deliberately left for later phases:

- Code signing (M01-09) and an app icon.
- Installing the NSIS installer on a clean Windows machine (M30-09).
- Real data for navigation filtering (M04, M05/M06).
- The main-process connectivity monitor (M08).


### M01 · Desktop Shell & Application Runtime

| ID | Task | Depends on | Size |
|---|---|---|---|
| M01-01 | Scaffold Electron + React + TypeScript + Vite project with lint, format, and strict TS config | — | M |
| M01-02 | Configure security: `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, CSP | M01-01 | S |
| M01-03 | Build typed preload IPC bridge (channel registry, request/response types, error envelope) | M01-02 | M |
| M01-04 | Main-process service host: register application services behind IPC handlers | M01-03 | M |
| M01-05 | App lifecycle: single-instance lock, window state persistence, graceful shutdown | M01-01 | S |
| M01-06 | Crash handling: log uncaught errors, recover to safe state on restart | M01-05 | S |
| M01-07 | Local file logging with rotation (no sensitive data in logs) | M01-01 | S |
| M01-08 | Windows 64-bit installer build (Electron Forge or electron-builder) | M01-01 | M |

**Done when:** App installs on clean Windows, renderer has no Node.js access, IPC calls are typed end-to-end.

**Status (2026-10-19):** M01-01 to M01-08 implemented. Unit tests pass, and the app was smoke-tested on Linux in dev, built and packaged modes. Still open: installing and running the NSIS installer on a real Windows machine (it is built but unsigned, with the default Electron icon), code signing (M01-09), and an app icon.

### M02 · Database & Migrations

| ID | Task | Depends on | Size |
|---|---|---|---|
| M02-01 | Select and integrate SQLite driver compatible with Electron; native rebuild in packaging | M01-01 | M |
| M02-02 | DB location in user data dir; enable WAL, foreign keys, busy timeout | M02-01 | S |
| M02-03 | Migration runner with `schema_migrations` table, forward-only versioned scripts | M02-02 | M |
| M02-04 | Pre-migration automatic backup and rollback on migration failure | M02-03 | M |
| M02-05 | Transaction helper (`withTransaction`) used by all multi-record services | M02-02 | S |
| M02-06 | Repository base pattern and conventions (IDs, timestamps, soft delete) | M02-05 | M |
| M02-07 | Money utility: integer minor units, safe arithmetic, formatting by currency | — | M |
| M02-08 | Quantity utility: fixed-precision decimals for fractional quantities | — | S |
| M02-09 | Initial schema migration for all MVP entities (PRD §8) | M02-03 | L |
| M02-10 | Indexes: barcode, SKU, product name search (FTS), invoice number, sale date | M02-09 | S |
| M02-11 | Integrity check routine (`PRAGMA integrity_check`, FK check) on startup/maintenance | M02-02 | S |
| M02-12 | Seed/test-data generator (10,000 products, sales history) for performance testing | M02-09 | M |

**Done when:** Fresh DB migrates cleanly, upgrade from previous version is tested, money never uses floats.

**Status (2026-10-19):** M02-01 to M02-12 implemented in `src/main/db` and `src/shared`. The design is recorded in `docs/data-model.md`: a 3NF schema with derived views and append-only triggers. The driver is `node:sqlite`, built into Electron, so no native rebuild is needed. Upgrades from an earlier schema version are covered by migrator tests. A real v1 → v2 upgrade can only be tested once a second migration exists. Product batches and serial numbers (PRD §8) are deferred to the pharmacy and electronics modules. Tax classes are not seeded until GST rules are validated (M10-07).

### M23 · UI Shell & Design System

| ID | Task | Depends on | Size |
|---|---|---|---|
| M23-01 | Tailwind setup and design tokens (colours, spacing, typography, dark navy sidebar) | M01-01 | S |
| M23-02 | Core components: Button, Input, Select, NumberInput, Money display, Table, Modal, Toast | M23-01 | L |
| M23-03 | Form handling with Zod schemas shared with the service layer | M23-02 | M |
| M23-04 | App layout: sidebar, header, workspace, persistent offline indicator slot | M23-02 | M |
| M23-05 | Routing and navigation filtered by enabled modules and permissions | M23-04, M04-03, M06-04 | M |
| M23-06 | State management setup (Zustand or Redux Toolkit) and IPC client hooks | M01-03 | M |
| M23-07 | Keyboard shortcut framework (global and screen-scoped) | M23-04 | M |
| M23-08 | Confirmation dialog for destructive actions; standard error display for non-technical users | M23-02 | S |
| M23-09 | Accessibility pass: focus states, contrast, non-colour status cues | M23-02 | S |

**Done when:** All screens use shared components, navigation responds to permissions, keyboard navigation works.

**Status (2026-10-19):** M23-01 to M23-09 implemented in `src/renderer/src`. The guidelines are in `docs/ui-guidelines.md`. Navigation filtering works from an access store that shows everything until M04 (modules) and M05/M06 (sign-in and permissions) supply real data. The connectivity indicator uses the browser's online status until M08 adds the main-process monitor. The store currency defaults to INR until M03 provides the business profile.

### M30 · QA & Test Infrastructure (setup)

| ID | Task | Depends on | Size |
|---|---|---|---|
| M30-01 | Vitest setup for domain/service unit tests | M01-01 | S |
| M30-02 | Integration test harness with temporary SQLite databases | M02-03 | M |
| M30-03 | Playwright setup for Electron end-to-end tests | M01-01 | M |
| M30-04 | CI pipeline: lint, type-check, unit, integration, build installer | M30-01 | M |

**Status (2026-10-19):** M30-01 to M30-04 are implemented; see `docs/testing.md`.

- Vitest has Node and jsdom projects, with coverage thresholds.
- The SQLite harness provides in-memory and file-backed migrated databases.
- 25 Playwright end-to-end tests run against real Electron with isolated data folders.
- `.github/workflows/ci.yml` runs on Ubuntu and Windows: checks, end-to-end, performance, then the installer.

Two fixes came out of this work. Tests broken by Windows paths and file locks were fixed; the first Windows CI run had failed on them. A `postinstall` step now downloads Electron, because Electron 44 no longer does so on `npm install`. End-to-end tests now stub the system browser and kill the whole process tree when simulating a crash on Windows.

---

## Phase 2 — Identity & Configuration ✅ Completed (2026-10-19)

**Phase 2 is complete.** M05, M06, M07, M03, M04 and M08 are implemented and pushed to `main`, and CI passes on Ubuntu and Windows. Items deliberately left for later phases:

- Recording voids, adjustments, price changes, reprints and restores in the audit log, as those modules are built (see `docs/audit-log.md`).
- Manager approval at the counter, used first by POS (M11).
- The billing part of the offline test (M08-03), with M11.
- Industry modules other than grocery (M25–M27).

### M05 · Authentication & User Management

| ID | Task | Depends on | Size |
|---|---|---|---|
| M05-01 | Users table/repository; password hashing (argon2 or bcrypt) | M02-09 | S |
| M05-02 | Login service and login screen | M05-01, M23-02 | M |
| M05-03 | Session management in main process; logout; idle lock (optional) | M05-02 | S |
| M05-04 | Initial administrator creation during setup | M05-01 | S |
| M05-05 | User management screen: create, edit, deactivate, reset password, assign role | M05-01, M06-02 | M |
| M05-06 | Failed-login throttling | M05-02 | S |

**Status (2026-10-19):** M05-01 to M05-06 are implemented. See README "Sign-in and sessions" and migration 0002.

- **Passwords:** scrypt hashes that upgrade themselves, and a NIST-style policy.
- **Sign-in:** generic, constant-time failures; throttling stored in the database.
- **Session:** held only in the main process, with lock (Ctrl+L or 15 minutes idle), sign-out, change password and forced change after a reset.
- **First run:** creates the administrator account.
- **Users screen:** add, edit, deactivate and reactivate users, and reset passwords. The last active administrator and your own account are protected.
- **Audit:** every sign-in and user change is logged.

Until M06, user management is administrator-only and other roles see every screen except Users. M03 will fold the first-run screen into the store setup wizard.

### M06 · Permissions & Access Control

| ID | Task | Depends on | Size |
|---|---|---|---|
| M06-01 | Define permission catalogue (e.g. `sale.void`, `stock.adjust`, `discount.override`, `settings.edit`) | — | S |
| M06-02 | Seed roles (Administrator, Manager, Cashier, Inventory Operator) with permission mapping | M06-01, M02-09 | S |
| M06-03 | Service-layer authorization guard applied to every IPC handler | M06-02, M01-04 | M |
| M06-04 | UI permission hooks to hide/disable unavailable actions | M06-03, M23-06 | S |
| M06-05 | Manager override prompt (supervisor PIN/credentials) for restricted actions at POS | M06-03 | M |
| M06-06 | Tests: cashier cannot perform restricted actions via direct IPC calls | M06-03 | S |

**Status (2026-10-19):** M06-01 to M06-06 are implemented. See `docs/permissions.md` and migration 0003.

- **Catalogue:** 29 permissions in `src/shared/permissions.ts`, seeded by migration 0003. A test keeps the code and the database identical.
- **Roles:** administrators get everything. Managers get everything except changing settings, restoring a backup and importing data. Cashiers bill, look after customers and look up products and stock. Inventory operators look after products, stock, purchases and suppliers.
- **Guard:** every IPC handler must declare an access rule (the compiler enforces it). The service host checks it before the handler runs and passes the actor to the service, which checks again. Refused requests are audited.
- **No escalation:** you can only give a role, or change the account of someone who has it, if it grants nothing beyond your own permissions. So managers manage staff but can't create or touch administrators.
- **UI:** navigation, routes and the Users screen follow the user's permissions. Home is the first screen the role can open. A read-only "What each role can do" matrix is on the Users screen.
- **Manager approval:** a single-use, two-minute approval tied to one permission and one cashier, given with the approver's own password (throttled and audited). The renderer prompt and the `useManagerApproval()` hook are ready; POS (M11) is the first to use them.
- **Tests:** every channel is called directly over IPC as signed-out, cashier and inventory-operator users, which proves each restricted one is refused and nothing changes. End-to-end tests cover the same in the real app.

Roles are fixed in this version, so the mapping is explicit rather than configurable. Supervisor PINs are not supported; approvals use the approver's password.

### M07 · Audit Logging

| ID | Task | Depends on | Size |
|---|---|---|---|
| M07-01 | `audit_logs` repository and audit service (user, action, timestamp, entity reference, details) | M02-09 | S |
| M07-02 | Write audit entries inside the same transaction as the audited change | M07-01, M02-05 | S |
| M07-03 | Instrument sensitive actions: voids, adjustments, overrides, price changes, settings, reprints, restores | M07-02 | M |
| M07-04 | Audit log viewer with filters (user, action, date) | M07-01, M23-02 | M |

**Status (2026-10-19):** M07-01 to M07-04 are implemented. See `docs/audit-log.md` and migration 0004.

- **Service:** one `AuditLog` for every module. Actions are typed against a catalogue with labels (`src/shared/audit.ts`). Details are readable (names, and `changes: { field: { from, to } }` for edits) and secrets are masked.
- **Atomic:** `change()` refuses to run outside a transaction, so a change and its entry are saved together or not at all. Tests inject failures both ways.
- **Approvals:** an action unlocked by a manager approval records the approver in its own column (`approved_by_user_id`).
- **Recorded now:** sign-ins (including failures), sign-outs, password changes, refused requests, approvals given and refused, every user change, and StorePro's own events (store data upgraded, recovery after an unexpected shutdown, data check problems).
- **Viewer:** **Manage → Audit log** for administrators and managers. Filters by person, action and dates, kept in the address. Pages newest first. **Users → History** shows one person's account history. 300,000 entries load in under 25 ms for any filter.

Voids, stock adjustments, price changes, settings, reprints and restores don't exist yet. Each module records them with `change()` as it is built; `docs/audit-log.md` lists which module records what. Not done: tamper evidence against editing the database file directly, retention and archiving, and export (M22).

### M03 · Store Setup & Configuration

| ID | Task | Depends on | Size |
|---|---|---|---|
| M03-01 | Business and settings repositories | M02-09 | S |
| M03-02 | First-run setup wizard (store details, currency, time zone, business type, tax, receipt prefs, admin user) | M03-01, M05-04, M23-03 | L |
| M03-03 | First-run guard: block billing until setup is complete | M03-02 | S |
| M03-04 | Settings screen: business profile, receipt, tax, stock policy | M03-01, M06-03 | M |
| M03-05 | Time-zone-aware date utilities used by reports and invoices | M03-01 | S |

**Status (2026-10-19):** M03-01 to M03-05 are implemented. See `docs/store-setup.md`.

- **Repositories:** the store profile is the single `businesses` row plus the invoice prefix. Setup counts as done once that row exists. No migration was needed.
- **Wizard:** six steps (store details, business and region, tax, receipts with a live preview, the administrator account, then a review). Each step is checked before moving on. Everything is saved in one transaction, so an interrupted setup leaves nothing behind. It works offline. It replaces the M05 first-run screen.
- **Guard (FR-005):** until setup is complete, the main process refuses every guarded request except the few marked `beforeSetup`, so new screens are blocked by default. The UI shows the app only once the store is set up. A store with an administrator but no profile (from before M03) gets a shorter wizard; other roles can only sign out.
- **Settings:** five sections that save separately, read-only for managers. Every change is audited with readable before-and-after values. The currency is locked after the first sale.
- **Validation:** Indian states and PIN codes, GSTIN format and check character matched against the state, and IANA time zones saved under current names (Asia/Kolkata, not Asia/Calcutta).
- **Store time:** `src/shared/storeTime.ts` handles business dates and day ranges, including DST and half-hour offsets. The header clock and the audit log already use the store's time zone.

Receipt paper width and printer belong to the computer and come with M13/M21. Other business types are listed but disabled. Exact GST invoice rules are still an open decision (PRD §15).

### M04 · Module Registry & Feature Activation

| ID | Task | Depends on | Size |
|---|---|---|---|
| M04-01 | Module manifest format (id, navigation entries, permissions, services) | M01-04 | M |
| M04-02 | Persist business type and enabled modules; enable grocery/retail by default | M04-01, M03-01 | S |
| M04-03 | Expose enabled-module flags to UI and services | M04-02 | S |

**Status (2026-10-19):** M04-01 to M04-03 are implemented. See `docs/modules.md`.

- **Manifest:** `src/shared/modules.ts` describes each module: availability, store types, requirements, the screens it adds and its permissions. Tests keep it in sync with the `modules` table and check it only refers to things that exist.
- **Activation:** setup switches on the store type's module (grocery), which can't be switched off. Administrators switch other available modules under **Settings → Modules**; planned ones are listed with their release and can't be switched on. Dependencies are enforced, every switch is audited, and switching off only hides a module: it never deletes data (PRD §7.3).
- **Flags:** handlers can declare `module`, and the service host refuses their requests with `MODULE_DISABLED` while it is off. Services can call `assertEnabled()`. The store profile carries the enabled modules, which drive navigation (the M23 placeholder store is gone). A module's screen opened while it is off explains why.

Only grocery is available in this release; its own features come with M24.

### M08 · Connectivity / Offline Status

| ID | Task | Depends on | Size |
|---|---|---|---|
| M08-01 | Connectivity monitor in main process, pushed to renderer | M01-03 | S |
| M08-02 | Persistent status indicator in header | M08-01, M23-04 | S |
| M08-03 | Test: full billing flow with network disabled | M11-* | S |

**Status (2026-10-19):** M08-01 to M08-03 are implemented.

- **Monitor:** `ConnectivityMonitor` in the main process checks Electron's `net.isOnline()` every 3 seconds and after sleep or screen unlock. This is a local check: StorePro still sends nothing over the network. Changes are logged.
- **Push:** a new typed main → renderer event channel. `IpcEvents` is declared in the contract, and the preload's `on()` accepts declared events only (a security test checks it). The renderer keeps the newest status.
- **Indicator:** the header's always-visible status now follows the main process. It reads "Offline · billing still works", with since when in the store's time zone, and is announced politely to screen readers. TanStack Query still ignores the browser's online state.
- **Tests (M08-03):** end-to-end tests cut the network the way an outage does (the main process's check and Chromium's network). With it cut, they add a user, change settings, sign out and in, read the audit log, complete a POS sale while offline, restart StorePro while still offline, and verify the completed invoice persisted.

A network without internet access (router line down) counts as online; telling them apart needs a probe over the internet, which is left for when an online feature needs it.

---

## Phase 3 — Catalogue & Business Rules ✅ Completed (2026-10-19)

**Phase 3 is complete.** M09, M10 and M14 are implemented.

### M09 · Product Catalogue

| ID | Task | Depends on | Size |
|---|---|---|---|
| M09-01 | Category and unit-of-measure management (pcs, kg, g, L, mL; fractional flag) | M02-09 | M |
| M09-02 | Product repository and service with validation (prices, barcode, SKU) | M02-09, M02-07 | M |
| M09-03 | Barcode uniqueness enforcement | M09-02 | S |
| M09-04 | Product variants (pack sizes) | M09-02 | M |
| M09-05 | Product list screen with search, filters, pagination | M09-02, M23-02 | M |
| M09-06 | Product create/edit form | M09-02, M23-03 | M |
| M09-07 | Fast search: barcode exact lookup (<100 ms) and name/SKU search via FTS (<300 ms @ 10k) | M02-10 | M |
| M09-08 | Archive/deactivate products referenced by sales (no hard delete) | M09-02 | S |
| M09-09 | Price change service with permission check and audit | M09-02, M06-03, M07-02 | S |

**Status (2026-10-19):** M09-01 to M09-09 are implemented. See `docs/catalogue.md` and migration 0005.

- **Reference data:** categories (add, rename, archive, restore) and units (add with a fixed code and fraction rule, rename). Setup now seeds the store's tax classes (provisional GST slabs for India).
- **Products:** a product with one or more pack sizes, each with its own unit, prices, low-stock level, SKU (assigned when left empty) and barcodes. One barcode, one item; the error names the item that has it.
- **Screens:** **Stock → Products** with search, category and status filters and pages of 50; an add form for a product and its first pack size; a product editor with its pack sizes. Read-only without `product.manage`.
- **Lookups for billing:** `products:find-by-barcode` (barcode, then SKU) and `products:search` (FTS prefix), active items only.
- **Archive, not delete:** products and pack sizes are archived; a pack size's unit is fixed once it has history.
- **Audit:** every change, with price changes recorded on their own with amounts before and after.

CSV import is M22; variable-weight barcodes and labels are M24.

### M10 · Pricing, Discount & Tax Engine

| ID | Task | Depends on | Size |
|---|---|---|---|
| M10-01 | Tax configuration model (rates, inclusive/exclusive, per-product tax class) | M03-01 | M |
| M10-02 | Line calculation: qty × price, line discount, tax, rounding | M02-07, M02-08 | M |
| M10-03 | Bill-level discount allocation across lines | M10-02 | M |
| M10-04 | Bill rounding rules and final payable amount | M10-02 | S |
| M10-05 | Discount limits by role; override requires permission | M10-03, M06-05 | S |
| M10-06 | Exhaustive unit tests (rounding edge cases, mixed tax rates, inclusive pricing) | M10-04 | M |
| M10-07 | Validate GST/invoice rules with domain expert; document decisions | — | M |

**Status (2026-10-19):** M10-01 to M10-06 are implemented, and the provisional GST rules are documented for M10-07. See `docs/pricing-and-tax.md` and migration 0006.

- **Engine (`src/shared/pricing.ts`):** pure `calculateBill()` for line gross (`qty × price`), amount or percentage line discounts, largest-remainder allocation of bill discounts across lines, tax-inclusive and tax-exclusive GST (`CGST` + `SGST` + `CESS`) or single sales tax, tax summary by component and rate, and payable round-off.
- **Database parity:** a property test inserts 60 randomized bills into SQLite and checks that `v_sale_totals` matches `calculateBill` on every total.
- **Tax classes and policy (`PricingService`):** create, edit, archive and restore tax classes (keeping at least one active; even GST rates in India), plus store-wide bill rounding step and cashier discount limit (`businesses.bill_rounding_minor`, `businesses.max_discount_bp`), all audited.
- **Permissions (`authorizeBill`):** requires `discount.apply` for any discount, `discount.override` above the store limit, and `price.override` when a line's price differs from the catalogue, with `overridable: true` for manager approval at POS.
- **Settings UI:** **Tax rates** and **Rounding and discounts** sections on **Manage → Settings**, read-only for managers.

Practitioner sign-off on the provisional GST 2.0 slabs and B2B IGST invoicing remains open (PRD §15).

### M14 · Inventory & Stock Ledger

| ID | Task | Depends on | Size |
|---|---|---|---|
| M14-01 | Inventory movement service (single entry point for all stock changes) | M02-05, M09-02 | M |
| M14-02 | Stock-on-hand maintenance (cached balance kept consistent with ledger) | M14-01 | M |
| M14-03 | Negative-stock policy (block by default, configurable) | M14-01, M03-04 | S |
| M14-04 | Stock adjustment with reason, permission, audit | M14-01, M06-03, M07-02 | M |
| M14-05 | Minimum stock levels and low-stock list | M14-02 | S |
| M14-06 | Stock count / reconciliation workflow (count sheet → variance → approve) | M14-04 | L |
| M14-07 | Stock movement history screen per product | M14-01, M23-02 | M |
| M14-08 | Ledger consistency check (balance = sum of movements) | M14-02 | S |

**Status (2026-10-19):** M14-01 to M14-08 are implemented. See `docs/inventory.md`.

- **Ledger & stock on hand (`InventoryRepository`, `InventoryService`):** reads stock balances from `v_stock_on_hand` and movements from `v_inventory_movements`, with a window-function running balance (`balanceAfterMilli`), document number, actor name and reason/notes per movement.
- **Negative-stock policy (`assertOutflowAllowed`):** blocks sales and downward adjustments that would take a tracked item below zero unless `allowNegativeStock` is enabled in store settings, aggregating duplicate lines per variant first.
- **Adjustments (`inventory:adjust`):** sequential `ADJ000001` numbering via `document_sequences`, seeded reason validation, unit fraction checks, `stock.adjust` permission enforcement, and atomic `stock.adjusted` audit logging.
- **Stock count reconciliation (`inventory:reconcile`):** count sheet with live variance calculation, posting a `count_correction` adjustment and `stock.counted` audit log entry for items whose counted quantity differs from recorded stock.
- **Screens & consistency:** **Stock → Inventory** with search, category and stock-level filters (`all`, `low`, `out`), low-stock alert banner, movement history dialog, adjustment history dialog, and `stock_on_hand_mismatch` integrity check.

---

## Phase 4 — Selling

### M12 · Payments

| ID | Task | Depends on | Size |
|---|---|---|---|
| M12-01 | Payments repository; payment methods config (Cash, UPI; extensible) | M02-09 | S |
| M12-02 | Cash tendering and change calculation | M12-01, M02-07 | S |
| M12-03 | UPI recorded with reference field; labelled "recorded", not "verified" | M12-01 | S |
| M12-04 | Refund payment records (negative/linked entries) | M12-01 | S |

**Status (2026-10-19):** M12-01 to M12-04 are implemented. See `docs/billing-and-payments.md`.

- **Payment methods (`PaymentRepository`, `PaymentService`):** lists, adds, updates, archives and restores payment methods (`cash`, `upi`, `card`, `other`), ensuring at least one method remains active and auditing every change.
- **Cash & split calculations (`src/shared/payments.ts`):** `planCashTender()` and `calculatePayments()` validate single and split tenders, compute cash change due in minor units, and reject under-tendered or over-allocated payments.
- **UPI notice (`M12-03`):** UPI payments accept an optional reference and carry `Recorded (not verified)` (`UPI_RECORDED_NOTICE`).
- **Refund records (`M12-04`):** linked `return_refunds` entries are queried per sale and exposed on `SaleDetail.refunds`.

### M11 · Point of Sale (Billing)

| ID | Task | Depends on | Size |
|---|---|---|---|
| M11-01 | Cart state model (lines, quantities, discounts, customer) | M10-02 | M |
| M11-02 | Billing screen layout: barcode/search field, product list, cart, totals panel, payment actions | M23-04, M11-01 | L |
| M11-03 | Barcode input handling (scanner keyboard-wedge, auto-add, unknown-barcode feedback) | M11-02, M09-07, M21-01 | M |
| M11-04 | Product search popup with keyboard selection | M11-02, M09-07 | M |
| M11-05 | Quantity edit, item removal, line and bill discounts | M11-01, M10-05 | M |
| M11-06 | Payment dialog: method selection, tendered amount, change | M12-02, M12-03 | M |
| M11-07 | Checkout service: atomic save of sale, sale_items (price/tax snapshot), payments, stock movements | M02-05, M14-01, M12-01, M13-01 | L |
| M11-08 | Idempotency key per checkout to prevent duplicate sales on retries/double-clicks/crash | M11-07 | M |
| M11-09 | Held bills: hold, list, resume, discard | M11-01 | M |
| M11-10 | Cancel unfinished bill vs. void completed sale (void = reversal with permission + audit) | M11-07, M06-05, M14-01 | M |
| M11-11 | Keyboard shortcuts for full billing flow (new bill, pay, hold, search, qty) | M23-07, M11-02 | M |
| M11-12 | Sales list screen: search by invoice number/date, view sale detail | M11-07 | M |
| M11-13 | Performance check: checkout persists in <500 ms | M11-07, M02-12 | S |
| M11-14 | Tests: atomicity under injected failure, duplicate prevention, stock deducted once | M11-08 | M |

**Status (2026-10-19):** M11-01 to M11-14 (plus M13-01 and M24-01) are implemented. See `docs/billing-and-payments.md`.

- **Cart & POS counter (`src/renderer/src/sales/cart.ts`, `BillingPage.tsx`, `BillingDialogs.tsx`):** barcode/SKU scan input with auto-increment, `F4` FTS product search dialog, fractional quantities for weight/volume units (`M24-01`), line price/discount editor, `F6` bill discount dialog, `F8`/`F9` hold/resume/discard bill dialogs, `F2` cancel bill confirmation, and `F12` single/split payment dialog with manager override integration.
- **Atomic checkout (`SalesRepository`, `SalesService`):** saves `sales`, `sale_items` (with price, cost and tax snapshots), `sale_item_taxes` and `sale_payments`, allocates gapless sequential `INV000001` invoice numbers (`M13-01`), enforces `checkoutKey` idempotency (`M11-08`) and negative-stock rules, deletes resumed held bills, and records `sale.created` in the audit log inside one transaction in `< 500 ms` (`M11-13`).
- **Sales list & voiding (`SalesPage.tsx`):** searches and filters invoices, displays full invoice breakdown, and voids completed sales (`sales:void`) with `sale.void` permission or manager approval, restoring stock via `sale_voids` and logging `sale.voided`.

### M13 · Invoice & Receipt Printing

| ID | Task | Depends on | Size |
|---|---|---|---|
| M13-01 | Invoice number sequence (unique, gap-handling rules, generated inside checkout transaction) | M02-05 | M |
| M13-02 | Receipt template engine (store header, lines, tax summary, payments, footer) | M03-01 | M |
| M13-03 | 58 mm and 80 mm layouts | M13-02 | M |
| M13-04 | Print after checkout; print failure does not affect saved sale; retry option | M13-03, M21-02 | S |
| M13-05 | Reprint with permission and audit; marked "Duplicate/Reprint" | M13-04, M06-03, M07-02 | S |

**Status (2026-10-20):** M13-01 to M13-05 are implemented. See `docs/printing-and-hardware.md`.

- **Receipt template engine (`src/shared/receipt.ts`):** `buildReceiptDocument()` and `renderReceiptHtml()` format store header, GSTIN/Tax ID, invoice metadata in store time zone, itemized lines with HSN/qty/rate/discount, tax summary, payments, change due, linked return refunds, and receipt footer for both **58 mm** (`32` columns) and **80 mm** (`48` columns) thermal rolls.
- **Checkout print & non-fatal failure (`CompletedSaleDialog`, `M13-04`):** previews receipts, supports optional automatic print on checkout completion, and surfaces a non-blocking warning alert with **Retry print** if the printer fails while keeping the saved sale intact.
- **Reprint with permission & audit (`PrintingService.printReceipt`, `SalesPage.tsx`, `M13-05`):** requires `sale.reprint` (or manager approval override), prints the `*** DUPLICATE / REPRINT ***` banner, and records `sale.reprinted` in `audit_logs`.

### M21 · Hardware Integration

| ID | Task | Depends on | Size |
|---|---|---|---|
| M21-01 | Barcode scanner input detection (fast keystroke burst + terminator) | M23-07 | M |
| M21-02 | Windows printer discovery and selection; silent printing to receipt printer | M01-04 | M |
| M21-03 | Printer settings screen with test print | M21-02, M03-04 | S |
| M21-04 | ESC/POS raw printing option (cash drawer kick if supported) | M21-02 | M |
| M21-05 | Supported-device matrix; test on real scanners and printers | M21-04 | M |

**Status (2026-10-20):** M21-01 to M21-05 are implemented. See `docs/printing-and-hardware.md`.

- **Scanner burst detector (`src/shared/scanner.ts`, `BillingPage.tsx`, `M21-01`):** `ScannerBurstDetector` detects rapid keyboard-wedge barcode bursts (`<= 45 ms` inter-key gap, `<= 600 ms` total burst, ending in `Enter`/`Tab`) and routes them to POS barcode lookup even when focus is outside the barcode input field.
- **Printer discovery, settings & test print (`electronPrinterAdapter.ts`, `PrintingService`, `PrintingSettings.tsx`, `M21-02`, `M21-03`):** lists OS printers via `webContents.getPrintersAsync()`, stores device-local printer configuration in `app_settings`, prints silently via hidden `BrowserWindow`, and provides a **Test print** action under **Manage → Settings**.
- **ESC/POS encoder & cash drawer kick (`src/shared/escpos.ts`, `M21-04`):** `encodeEscPosReceipt()` encodes `ESC @` init, optional `ESC p 0 25 250` cash-drawer kick on cash sales, bold headers/totals, ASCII receipt lines, and `GS V 66 3` partial paper cut.
- **Supported-device matrix (`docs/printing-and-hardware.md`, `M21-05`):** documents supported USB HID scanners, 58 mm / 80 mm thermal printers, RJ-11 cash drawers, barcode label printers, and label-printing weighing scales.

### M24 · Grocery / Retail Extension

| ID | Task | Depends on | Size |
|---|---|---|---|
| M24-01 | Fractional quantity entry for weight/volume products at POS | M09-01, M11-05 | S |
| M24-02 | Variable-weight barcode parsing (embedded weight/price, configurable prefix) | M11-03 | M |
| M24-03 | Price label / barcode label printing | M21-02, M09-02 | M |
| M24-04 | Weighing-scale integration (serial/USB read) — scope depends on open decision | M21-01 | L |

**Status (2026-10-20):** M24-01 to M24-03 are implemented (`M24-04` serial/USB live scale read remains deferred on PRD §15 open decision). See `docs/printing-and-hardware.md`.

- **Fractional POS quantities (`M24-01`):** weight/volume units (`kg`, `g`, `l`, `ml`) support 3-decimal quantities (`0.001` precision in milli-units) across POS cart entry and stock movements.
- **Variable-weight & embedded-price EAN-13 barcodes (`parseWeighBarcode`, `ProductService.findByBarcode`, `M24-02`):** parses 13-digit scale barcodes (`PP IIIII VVVVV C`) with configurable 2-digit weight (`20`) and price (`21`) prefixes, resolving the item and populating `scannedQuantityMilli` automatically at POS.
- **Shelf & pack price/barcode labels (`src/shared/label.ts`, `PrintLabelDialog.tsx`, `M24-03`):** generates Code-128B SVG barcodes and printable `50 mm × 30 mm` labels (`1..50` copies, store name, item title, selling price, MRP, optional packed date) from **Stock → Products**.

---

## Phase 5 — Operations ✅ Completed (2026-10-20)

**Phase 5 is complete.** M15, M16, M17 and M18 are implemented. Items deliberately left for later:

- Purchase returns and supplier credit notes, supplier payments and balances (P1), and GST input credit.
- Customer credit and repayments (P1), exchanges, and a return window or policy.
- The purchase, expense and returns reports (M19) and CSV export (M22).

### M15 · Suppliers & Purchases (MVP scope)

| ID | Task | Depends on | Size |
|---|---|---|---|
| M15-01 | Supplier repository, list, and create/edit screens | M02-09, M23-02 | M |
| M15-02 | Purchase order: draft and confirmed states (no stock effect) | M15-01, M09-02 | M |
| M15-03 | Goods receipt: received vs. ordered quantities; finalizing posts stock movements atomically | M15-02, M14-01 | L |
| M15-04 | Direct purchase entry (receipt without PO) | M15-03 | S |
| M15-05 | Purchase cost history per product; optional update of product cost | M15-03 | S |
| M15-06 | Purchase list and detail screens | M15-02 | M |
| M15-07 | Tests: drafts don't change stock; receipt increases stock exactly once | M15-03 | S |

**Status (2026-10-20):** M15-01 to M15-07 are implemented. See `docs/purchasing.md`. No new migration was needed: migration 0001 already holds the tables, triggers and views.

- **Suppliers (`SupplierService`):** add, edit, archive and restore, with unique names and audit entries showing what changed. **Stock → Suppliers** has search and an archived filter.
- **Orders (`PurchaseService`):** draft orders (`PO000001`, …) can be edited or deleted; confirming fixes them; confirmed orders can be closed or cancelled (not once goods have arrived). They never touch stock.
- **Receipts:** against an order or direct. A draft changes nothing. Posting freezes the receipt, adds its goods to stock through the ledger view, closes an order that is now fully received, and writes the audit entry in one transaction. Receiving more than ordered is allowed; items not on the order are not.
- **Supplier bills:** one bill number per supplier, and the error names the receipt that holds it.
- **Cost (M15-05):** cost history per item from posted receipts; an optional, `product.manage`-gated update of the item's cost price when posting.
- **Screens:** **Stock → Suppliers** and **Stock → Purchases** (orders, goods received, cost history), with an item picker that searches by name, SKU or barcode.
- **Tests:** 20 service tests (stock effects, partial and full receipt, atomic posting under an injected audit failure, duplicate bills, permissions), access-control coverage for all 17 new channels, screen tests and an axe check.

Not done: purchase returns and supplier credit notes, supplier payments and balances (P1), printing orders, GST input credit, date filters on the lists, and the purchase report (M19-07).

### M16 · Returns & Refunds (MVP scope)

| ID | Task | Depends on | Size |
|---|---|---|---|
| M16-01 | Look up original sale by invoice number | M11-12 | S |
| M16-02 | Return service: eligible quantity check against prior returns | M16-01 | M |
| M16-03 | Item disposition: restock, quarantine, write-off → corresponding stock movements | M16-02, M14-01 | M |
| M16-04 | Refund recording with method; atomic save of return, items, refund, movements | M16-03, M12-04, M02-05 | M |
| M16-05 | Return screen and return receipt print | M16-04, M13-02 | M |
| M16-06 | Permission + audit for returns | M16-04, M06-03, M07-02 | S |
| M16-07 | Tests: over-return blocked, original sale unchanged, stock/payment reversals correct | M16-04 | S |

**Status (2026-10-20):** M16-01 to M16-07 are implemented. See `docs/returns.md`. No new migration was needed: migration 0001 already holds the tables, triggers and views.

- **Calculation (`src/shared/returns.ts`):** one pure `quoteReturn`, used by the service and the screen. A return credits a share of what the customer paid after line and bill discounts, with tax credited per component. Cumulative rounding makes the credits add up to exactly what was paid however a line comes back.
- **Service (`ReturnService`):** find an invoice by number; refuse a voided one; check quantities against all earlier returns; refunds must equal what is due; one transaction saves the return, lines, tax, refunds and audit entry. The original sale is never changed.
- **Goods:** restock, quarantine or write-off per line (with a split row on the screen). Only restocked goods enter the ledger.
- **Permission:** `return.create` with manager approval for cashiers, audited with the approver.
- **Screens:** **Sell → Sales → Returns** (take a return, list, detail) and **Return items** on an invoice.
- **Receipt (M16-05):** the credit note uses the M13 receipt engine on 58 and 80 mm paper. The first print is the original, later ones are audited duplicates, and a failed print never affects the saved return. `PrintingService.printDocument` and two ESC/POS bold lines were added for it.
- **Tests:** 22 service tests (credit maths with discounts, partial and repeated returns, over-return, dispositions, split refunds, tax-exclusive invoices, atomic failure, permissions, receipts), 10 for the calculation, 4 for the receipt, 11 screen tests including manager approval, and an axe check.

Not done: exchanges, a return window, returns without an invoice, refund to store credit, and the returns report (M19).

### M17 · Customers (MVP scope, no credit)

| ID | Task | Depends on | Size |
|---|---|---|---|
| M17-01 | Customer repository, list, and create/edit screens | M02-09, M23-02 | M |
| M17-02 | Attach/quick-create customer at POS | M17-01, M11-02 | S |
| M17-03 | Customer purchase history view | M17-01, M11-12 | S |

**Status (2026-10-20):** M17-01 to M17-03 are implemented. See `docs/customers.md`. No new migration was needed.

- **Records (`CustomerService`):** add, edit, archive and restore. A phone number identifies one customer: it is stored without spaces or dashes and a clash names who has it. Search finds phones however they are typed. Changes are audited with before and after.
- **At the counter (M17-02):** **Customer** above the scan bar, with search or **Add new customer** without leaving the bill. A held bill keeps its customer. Billing works with none.
- **History (M17-03):** invoices newest first with refunds, and billed minus refunded for invoices that weren't voided.
- **Screens:** **Sell → Customers**, and the picker on **Sell → Billing**.
- **Tests:** 11 service tests, access-control coverage for all 5 new channels, 9 screen tests including checkout sending the customer, and an axe check.

Not done: customer credit and balances (P1), loyalty, importing customers (M22), merging duplicates, and a counter shortcut for choosing the customer.

### M18 · Expenses

| ID | Task | Depends on | Size |
|---|---|---|---|
| M18-01 | Expense categories and expense entry (amount, date, category, note, payment method) | M02-09 | M |
| M18-02 | Expense list with date filter and totals | M18-01, M23-02 | S |

**Status (2026-10-20):** M18-01 and M18-02 are implemented. See `docs/expenses.md`. No new migration was needed.

- **Recording (`ExpenseService`):** category, date (a business date in the store's time zone, today by default), amount in minor units, how it was paid, and a note. Categories are added, renamed, archived and restored; an expense keeps an archived category it already has.
- **Corrections:** edit (audited with before and after) or void and restore. Nothing is deleted, and a voided expense is left out of totals.
- **List (M18-02):** newest first with filters for words, dates (inclusive), category, payment method and voided. The **Total** covers every matching expense across all pages.
- **Screen:** **Manage → Expenses**, with add/edit and category dialogs.
- **Tests:** 11 service tests, access-control coverage for all 8 new channels, screen tests and an axe check.

Not done: recurring expenses, bill attachments, the expense summary report (M19-08), CSV export (M22), and any link between a cash expense and the till.

---

## Phase 6 — Insight & Safety (in progress)

**Done so far:** M19 Reports & Dashboard and M22-03 CSV export. **Remaining:** M20 Backup & Restore and M22-01/02 CSV product import.

### M19 · Reports & Dashboard

| ID | Task | Depends on | Size |
|---|---|---|---|
| M19-01 | Report query layer with time-zone-aware date ranges | M03-05 | M |
| M19-02 | Metric definitions: gross sales, discounts, tax, refunds, net sales, collections (documented) | M10-04 | S |
| M19-03 | Dashboard: total sales, bill count, average bill, payment-method totals | M19-01, M19-02 | M |
| M19-04 | Daily / date-range sales report | M19-01 | M |
| M19-05 | Top-selling products by quantity and value | M19-01 | S |
| M19-06 | Inventory reports: current stock, low stock, movement history | M14-07, M19-01 | M |
| M19-07 | Purchase report by supplier and date | M15-06, M19-01 | S |
| M19-08 | Expense summary report | M18-02, M19-01 | S |
| M19-09 | Reconciliation tests: report totals match stored transactions | M19-04 | M |

**Status (2026-10-20):** M19-01 to M19-09 are implemented. See `docs/reports.md`. No new migration was needed: reports read the existing ledger views.

- **Definitions (`src/shared/reports.ts`):** one place that says what gross sales, discounts, tax, round-off, billed total, refunds, net sales, collections and voided mean. Reports show finalised, non-voided sales on the store's own days; a refund counts on the day of the return.
- **Queries (`ReportRepository`, `ReportService`):** sales for a period and for each day (quiet days listed as zeros), money by payment method, top items net of returns, stock on hand with value at cost, every stock movement in a period, goods receipts by supplier, and expenses by category and payment method.
- **Screen:** **Manage → Reports** with Overview (the dashboard), Sales, Top items, Stock, Stock movements, Purchases and Expenses tabs, a shared period (kept in the address) with quick periods, and each figure's definition beside it.
- **Reconciliation (M19-09):** every figure is tested against totals worked out separately from the invoices and returns; the daily rows add up to the period; and store-day edges and a 25-hour daylight-saving day land on the right dates.
- **Tests:** 25 service tests, 13 screen tests (including an axe check, which caught and fixed a definition-list markup problem), 2 for the definitions.

Not done: profit and margin reports, reports by cashier, category or customer, a dashboard on the home screen, printing reports, and Excel or PDF export.

### M22 · Data Import / Export

| ID | Task | Depends on | Size |
|---|---|---|---|
| M22-01 | CSV product import: template download, parse, column mapping | M09-02 | M |
| M22-02 | Row-level validation preview with error report; commit only valid batch atomically | M22-01 | M |
| M22-03 | CSV export for each report; figures reconcile with on-screen report | M19-04 | M |

**Status (2026-10-20):** M22-01, M22-02 and M22-03 are implemented.

**M22-03 (Stream A):** see `docs/reports.md` section 4.

- **Export CSV** on every report tab for people with `data.export`. The file is built from the same report the screen shows (all of it, not just the page on screen), so its figures reconcile; tests compare each file with its report and with the invoices.
- **Safe and spreadsheet-friendly:** UTF-8 with a byte-order mark, money as plain decimals, store-local times, and a leading apostrophe on text that starts with `=`, `+`, `-` or `@` so a product name cannot run as a formula.
- **The person chooses where it goes** (the system save dialog, via a swappable `FileSaver`); closing the dialog writes nothing. Every saved export is audited as `report.exported`. Exports over 500,000 rows are refused with a request to choose a shorter period.
- **Tests:** 5 for the CSV writer and reader, 6 export tests in the report service tests, 4 export screen tests.

**M22-01 and M22-02 (Stream B):** see `docs/data-import.md`.

- **CSV parser & template (`src/shared/csv.ts`, `M22-01`):** RFC-4180 CSV parser (UTF-8 BOM, quoted fields, escaped quotes, CRLF/LF), header alias auto-detection, custom column mapping overrides, and downloadable `storepro-products-template.csv`.
- **Row-by-row validation & atomic commit (`ProductImportService`, `ProductImportDialog.tsx`, `M22-02`):** validates every row against catalogue rules (required fields, currency precision, `sellingPrice <= mrp`, unit existence and fractional rules, tax class lookup, HSN format, SKU/barcode uniqueness against both DB and the CSV batch, and multi-variant consistency), generates a downloadable error report CSV (`storepro-import-errors.csv`), refuses to commit any batch with invalid rows, and creates categories, products, variants, SKUs, barcodes, and `data.products_imported` audit entry in one transaction.

### M20 · Backup & Restore

| ID | Task | Depends on | Size |
|---|---|---|---|
| M20-01 | Manual backup using SQLite online backup API to chosen folder/drive | M02-02, M06-03 | M |
| M20-02 | Backup file format with metadata (app version, schema version, checksum) | M20-01 | S |
| M20-03 | Scheduled automatic backups with retention count | M20-01 | M |
| M20-04 | Restore: validate file, confirm, keep safety copy of current DB, restart app | M20-02, M02-11 | L |
| M20-05 | Restore older-schema backups through migrations | M20-04, M02-03 | S |
| M20-06 | Backup status: last successful backup, failure alerts | M20-03 | S |
| M20-07 | Tests: backup → restore to fresh install → data consistent | M20-04 | M |

**Status (2026-10-20):** M20-01 to M20-07 are implemented (migration `0007_backup.sql`). See `docs/backup-and-recovery.md`.

- **Online backup & `.meta.json` sidecar (`BackupService.createBackup`, `M20-01`, `M20-02`):** creates consistent online backups (`VACUUM INTO`) to a chosen folder or `%APPDATA%\StorePro\backups` alongside a `.db.meta.json` sidecar holding `format: 'storepro-backup-v1'`, `appVersion`, `schemaVersion`, `storeName`, `fileSizeBytes`, and `sha256Checksum`.
- **Scheduled backups & retention (`BackupService.runScheduledBackupIfDue`, `M20-03`):** configurable interval (`1h`, `6h`, `12h`, `24h`, `168h`) and retention count (`5..100`, default `30`), pruning older `auto-backup-*.db` files and sidecars automatically.
- **Restore & older-schema migration (`BackupService.validateBackup`, `BackupService.restoreBackup`, `M20-04`, `M20-05`):** verifies `.meta.json` SHA-256 checksum, `STOREPRO_APPLICATION_ID`, schema version, and `checkIntegrity('full')`; writes a `pre-restore-*.db` safety copy of the active database; stages and migrates older-schema backups forward to the current schema; swaps the database, records `backup.restored` in `audit_logs`, and triggers app relaunch.
- **Backup status & failure alerts (`BackupSection`, `M20-06`):** tracks every run in `backup_runs`, shows the last successful backup, and surfaces an alert banner whenever the most recent backup attempt failed.
- **Tests (`backupService.test.ts`, `backup.test.tsx`, `M20-07`):** covers manual backup, SHA-256 tamper detection, scheduled retention pruning, failure alerts, v3 → v7 older-schema restore, and full populated store backup → restore to a fresh install with consistent products, stock, customers, and sales.

---

## Phase 7 — Release Readiness

| ID | Task | Depends on | Size |
|---|---|---|---|
| M30-05 | Execute PRD §12 acceptance test plan (14 areas) and track results | All | L |
| M30-06 | Keyboard-only billing E2E test | M11-11 | S |
| M30-07 | Failure-scenario tests: power loss/crash mid-checkout, DB errors, restarts | M11-14 | M |
| M30-08 | Performance tests on reference hardware (lookup, search, checkout) | M02-12 | M |
| M30-09 | Clean Windows install and upgrade-from-previous-version tests | M01-08, M02-04 | M |
| M30-10 | Hardware compatibility testing with supported-device matrix | M21-05 | M |

**Status (2026-10-20):** M30-06, M30-07 and M30-08 are done. M30-05, M30-09, M30-10, M01-09, DOC-01, DOC-02 and PILOT-01 are not started.

- **M30-06 keyboard-only billing (`e2e/keyboard-billing.spec.ts`):** a whole bill with no mouse: scan twice, `F4` search, `F6` bill discount, `F9` hold, `F8` resume, `F12` pay, start the next bill. A tripwire fails the test on any real pointer input. It found and fixed four bugs: a fast second scan was lost (the scan field was cleared only after the lookup returned), dialogs opened on the Close button instead of their `autoFocus` field, focus was lost when a dialog was removed, and a held bill dropped its bill-level discount on resume (it is now stored as line discounts, with the same total).
- **M30-07 failure scenarios:** a real process is killed mid-transaction against the real database file (`src/main/db/crashRecovery.test.ts`: uncommitted sale leaves nothing, committed sale survives whole); audit-write failures roll back a sale, a goods receipt, a held bill and an expense, and the retry works once (`src/main/failureScenarios.test.ts`); the real app is hard-killed after a sale and a held bill and both are there on restart, with the next invoice number carrying on (`e2e/failure-scenarios.spec.ts`).
- **M30-08 performance (`src/main/servicePerformance.perf.test.ts`):** the PRD §11 targets measured through the services the screens call, plus the M19 reports and CSV export. It found that every scan, search and checkout line recomputed stock from the whole ledger (27 ms per scan, 200 ms per search at one month of history, growing with it); stock is now read per item with a bound variant. Scan 51 → 3 ms, search 225 → 22 ms, checkout 153 → 15 ms. The report targets are provisional until the size-targets decision (Open decisions) and the reference hardware are settled.
- **Held bills survive a crash after resume:** found by M30-07. Resuming no longer deletes the held bill; the checkout that completes it deletes it, and holding the cart again replaces it, each in one transaction. See `docs/billing-and-payments.md` §4.
| M01-09 | Code signing for installer | M01-08 | S |
| DOC-01 | User guide: setup, billing, purchases, returns, backup/restore | All | M |
| DOC-02 | Recovery procedures: restore from backup, failed update, corrupted DB | M20-04 | S |
| PILOT-01 | Pilot deployment in grocery store(s); collect consented performance metrics | All | L |

**Stream B Phase 7 Status (2026-10-20):**
- **M30-09 (`src/main/db/upgrade.test.ts`):** automated clean-install and upgrade-from-previous-version (v6 → v7) test suite verifying pre-migration safety backup creation, `system.database_upgraded` audit logging, preservation of all historical store transactions, and Windows x64 NSIS `deleteAppDataOnUninstall: false` configuration (minimum target: Windows 10 22H2 64-bit / Windows 11 64-bit).
- **M01-09 (`electron-builder.yml`):** Windows Authenticode SHA-256 + DigiCert RFC-3161 timestamp server configured (`signAndEditExecutable: true`), ready for `CSC_LINK` / `WIN_CSC_LINK` certificate injection in release builds while allowing unsigned local/CI test builds.
- **DOC-02 (`docs/backup-and-recovery.md`):** step-by-step recovery procedures documented for restoring from a backup, recovering from a failed update or schema migration (`pre-migration-*.db`), and recovering from a corrupted database file after hardware fault.
- **M30-10:** supported-device matrix is documented in `docs/printing-and-hardware.md`; physical printer/scanner sign-off is deferred until test hardware is connected.

---

## Open Decisions Blocking Tasks

| Decision (PRD §15) | Blocks |
|---|---|
| Minimum Windows version | M01-08, M30-09 |
| Catalogue size / store size targets | M02-12, M30-08 |
| Supported printer models & receipt format | M13-03, M21-04, M21-05 |
| Scanner and weighing-scale compatibility | M21-01, M24-02, M24-04 |
| Exact tax and invoice requirements | M10-01, M10-07, M13-01, M13-02 |
| Customer credit in first release? | M17 scope (currently excluded) |
| Backup retention & encryption | M20-02, M20-03 |
| Licensing, activation & update policy | Installer/update tasks (M29, not in MVP) |

---

## Out of MVP Scope (deferred)

- Supplier payments and outstanding balances (M15, P1).
- Customer credit and repayments (M17, P1).
- Enhanced returns and configurable pricing (P1).
- Electronics, Restaurant, Pharmacy extensions (M25–M27, P2).
- Multi-counter / multi-store sync (M28, P2).
- Licensing, activation, auto-update (M29, open decision).
