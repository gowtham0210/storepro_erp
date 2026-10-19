# StorePro — Product Requirements Document (PRD)

**Document version:** 1.0  
**Status:** Draft for product and engineering review  
**Product type:** Offline-first Windows desktop billing and ERP software  
**Initial target market:** Grocery stores and small-to-medium retailers  
**Architecture:** Electron + React + TypeScript + SQLite  
**Product strategy:** Shared core platform with industry-specific modules

---

## 1. Executive Summary

StorePro is an offline-first desktop billing and business management platform designed for small and medium-sized businesses. It enables businesses to manage billing, inventory, purchases, customers, suppliers, payments, and sales reports from a Windows computer without requiring a continuous internet connection.

The platform will use a modular architecture. Core capabilities such as billing, product management, inventory, and reporting will be shared across business types, while specialized modules will support grocery stores, restaurants, electronics retailers, and pharmacies.

The initial release will focus on grocery stores. The product will prioritize fast checkout, barcode scanning, reliable invoice generation, inventory accuracy, thermal receipt printing, and simple daily sales reporting.

StorePro will initially support one computer with a local SQLite database. Multi-counter synchronization, cloud dashboards, and additional industry modules will be introduced in later releases.

### Product vision

Make professional billing and inventory management accessible to small businesses, even when their internet connection is unreliable or unavailable.

### Product principles

1. Offline-first: core operations must work without internet access.
2. Fast: billing must require minimal clicks and keyboard navigation.
3. Reliable: transactions must not produce duplicate bills or inconsistent stock.
4. Modular: new industries must extend the shared platform without duplicating core logic.
5. Simple: store owners and cashiers should need minimal training.
6. Extensible: future integrations must not require rewriting the core system.

---

## 2. Problem Statement

Many small businesses rely on manual registers, spreadsheets, or billing applications that provide limited inventory control and reporting.

Common problems include:

- Slow checkout during busy hours.
- Incorrect inventory quantities after sales or returns.
- Difficulty tracking purchases, expenses, and supplier dues.
- Limited visibility into daily sales and profitable products.
- Dependence on internet connectivity for essential operations.
- Difficulty managing barcode scanners, receipt printers, and other retail hardware.
- Separate software requirements for different business types.

StorePro addresses these problems with a desktop application that stores business data locally and separates common business functionality from industry-specific workflows.

---

## 3. Goals and Non-Goals

### 3.1 Product goals

- Deliver a reliable Windows billing application that operates offline.
- Provide a fast point-of-sale (POS) experience for grocery stores.
- Maintain consistent invoice, payment, and inventory records.
- Support barcode scanning and thermal receipt printing.
- Provide purchase management and stock visibility.
- Generate daily sales, payment, and inventory reports.
- Establish a reusable architecture for additional industries.
- Support backup and restore without requiring cloud connectivity.

### 3.2 Initial release non-goals

The following are explicitly outside the first release:

- Multi-store cloud synchronization.
- Multiple computers simultaneously accessing one shared database.
- Restaurant table management and kitchen display systems.
- Pharmacy-specific prescription and regulated-product workflows.
- Electronics serial-number and warranty management.
- Full accounting with general ledger, balance sheet, and profit-and-loss statements.
- Integrated payment gateway processing.
- E-commerce storefront and online ordering.
- Native Android and iOS applications.
- AI-powered demand forecasting.

These capabilities may be considered after the grocery MVP has been validated.

---

## 4. Target Users and Personas

### Persona A: Store owner

**Needs:** Understand daily revenue, stock availability, purchasing requirements, and cash position.

**Success:** Can review daily business performance without manually compiling reports.

### Persona B: Cashier

**Needs:** Generate bills quickly, search products, scan barcodes, accept payments, and print receipts.

**Success:** Can complete a typical sale using a barcode scanner and keyboard with minimal mouse interaction.

### Persona C: Inventory operator

**Needs:** Add products, record purchases, correct stock quantities, and identify low-stock items.

**Success:** Inventory records accurately reflect recorded purchases, sales, returns, and adjustments.

### Persona D: Manager

**Needs:** Control discounts, approve sensitive actions, manage users, and review reports.

