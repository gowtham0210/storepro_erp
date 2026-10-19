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

## Phase 2 — Identity & Configuration

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

### M07 · Audit Logging

| ID | Task | Depends on | Size |
|---|---|---|---|
| M07-01 | `audit_logs` repository and audit service (user, action, timestamp, entity reference, details) | M02-09 | S |
| M07-02 | Write audit entries inside the same transaction as the audited change | M07-01, M02-05 | S |
| M07-03 | Instrument sensitive actions: voids, adjustments, overrides, price changes, settings, reprints, restores | M07-02 | M |
| M07-04 | Audit log viewer with filters (user, action, date) | M07-01, M23-02 | M |

### M03 · Store Setup & Configuration

| ID | Task | Depends on | Size |
|---|---|---|---|
| M03-01 | Business and settings repositories | M02-09 | S |
| M03-02 | First-run setup wizard (store details, currency, time zone, business type, tax, receipt prefs, admin user) | M03-01, M05-04, M23-03 | L |
| M03-03 | First-run guard: block billing until setup is complete | M03-02 | S |
| M03-04 | Settings screen: business profile, receipt, tax, stock policy | M03-01, M06-03 | M |
| M03-05 | Time-zone-aware date utilities used by reports and invoices | M03-01 | S |

### M04 · Module Registry & Feature Activation

| ID | Task | Depends on | Size |
|---|---|---|---|
| M04-01 | Module manifest format (id, navigation entries, permissions, services) | M01-04 | M |
| M04-02 | Persist business type and enabled modules; enable grocery/retail by default | M04-01, M03-01 | S |
| M04-03 | Expose enabled-module flags to UI and services | M04-02 | S |

### M08 · Connectivity / Offline Status

| ID | Task | Depends on | Size |
|---|---|---|---|
| M08-01 | Connectivity monitor in main process, pushed to renderer | M01-03 | S |
| M08-02 | Persistent status indicator in header | M08-01, M23-04 | S |
| M08-03 | Test: full billing flow with network disabled | M11-* | S |

---

## Phase 3 — Catalogue & Business Rules

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

---

## Phase 4 — Selling

### M12 · Payments

| ID | Task | Depends on | Size |
|---|---|---|---|
| M12-01 | Payments repository; payment methods config (Cash, UPI; extensible) | M02-09 | S |
| M12-02 | Cash tendering and change calculation | M12-01, M02-07 | S |
| M12-03 | UPI recorded with reference field; labelled "recorded", not "verified" | M12-01 | S |
| M12-04 | Refund payment records (negative/linked entries) | M12-01 | S |

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

### M13 · Invoice & Receipt Printing

| ID | Task | Depends on | Size |
|---|---|---|---|
| M13-01 | Invoice number sequence (unique, gap-handling rules, generated inside checkout transaction) | M02-05 | M |
| M13-02 | Receipt template engine (store header, lines, tax summary, payments, footer) | M03-01 | M |
| M13-03 | 58 mm and 80 mm layouts | M13-02 | M |
| M13-04 | Print after checkout; print failure does not affect saved sale; retry option | M13-03, M21-02 | S |
| M13-05 | Reprint with permission and audit; marked "Duplicate/Reprint" | M13-04, M06-03, M07-02 | S |

### M21 · Hardware Integration

| ID | Task | Depends on | Size |
|---|---|---|---|
| M21-01 | Barcode scanner input detection (fast keystroke burst + terminator) | M23-07 | M |
| M21-02 | Windows printer discovery and selection; silent printing to receipt printer | M01-04 | M |
| M21-03 | Printer settings screen with test print | M21-02, M03-04 | S |
| M21-04 | ESC/POS raw printing option (cash drawer kick if supported) | M21-02 | M |
| M21-05 | Supported-device matrix; test on real scanners and printers | M21-04 | M |

### M24 · Grocery / Retail Extension

| ID | Task | Depends on | Size |
|---|---|---|---|
| M24-01 | Fractional quantity entry for weight/volume products at POS | M09-01, M11-05 | S |
| M24-02 | Variable-weight barcode parsing (embedded weight/price, configurable prefix) | M11-03 | M |
| M24-03 | Price label / barcode label printing | M21-02, M09-02 | M |
| M24-04 | Weighing-scale integration (serial/USB read) — scope depends on open decision | M21-01 | L |

---

## Phase 5 — Operations

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

### M17 · Customers (MVP scope, no credit)

| ID | Task | Depends on | Size |
|---|---|---|---|
| M17-01 | Customer repository, list, and create/edit screens | M02-09, M23-02 | M |
| M17-02 | Attach/quick-create customer at POS | M17-01, M11-02 | S |
| M17-03 | Customer purchase history view | M17-01, M11-12 | S |

### M18 · Expenses

| ID | Task | Depends on | Size |
|---|---|---|---|
| M18-01 | Expense categories and expense entry (amount, date, category, note, payment method) | M02-09 | M |
| M18-02 | Expense list with date filter and totals | M18-01, M23-02 | S |

---

## Phase 6 — Insight & Safety

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

### M22 · Data Import / Export

| ID | Task | Depends on | Size |
|---|---|---|---|
| M22-01 | CSV product import: template download, parse, column mapping | M09-02 | M |
| M22-02 | Row-level validation preview with error report; commit only valid batch atomically | M22-01 | M |
| M22-03 | CSV export for each report; figures reconcile with on-screen report | M19-04 | M |

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
| M01-09 | Code signing for installer | M01-08 | S |
| DOC-01 | User guide: setup, billing, purchases, returns, backup/restore | All | M |
| DOC-02 | Recovery procedures: restore from backup, failed update, corrupted DB | M20-04 | S |
| PILOT-01 | Pilot deployment in grocery store(s); collect consented performance metrics | All | L |

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
