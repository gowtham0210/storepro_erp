# StorePro — Module Breakdown

**Source:** PRD.md (v1.0)  
**Purpose:** List of modules to be developed, derived from the PRD, with scope, requirement mapping, priority, and dependencies.

Priorities follow the PRD: **P0** = MVP (initial launch), **P1** = next priority (Release 1.1), **P2** = later release.

---

## Summary

| # | Module | Layer | Priority | PRD reference |
|---|---|---|---|---|
| 1 | Desktop Shell & Application Runtime | Platform | P0 | §9.2, §9.4 |
| 2 | Database & Migrations | Platform | P0 | §8, §9.1, §11 |
| 3 | Store Setup & Configuration | Platform | P0 | FR-001 – FR-005 |
| 4 | Module Registry & Feature Activation | Platform | P0 | FR-003, §7.3 |
| 5 | Authentication & User Management | Platform | P0 | FR-010, FR-011, FR-014 |
| 6 | Permissions & Access Control | Platform | P0 | FR-011, FR-012 |
| 7 | Audit Logging | Platform | P0 | FR-013, §16 |
| 8 | Connectivity / Offline Status | Platform | P0 | FR-004, §9.3 |
| 9 | Product Catalogue | Core domain | P0 | FR-020 – FR-026 |
| 10 | Pricing, Discount & Tax Engine | Core domain | P0 | FR-025, FR-033, FR-034 |
| 11 | Point of Sale (Billing) | Core domain | P0 | FR-030 – FR-042, §10.3 |
| 12 | Payments | Core domain | P0 | FR-035, FR-072 |
| 13 | Invoice & Receipt Printing | Core domain | P0 | FR-036, FR-039, FR-040 |
| 14 | Inventory & Stock Ledger | Core domain | P0 | FR-050 – FR-056 |
| 15 | Suppliers & Purchases | Core domain | P0 / P1 | FR-060 – FR-064 |
| 16 | Returns & Refunds | Core domain | P0 / P1 | FR-070 – FR-074 |
| 17 | Customers & Credit | Core domain | P0 / P1 | FR-080 – FR-082 |
| 18 | Expenses | Core domain | P0 | §8, §10.2 |
| 19 | Reports & Dashboard | Core domain | P0 | FR-090 – FR-096 |
| 20 | Backup & Restore | Platform | P0 | FR-100 – FR-104 |
| 21 | Hardware Integration | Platform | P0 | FR-031, FR-039, §7.2 |
| 22 | Data Import / Export | Platform | P0 | FR-026, FR-095 |
| 23 | UI Shell & Design System | UI | P0 | §10 |
| 24 | Grocery / Retail Extension | Industry | P0 | FR-024, §7.2 |
| 25 | Electronics Extension | Industry | P2 | Release 1.2, §7.2 |
| 26 | Restaurant Extension | Industry | P2 | Release 1.3, §7.2 |
| 27 | Pharmacy Extension | Industry | P2 | Release 1.4, §7.2 |
| 28 | Multi-Counter / Multi-Store Sync | Platform | P2 | Release 2, §9.3 |
| 29 | Licensing, Activation & Updates | Platform | Open decision | §9.4, §15 |
| 30 | QA & Test Infrastructure | Cross-cutting | P0 | §11, §12 |

---

## A. Platform / Foundation Modules

### 1. Desktop Shell & Application Runtime — P0

- Electron main process: window management, app lifecycle, crash recovery.
- Preload layer exposing a narrow, typed IPC API to the renderer.
- Security hardening: context isolation on, renderer Node.js integration off, no direct filesystem access from the UI.
- Windows installer and packaging (Electron Forge or electron-builder), 64-bit.

**Depends on:** none.

### 2. Database & Migrations — P0

- SQLite connection management with a maintained driver compatible with the Electron version.
- Versioned schema migrations (`schema_migrations`) and upgrade from earlier versions.
- Transaction helper for multi-record operations (used by checkout, purchases, returns).
- Repository layer for persistence; indexes for barcode, search, invoices, and date-based reports.
- Integrity checks during recovery and maintenance.
- Money stored as integer minor units (or a defined decimal type), never floats.

**Depends on:** 1.

### 3. Store Setup & Configuration — P0

- First-run setup wizard: store name, address, contact, currency, time zone, business type, tax configuration, receipt preferences.
- Blocks billing until required setup is saved (FR-005).
- Business profile editing for authorized users.
- Local `application_settings` storage.

**Depends on:** 2, 6.

### 4. Module Registry & Feature Activation — P0

- Stores the selected business type and enabled modules.
- Exposes feature flags to the UI (navigation filtering) and services.
- Activating or deactivating a module never deletes data or alters historical invoices.

**Depends on:** 2, 3.

### 5. Authentication & User Management — P0