**Success:** Staff can perform assigned tasks without receiving unnecessary administrative permissions.

---

## 5. Product Scope and Release Strategy

| Release | Scope | Priority |
|---|---|---|
| MVP | Grocery billing, products, purchases, inventory, receipts, reports, users, backups | P0 |
| Release 1.1 | Enhanced retail returns, supplier dues, customer credit, configurable pricing | P1 |
| Release 1.2 | Electronics serial numbers and warranty tracking | P2 |
| Release 1.3 | Restaurant ordering, tables, kitchen tickets | P2 |
| Release 1.4 | Pharmacy batches, expiry, and applicable regulated workflows | P2 |
| Release 2 | Multi-counter and multi-store synchronization | P2 |

Priorities: P0 = required for initial launch; P1 = next priority; P2 = later release.

---

## 6. Functional Requirements

### 6.1 Application Setup and Store Configuration

**FR-001 — Initial setup**

On first launch, the application must guide the user through creating a store profile.

Required fields:

- Store name.
- Business address.
- Contact number.
- Currency.
- Time zone.
- Business type.
- Tax configuration.
- Receipt preferences.

**FR-002 — Business profile**

Authorized users must be able to update store details and receipt information.

**FR-003 — Industry selection**

The application must support a selected business type and enabled feature modules. The initial release will enable grocery/retail functionality.

**FR-004 — Offline status**

The application must indicate whether internet access is available. Core offline functionality must not depend on this status.

**FR-005 — First-run validation**

The user must not enter normal billing workflows until required setup information has been saved.

Acceptance criteria:

- The application can complete setup without internet access.
- Restarting the application preserves the configuration.
- Invalid required fields are clearly identified.
- Business configuration is stored locally.

### 6.2 Authentication and User Management

**FR-010 — Local authentication**

Users must be able to sign in using locally validated credentials.

**FR-011 — Role-based access control**

The initial roles are:

- Administrator.
- Manager.
- Cashier.
- Inventory operator.

Permissions must be configurable or explicitly mapped to roles.

**FR-012 — Sensitive operations**

Discount overrides, stock adjustments, invoice voids, and changes to business settings must be restricted according to permissions.

**FR-013 — Audit history**

The system must record important actions, including user, action, timestamp, and relevant record reference.

**FR-014 — Session security**

The application must support logout and secure credential storage practices.

Acceptance criteria:

- A cashier cannot access restricted administration features.
- Unauthorized actions are rejected by the application service, not merely hidden in the UI.
- Passwords are never stored as plaintext.
- Sensitive changes generate audit records.

### 6.3 Product Catalogue

**FR-020 — Product creation**

Users must be able to create products with:

- Product name.
- SKU.
- Barcode.
- Category.
- Unit of measure.
- Purchase cost.
- Selling price.
- Tax configuration.
- Active/inactive status.
- Stock-tracking setting.

**FR-021 — Product search**

Products must be searchable by name, SKU, and barcode.

**FR-022 — Barcode uniqueness**

Duplicate barcodes must be rejected unless the product model explicitly supports a valid shared-barcode scenario.

**FR-023 — Units of measure**

The system must support common units such as pieces, kilograms, grams, litres, and millilitres.

**FR-024 — Variable-quantity products**

The grocery module must support fractional quantities for products sold by weight or volume.

**FR-025 — Pricing**

The application must support selling prices, purchase costs, and authorized price updates.

**FR-026 — Bulk import**

The application should support importing products from CSV, with validation and an error report before committing the import.

Acceptance criteria:

- A product can be created and retrieved after restarting the application.
- Search results are available quickly for a catalogue of 10,000 products on the defined reference computer.
- Invalid numeric quantities and prices are rejected.
- Product imports do not silently discard invalid rows.

### 6.4 Point of Sale and Billing

This is the highest-priority workflow in the MVP.

**FR-030 — Billing screen**

The billing screen must provide:

- Barcode input.
- Product search.
- Cart item list.
- Quantity editing.
- Item removal.
- Discount application.
- Tax calculation.
- Subtotal and grand total.
- Payment selection.
- Bill completion and receipt printing.

**FR-031 — Barcode scanning**

A compatible USB barcode scanner operating as a keyboard input device must be supported.

**FR-032 — Cart management**

Users must be able to add products, change quantities, and remove items before finalizing a sale.

**FR-033 — Price and quantity validation**

The application must validate quantities, prices, discounts, and tax rules before finalizing a bill.

**FR-034 — Bill calculation**

The billing service must calculate line totals, applicable discounts, taxes, rounding, and final payable amount using defined currency precision and tax rules.

**FR-035 — Payment methods**

The MVP must support recording cash and UPI payments. Other payment types may be configurable.

Recording a UPI payment must not be represented as verified electronic payment confirmation unless an appropriate integration has actually confirmed it.

**FR-036 — Invoice numbering**

Every completed sale must receive a unique, persistent invoice number within its defined business scope.

**FR-037 — Atomic checkout**

Finalizing a sale must save the invoice, invoice items, payment records, and associated stock movements in a single database transaction where applicable.

**FR-038 — Duplicate prevention**

Repeated clicks, retries, or application interruptions must not create duplicate completed sales for the same checkout operation.

**FR-039 — Receipt printing**

The application must support compatible Windows receipt printers, including common 58 mm and 80 mm thermal printers where supported by the printer and driver.

**FR-040 — Reprinting**

Authorized users must be able to reprint a completed receipt without creating another sale or changing stock.

**FR-041 — Held bills**

The application should support holding an unfinished bill and resuming it later.

**FR-042 — Cancel and void**

The application must distinguish between removing an item before checkout, cancelling an unfinished bill, and voiding or reversing a completed sale.

Completed sales must not be silently deleted.

Acceptance criteria:

- A completed sale persists after restarting the application.
- Stock is deducted only once for a completed sale.
- An interrupted transaction cannot leave an invoice without its required items or payment records.
- Reprinting does not change the invoice total or inventory.
- The billing workflow remains available with the network disconnected.

### 6.5 Inventory Management

**FR-050 — Stock tracking**

The system must maintain stock quantities for inventory-tracked products.

**FR-051 — Inventory ledger**

Stock changes must be traceable to their source, including purchases, sales, returns, and manual adjustments.

**FR-052 — Purchase receipts**

Recording a received purchase must increase stock according to the received quantities.

**FR-053 — Stock adjustment**

Authorized users must be able to record stock corrections with a reason.

**FR-054 — Low-stock alerts**

Users must be able to define minimum stock levels and view products below those thresholds.

**FR-055 — Negative stock policy**

The application must have an explicit negative-stock policy. For the MVP, negative stock should be blocked by default, with controlled configuration if a business needs otherwise.

**FR-056 — Inventory reconciliation**

Users must be able to compare recorded stock with physical stock and record approved adjustments.

Acceptance criteria:

- A sale reduces stock exactly once.
- A purchase receipt increases stock exactly once.
- Inventory adjustments require an authorized user and reason.
- The stock ledger can explain the quantity change for a product.

### 6.6 Purchase and Supplier Management

**FR-060 — Supplier records**

Users must be able to create and manage supplier contact information.

**FR-061 — Purchase orders**

The system should support draft and confirmed purchase orders.

**FR-062 — Goods receipt**

Users must be able to record actual received quantities separately from ordered quantities.

**FR-063 — Purchase costs**

The system must retain purchase prices and provide a historical purchase record.

**FR-064 — Supplier balances**

The application should track recorded supplier payments and outstanding balances.

Acceptance criteria:

- Draft purchases do not change stock.
- Stock increases when the applicable receipt is finalized.
- Purchase records remain linked to their supplier and received items.

### 6.7 Returns and Refunds

**FR-070 — Sales returns**

Authorized users must be able to create a return linked to an original sale.

**FR-071 — Return quantities**

Returned quantities cannot exceed the eligible quantity remaining from the original sale.

**FR-072 — Refund recording**

The application must record refund amounts and payment methods.

**FR-073 — Restocking**

The user must specify whether returned goods are restocked, quarantined, or written off, where applicable.

**FR-074 — Auditability**