- Local sign-in with secure password hashing; no plaintext or hardcoded credentials.
- Session handling and logout.
- User CRUD and role assignment.

**Depends on:** 2.

### 6. Permissions & Access Control — P0

- Roles: Administrator, Manager, Cashier, Inventory Operator.
- Role-to-permission mapping (configurable or explicit).
- Enforcement at the application-service layer, not only in the UI.
- Guards for sensitive actions: discount overrides, stock adjustments, invoice voids, settings changes, reprints.

**Depends on:** 5.

### 7. Audit Logging — P0

- Records user, action, timestamp, and record reference for sensitive operations.
- Shared service that all modules, including industry extensions, must use.
- Audit log viewer for administrators.

**Depends on:** 2, 5.

### 8. Connectivity / Offline Status — P0

- Detects internet availability and shows a persistent status indicator.
- Network-dependent features fail independently; core operations never depend on it.

**Depends on:** 1.

### 20. Backup & Restore — P0

- Manual backup to a local or external destination.
- Scheduled automatic backups (configurable).
- Backup validation before restore; safe restore that never overwrites the active database without a recovery copy.
- Last-successful-backup display and failure reporting.
- Backup retention and encryption policy (open decision, §15).

**Depends on:** 2, 6, 7.

### 21. Hardware Integration — P0

- USB barcode scanner (keyboard-wedge) input handling.
- Windows thermal receipt printers, 58 mm and 80 mm.
- Supported-device matrix and printer configuration screen.
- Weighing-scale integration (grocery extension; compatibility is an open decision).

**Depends on:** 1.

### 22. Data Import / Export — P0

- CSV product import with row-level validation and an error report before commit; no silent row drops.
- CSV report export that reconciles with on-screen reports.

**Depends on:** 9, 19.

### 28. Multi-Counter / Multi-Store Sync — P2 (Release 2)

- Explicit synchronization architecture for multiple counters and stores.
- Conflict handling for inventory and invoice numbering.
- Out of MVP scope: the MVP is single computer, single local database.

**Depends on:** 2, 11, 14.

### 29. Licensing, Activation & Updates — open decision

- Versioned releases and application auto-update.
- Recovery strategy for interrupted updates; updates never destroy user data.
- Licensing and activation policy (to be decided, §15).

**Depends on:** 1, 2, 20.

---

## B. Core Business Domain Modules (shared across industries)

### 9. Product Catalogue — P0

- Product CRUD: name, SKU, barcode, category, unit, purchase cost, selling price, tax config, active status, stock-tracking flag.
- Categories and units of measure (pcs, kg, g, L, mL).
- Product variants (pack sizes, models).
- Search by name, SKU, and barcode (under 300 ms for 10,000 products; barcode lookup under 100 ms).
- Barcode uniqueness enforcement.
- Soft deletion or archival for products referenced by past sales.

**Depends on:** 2, 6.

### 10. Pricing, Discount & Tax Engine — P0

- Line totals, discounts, taxes, rounding, and payable amount with defined currency precision.
- Tax calculation framework (GST requirements to be validated, §14).
- Discount rules and permission-gated overrides.
- Authorized price updates with audit trail.
- Pure domain logic, independent of the UI, with full unit-test coverage.

**Depends on:** 3, 6, 9.

### 11. Point of Sale (Billing) — P0 (highest priority)

- Billing screen: barcode input, product search, cart, quantity editing, item removal, discounts, totals, payment selection.
- Keyboard-first workflow with minimal mouse use.
- Atomic checkout: invoice, items, payments, and stock movements in one transaction.
- Idempotent checkout to prevent duplicate sales from repeated clicks, retries, or crashes.
- Held bills (hold and resume).
- Clear separation of remove item, cancel unfinished bill, and void completed sale; completed sales are never deleted.
- Historical price, discount, and tax snapshot stored on `sale_items`.

**Depends on:** 9, 10, 12, 13, 14, 6, 7.

### 12. Payments — P0

- Record cash and UPI payments; other payment types configurable.
- UPI is recorded as "recorded", not "verified", unless an integration confirms it.
- Split payments and refund payment records.
- No payment gateway integration in the MVP.

**Depends on:** 2.

### 13. Invoice & Receipt Printing — P0

- Unique, persistent invoice numbering within business scope.
- Receipt templates for 58 mm and 80 mm printers using store and receipt preferences.
- Reprint without creating a sale or changing stock (permission-gated and audited).

**Depends on:** 3, 11, 21.

### 14. Inventory & Stock Ledger — P0

- Central inventory movement engine (`inventory_movements`); all stock changes go through it.
- Stock tracking per product; every movement traceable to a sale, purchase, return, or adjustment.
- Stock adjustments with reason and authorization.
- Minimum stock levels and low-stock alerts.
- Negative-stock policy: blocked by default, configurable.
- Physical stock count and reconciliation workflow.