Completed returns must preserve the original sale history and create traceable inventory and payment adjustments.

### 6.8 Customers and Credit

**FR-080 — Customer records**

The application must support customer names and optional contact details.

**FR-081 — Customer-linked sales**

Sales may be associated with a customer.

**FR-082 — Customer credit**

Customer credit and outstanding balances are a planned enhancement. If enabled, the application must record credit transactions and repayments rather than treating them as cash received.

### 6.9 Reports and Dashboard

**FR-090 — Daily sales report**

The system must show completed sales for a selected date or date range.

**FR-091 — Sales metrics**

The dashboard must display total sales, number of bills, average bill value, and payment-method totals.

**FR-092 — Product performance**

Users must be able to view top-selling products by quantity and sales value.

**FR-093 — Inventory reports**

Users must be able to view current stock, low-stock items, and stock movement history.

**FR-094 — Purchase reports**

Users must be able to review purchases by supplier and date.

**FR-095 — Export**

The application should export relevant reports to CSV.

**FR-096 — Report definitions**

Reports must clearly distinguish gross sales, discounts, tax, refunds, net sales, and payment collections. These values must not be combined into a misleading single metric.

Acceptance criteria:

- Reports reflect finalized transactions and applicable reversals.
- Date filtering uses the store's configured time zone.
- Exported figures reconcile with the corresponding report.

### 6.10 Backup and Restore

**FR-100 — Manual backup**

Authorized users must be able to create a backup to a selected local or external destination.

**FR-101 — Automatic backup**

The application should support configurable scheduled backups.

**FR-102 — Restore**

Users must be able to restore from a valid backup after appropriate confirmation.

**FR-103 — Backup integrity**

The application must validate a backup before restoring it and avoid overwriting the active database without a recovery plan.

**FR-104 — Backup status**

The application must display the latest successful backup time and report failures.

Acceptance criteria:

- A backup can be restored to a test installation.
- Restored invoices, inventory, and settings remain consistent.
- Failed backup operations are visible to the user.

---

## 7. Cross-Industry Architecture Requirements

### 7.1 Shared domain

The following capabilities should be shared across industries:

- Product catalogue and variants.
- Customers and suppliers.
- Pricing and discount services.
- Sales, invoice items, and payment records.
- Inventory movement engine.
- Purchase management.
- Tax calculation framework.
- Permissions and audit history.
- Reporting infrastructure.
- Database migrations and backup services.

### 7.2 Industry-specific extensions

**Grocery and retail**

Variable-weight products, barcode workflows, price labels, and weighing-scale integration.

**Restaurant**

Orders, tables, kitchen tickets, menu modifiers, service charges, and order status management.

**Electronics**

Serial numbers, IMEI tracking, warranty information, and device-specific returns.

**Pharmacy**

Batch-level inventory, expiry dates, applicable prescription workflows, and regulated-product controls.

Each extension must define its own validation rules and workflows while reusing shared services where appropriate.

### 7.3 Module activation

The platform must maintain a configuration describing the selected business type and enabled modules.

Module activation must not delete unrelated data or change historical invoices.

---

## 8. Data Model Requirements

The initial relational model should include the following entities:

| Entity | Purpose |
|---|---|
| businesses | Store identity and configuration |
| users, roles, permissions | Authentication and access control |
| products | Product catalogue |
| product_variants | Pack sizes, models, and variants |
| categories, units | Product classification and measurement |
| customers, suppliers | Business relationships |
| sales | Completed sales and invoice headers |
| sale_items | Invoice line items and historical price snapshots |
| payments | Recorded payments and refunds |
| purchases, purchase_items | Purchase orders and received goods |
| inventory_movements | Stock ledger |
| product_batches | Optional batch and expiry tracking |
| serial_numbers | Optional serial/IMEI tracking |
| returns, return_items | Sale reversals and returned goods |
| expenses | Operational expense records |
| audit_logs | Traceable administrative actions |
| application_settings | Local preferences and configuration |
| schema_migrations | Database schema version history |

Design rules:

1. Use primary keys and foreign-key constraints.
2. Store money as integer minor units where appropriate, or use a carefully defined decimal representation that avoids floating-point arithmetic errors.
3. Store historical invoice prices, discounts, and tax values on the sale line so later product changes do not rewrite history.
4. Use database transactions for multi-record operations.
5. Use soft deletion or explicit archival for records that must remain historically traceable.
6. Use appropriate indexes for barcode lookup, product search, invoice retrieval, and date-based reporting.
7. Avoid one oversized product table containing unrelated fields for every industry.

---

## 9. Technical Architecture

### 9.1 Technology stack

| Layer | Technology |
|---|---|
| Desktop runtime | Electron |
| UI | React + TypeScript |
| Styling | Tailwind CSS |
| Database | SQLite |
| Database access | Maintained SQLite driver compatible with the selected Electron version |
| Validation | Zod or equivalent |
| State management | Zustand or Redux Toolkit |
| Testing | Vitest and Playwright |
| Packaging | Electron Forge or electron-builder |
| Version control | Git |

### 9.2 Application boundaries

- **Electron main process:** Window management, application lifecycle, trusted native integrations.
- **Preload layer:** Narrow, typed API exposed to the renderer.
- **React renderer:** User interface and client-side presentation.
- **Application services:** Billing, pricing, payments, inventory, returns, and reporting rules.
- **Repositories:** Database access and persistence.
- **SQLite:** Authoritative local business records.

The React renderer must not have unrestricted access to Node.js or the local filesystem. Enable context isolation and disable renderer Node.js integration.

### 9.3 Offline-first behaviour

The system must not require a remote API for core billing, inventory, purchase, or reporting operations.

Network-dependent features must fail independently without blocking local operations.

The initial version will use a single local database. Multiple counters must not independently maintain conflicting copies of the same store's inventory without an explicit synchronization architecture.

### 9.4 Installation and updates

The product must provide a Windows installer, versioned application releases, database migrations, and a recovery strategy for interrupted updates.

Application updates must not silently destroy or replace user business data.

---

## 10. UI/UX Requirements

### 10.1 Design direction

StorePro should look like a professional retail application rather than a generic analytics dashboard.

Visual direction:

- Dark navy sidebar.
- Clean, light workspace.
- High-contrast billing totals.
- Consistent spacing and typography.
- Clear validation and error messages.
- Persistent offline-status indicator.
- Keyboard-first checkout.

### 10.2 Primary navigation

- Billing (POS).
- Products.
- Inventory.
- Purchases.
- Sales.
- Customers.
- Suppliers.
- Reports.
- Expenses.
- Settings.

Navigation items should be filtered according to enabled modules and user permissions.

### 10.3 Billing screen

The billing screen must prioritize speed and visibility.

The layout should include:

- Barcode/search field near the top.
- Product grid or searchable product list.
- Current cart with quantity and line totals.
- Subtotal, discount, tax, and payable total.
- Clearly visible payment actions.
- Hold bill and new bill actions.

### 10.4 Accessibility and usability

- Support keyboard navigation.
- Use readable text and adequate contrast.
- Provide clear focus states.
- Avoid relying on colour alone to communicate status.
- Confirm destructive actions.
- Make error recovery understandable to nontechnical users.

---

## 11. Non-Functional Requirements

### Performance

- Product barcode lookup target: under 100 ms on the reference machine for a warm local lookup.
- Standard product search target: under 300 ms for a catalogue of 10,000 products.
- Checkout persistence target: under 500 ms for a typical sale, excluding external printer delays.
- Dashboard reports should remain responsive for the defined initial dataset.

These are proposed engineering targets and must be validated on representative hardware.

### Reliability

- No partial invoice, payment, and inventory updates after a failed checkout transaction.
- No duplicate completed sales from repeated checkout requests.
- Graceful recovery after an application crash.
- Database integrity checks during recovery and maintenance.

### Security

- Secure password hashing.
- Principle of least privilege.
- Context isolation in Electron.
- Strict validation at application-service boundaries.
- No hardcoded credentials.
- Protected local business data and secure backup handling.

### Compatibility

- Support a defined minimum Windows version and 64-bit architecture.
- Test installation, upgrades, and printing on clean Windows installations.
- Validate supported scanner and printer configurations.