**Depends on:** 2, 6, 7, 9.

### 15. Suppliers & Purchases — P0 (supplier balances P1)

- Supplier records and contact management.
- Draft and confirmed purchase orders; drafts never change stock.
- Goods receipt recording received quantities separately from ordered quantities.
- Purchase cost history.
- Supplier payments and outstanding dues (P1, Release 1.1).

**Depends on:** 9, 12, 14.

### 16. Returns & Refunds — P0 (enhanced returns P1)

- Returns linked to the original sale.
- Return quantity cannot exceed the remaining eligible quantity.
- Refund amount and method recording.
- Disposition per item: restock, quarantine, or write-off.
- Preserves original sale history; creates traceable inventory and payment adjustments.

**Depends on:** 11, 12, 14, 6, 7.

### 17. Customers & Credit — P0 (credit P1)

- Customer records with optional contact details.
- Attaching a customer to a sale.
- Customer credit, outstanding balances, and repayments (P1, Release 1.1; inclusion in MVP is an open decision).

**Depends on:** 2, 11, 12.

### 18. Expenses — P0

- Operational expense records (listed in data model and primary navigation).
- Expense categories and date-based listing.

**Depends on:** 2, 6.

### 19. Reports & Dashboard — P0

- Dashboard: total sales, bill count, average bill value, payment-method totals.
- Daily and date-range sales reports, filtered in the store's time zone.
- Top-selling products by quantity and value.
- Inventory reports: current stock, low stock, movement history.
- Purchase reports by supplier and date.
- Clear separation of gross sales, discounts, tax, refunds, net sales, and collections.

**Depends on:** 11, 12, 14, 15, 16.

---

## C. UI Module

### 23. UI Shell & Design System — P0

- React + TypeScript + Tailwind component library.
- Layout: dark navy sidebar, light workspace, high-contrast billing totals.
- Primary navigation (Billing, Products, Inventory, Purchases, Sales, Customers, Suppliers, Reports, Expenses, Settings), filtered by enabled modules and permissions.
- Global state management (Zustand or Redux Toolkit).
- Form validation (Zod) with clear error messages.
- Accessibility: keyboard navigation, focus states, contrast, not relying on colour alone, confirmation for destructive actions.

**Depends on:** 1, 4, 6.

---

## D. Industry Extension Modules

Each extension reuses shared services (billing, payments, inventory, audit, transactions) and must not bypass them.

### 24. Grocery / Retail Extension — P0

- Fractional quantities for weight- and volume-based products.
- Variable-weight product handling.
- Barcode workflows and price label printing.
- Weighing-scale integration.

**Depends on:** 9, 11, 14, 21.

### 25. Electronics Extension — P2 (Release 1.2)

- Serial number and IMEI tracking (`serial_numbers`).
- Warranty information and lookup.
- Device-specific returns.

**Depends on:** 9, 11, 14, 16.

### 26. Restaurant Extension — P2 (Release 1.3)

- Orders and table management.
- Kitchen tickets (KOT) and order status.
- Menu modifiers and service charges.

**Depends on:** 9, 10, 11, 21.

### 27. Pharmacy Extension — P2 (Release 1.4)

- Batch-level inventory with expiry dates (`product_batches`).
- Applicable prescription workflows.
- Regulated-product controls.

**Depends on:** 9, 11, 14, 16.

---

## E. Cross-Cutting

### 30. QA & Test Infrastructure — P0

- Vitest unit tests for all shared business rules (pricing, tax, inventory, checkout).
- Integration tests for atomic checkout, duplicate prevention, returns, purchases, and migrations.
- Playwright end-to-end tests, including a keyboard-only billing flow.
- Failure scenarios: interrupted operations, database errors, application restarts, offline mode.
- Windows install and upgrade testing; hardware validation for scanners and printers.

**Depends on:** all modules.

---

## Suggested Build Order (MVP)

1. **Foundation:** Desktop Shell (1), Database & Migrations (2), UI Shell (23), QA setup (30).
2. **Identity & config:** Authentication (5), Permissions (6), Audit Logging (7), Store Setup (3), Module Registry (4), Offline Status (8).
3. **Catalogue & rules:** Product Catalogue (9), Pricing/Discount/Tax Engine (10), Inventory & Stock Ledger (14).
4. **Selling:** Payments (12), POS Billing (11), Invoice & Receipt Printing (13), Hardware Integration (21), Grocery Extension (24).
5. **Operations:** Suppliers & Purchases (15), Returns & Refunds (16), Customers (17), Expenses (18).
6. **Insight & safety:** Reports & Dashboard (19), Import/Export (22), Backup & Restore (20).
7. **Release readiness:** installer, upgrade path, and the full acceptance test plan (PRD §12).