### Maintainability

- Shared business rules must have unit tests.
- Database schema changes must use versioned migrations.
- Industry modules must not bypass shared transaction and audit services.
- Core domain code must remain independent of React UI components.

---

## 12. Acceptance and Quality Assurance Plan

The MVP is ready for release only when the following test areas pass:

1. Product creation, editing, barcode search, and import validation.
2. Cash billing with correct totals and tax calculation.
3. Offline checkout and receipt printing.
4. Sale persistence after application restart.
5. Atomic invoice, payment, and inventory updates.
6. Prevention of duplicate checkout operations.
7. Purchase receipts and stock reconciliation.
8. Sales returns, refunds, and inventory reversals.
9. Role-based permission enforcement.
10. Backup creation and restoration.
11. Migration from an earlier database version.
12. Windows installation and upgrade testing.
13. Keyboard-only billing workflow.
14. Sales report reconciliation against stored transactions.

Testing must cover normal use, invalid input, interrupted operations, database errors, and application restarts.

---

## 13. Product Metrics

The following are initial targets to validate during pilot deployments.

| Metric | Proposed target |
|---|---|
| Typical checkout time | Under 15 seconds for a simple one-item sale after the cashier is trained |
| Core billing availability | No internet required |
| Duplicate completed sales | Zero in release acceptance tests |
| Transaction consistency | All defined atomicity tests pass |
| Backup restoration | Successful restoration in release testing |
| Critical defects | Zero known unresolved critical defects at release |
| User onboarding | A new cashier can complete a guided test sale without developer assistance |

Collect performance and reliability measurements from consented pilot testing. Do not collect unnecessary customer or sales data for product analytics.

---

## 14. Risks and Mitigations

**Risk: Scope expansion across industries**

Mitigation: Keep the first release grocery-focused and require explicit prioritization for every new feature.

**Risk: Incorrect stock balances**

Mitigation: Centralize inventory movements and use transactional updates with reconciliation reports.

**Risk: Corrupted or lost local data**

Mitigation: Provide validated backups, integrity checks, recovery instructions, and tested restoration procedures.

**Risk: Hardware incompatibility**

Mitigation: Maintain a supported-device matrix and test real barcode scanners and thermal printers.

**Risk: Tax or invoice compliance gaps**

Mitigation: Validate applicable Indian GST and invoicing requirements with qualified domain expertise before production deployment.

**Risk: Multi-counter data conflicts**

Mitigation: Keep the first release single-computer and design synchronization as a separate future capability.

**Risk: Sensitive local data exposure**

Mitigation: Apply OS-level access controls, secure authentication, and an explicit backup security policy.

---

## 15. Dependencies and Open Decisions

The following must be finalized before implementation is considered production-ready:

- Minimum supported Windows version.
- Initial target store size and product catalogue volume.
- Supported thermal printer models and receipt formats.
- Barcode scanner and weighing-scale compatibility.
- Exact tax and invoice requirements.
- Whether customer credit is included in the first release.
- Whether multiple units or counters are required by pilot customers.
- Backup retention and encryption requirements.
- Licensing, activation, and update policy.
- Distribution and customer support process.

---

## 16. Definition of Done

A feature is complete when:

- Its business requirements are implemented.
- Validation and error handling are present.
- Relevant permissions are enforced.
- Database changes are covered by migrations.
- Unit and integration tests pass.
- The UI has been reviewed against the design requirements.
- Offline behaviour is tested where applicable.
- Audit history is implemented for sensitive operations.
- Documentation and recovery procedures are updated.

The MVP is complete when all P0 requirements and critical acceptance tests pass on the supported Windows environment.

---

## 17. Final Product Decision

StorePro will be developed as one modular desktop application, with a shared domain and database layer and industry-specific workflows.

The first release will target grocery stores, with offline billing, inventory, purchases, barcode scanning, thermal printing, reports, and backup/restore as its essential capabilities.

The architecture will support additional industries without requiring separate implementations of billing, payments, inventory movements, authentication, or reporting infrastructure.

**The guiding product principle is simple: build one reliable core, then extend it for each industry's real operational needs.**
