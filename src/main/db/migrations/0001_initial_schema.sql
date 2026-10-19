-- StorePro initial schema (MVP).
--
-- Design rules (see docs/data-model.md):
--   * Every base table is in third normal form. Totals, balances and statuses
--     are derived in views (v_*), never stored.
--   * Values copied onto transaction lines (price, tax, description, unit) are
--     historical snapshots: facts about the transaction at the time it happened.
--   * Money is INTEGER minor units (*_minor), quantities are INTEGER thousandths
--     (*_milli), rates are INTEGER basis points (*_bp), timestamps are INTEGER
--     Unix epoch milliseconds in UTC (*_at), calendar dates are TEXT YYYY-MM-DD (*_date).
--   * Transaction records are append-only; corrections are new documents.
--   * Reference data is archived (archived_at), never deleted.

-- ===========================================================================
-- Reference data
-- ===========================================================================

CREATE TABLE currencies (
  currency_code TEXT PRIMARY KEY
    CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
  name          TEXT NOT NULL UNIQUE,
  symbol        TEXT NOT NULL,
  minor_units   INTEGER NOT NULL CHECK (minor_units BETWEEN 0 AND 4)
) STRICT;

CREATE TABLE business_types (
  business_type_code TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE modules (
  module_code TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE units (
  unit_code       TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  allows_fraction INTEGER NOT NULL CHECK (allows_fraction IN (0, 1))
) STRICT;

CREATE TABLE tax_components (
  tax_component_code TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE adjustment_reasons (
  adjustment_reason_code TEXT PRIMARY KEY,
  name                   TEXT NOT NULL UNIQUE
) STRICT;

-- ===========================================================================
-- Store configuration
-- ===========================================================================

-- One database holds one store, so this table has exactly one row.
CREATE TABLE businesses (
  business_id             INTEGER PRIMARY KEY CHECK (business_id = 1),
  name                    TEXT NOT NULL CHECK (length(trim(name)) > 0),
  address_line1           TEXT NOT NULL,
  address_line2           TEXT,
  city                    TEXT NOT NULL,
  region_code             TEXT,
  postal_code             TEXT,
  country_code            TEXT NOT NULL CHECK (length(country_code) = 2),
  phone                   TEXT NOT NULL,
  email                   TEXT,
  tax_registration_number TEXT,
  currency_code           TEXT NOT NULL REFERENCES currencies (currency_code),
  time_zone               TEXT NOT NULL,
  business_type_code      TEXT NOT NULL REFERENCES business_types (business_type_code),
  prices_include_tax      INTEGER NOT NULL DEFAULT 1 CHECK (prices_include_tax IN (0, 1)),
  allow_negative_stock    INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative_stock IN (0, 1)),
  receipt_header          TEXT,
  receipt_footer          TEXT,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
) STRICT;

CREATE INDEX businesses_currency_code ON businesses (currency_code);
CREATE INDEX businesses_business_type_code ON businesses (business_type_code);

CREATE TABLE enabled_modules (
  module_code TEXT PRIMARY KEY REFERENCES modules (module_code),
  enabled_at  INTEGER NOT NULL
) STRICT;

-- Device-local preferences only (printer name, last screen, ...). Business data
-- never goes here; it belongs in typed columns.
CREATE TABLE app_settings (
  setting_key   TEXT PRIMARY KEY CHECK (setting_key GLOB '[a-z]*'),
  setting_value TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
) STRICT;

-- Running counters for human-readable document numbers.
CREATE TABLE document_sequences (
  document_type TEXT PRIMARY KEY CHECK (document_type IN (
    'sale_invoice', 'sale_return', 'purchase_order', 'goods_receipt', 'stock_adjustment'
  )),
  prefix        TEXT NOT NULL,
  next_number   INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  min_digits    INTEGER NOT NULL DEFAULT 6 CHECK (min_digits BETWEEN 1 AND 12)
) STRICT;

-- ===========================================================================
-- Users, roles and audit
-- ===========================================================================

CREATE TABLE roles (
  role_id   INTEGER PRIMARY KEY,
  role_code TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL COLLATE NOCASE UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1))
) STRICT;

CREATE TABLE permissions (
  permission_code TEXT PRIMARY KEY CHECK (permission_code GLOB '[a-z]*.[a-z]*'),
  description     TEXT NOT NULL
) STRICT;

CREATE TABLE role_permissions (
  role_id         INTEGER NOT NULL REFERENCES roles (role_id),
  permission_code TEXT NOT NULL REFERENCES permissions (permission_code),
  PRIMARY KEY (role_id, permission_code)
) STRICT, WITHOUT ROWID;

CREATE INDEX role_permissions_permission_code ON role_permissions (permission_code);

CREATE TABLE users (
  user_id       INTEGER PRIMARY KEY,
  username      TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(username) BETWEEN 3 AND 64),
  display_name  TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  password_hash TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles (role_id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  archived_at   INTEGER
) STRICT;

CREATE INDEX users_role_id ON users (role_id);

-- The log must outlive the rows it describes, so (entity_type, entity_id) is
-- deliberately not a foreign key. details is an opaque JSON document.
CREATE TABLE audit_logs (
  audit_log_id INTEGER PRIMARY KEY,
  occurred_at  INTEGER NOT NULL,
  user_id      INTEGER REFERENCES users (user_id),
  action       TEXT NOT NULL CHECK (action GLOB '[a-z]*.[a-z]*'),
  entity_type  TEXT,
  entity_id    INTEGER,
  details      TEXT CHECK (details IS NULL OR json_valid(details)),
  CHECK ((entity_type IS NULL) = (entity_id IS NULL))
) STRICT;

CREATE INDEX audit_logs_occurred_at ON audit_logs (occurred_at);
CREATE INDEX audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX audit_logs_entity ON audit_logs (entity_type, entity_id);

-- ===========================================================================
-- Catalogue
-- ===========================================================================

CREATE TABLE categories (
  category_id INTEGER PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER
) STRICT;

CREATE TABLE tax_classes (
  tax_class_id INTEGER PRIMARY KEY,
  name         TEXT NOT NULL COLLATE NOCASE UNIQUE,
  rate_bp      INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  archived_at  INTEGER
) STRICT;

-- Attributes shared by every pack size / variant of an item.
CREATE TABLE products (
  product_id       INTEGER PRIMARY KEY,
  name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category_id      INTEGER REFERENCES categories (category_id),
  tax_class_id     INTEGER NOT NULL REFERENCES tax_classes (tax_class_id),
  hsn_code         TEXT CHECK (hsn_code IS NULL OR (
                     hsn_code NOT GLOB '*[^0-9]*' AND length(hsn_code) BETWEEN 4 AND 8)),
  tracks_inventory INTEGER NOT NULL DEFAULT 1 CHECK (tracks_inventory IN (0, 1)),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  archived_at      INTEGER
) STRICT;

CREATE INDEX products_category_id ON products (category_id);
CREATE INDEX products_tax_class_id ON products (tax_class_id);

-- The stock-keeping unit: what is priced, scanned, sold and counted.
-- Every product has at least one variant; a single-variant product has
-- variant_name NULL.
CREATE TABLE product_variants (
  variant_id          INTEGER PRIMARY KEY,
  product_id          INTEGER NOT NULL REFERENCES products (product_id),
  variant_name        TEXT CHECK (variant_name IS NULL OR length(trim(variant_name)) > 0),
  sku                 TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(sku)) > 0),
  unit_code           TEXT NOT NULL REFERENCES units (unit_code),
  selling_price_minor INTEGER NOT NULL CHECK (selling_price_minor BETWEEN 0 AND 1000000000),
  mrp_minor           INTEGER CHECK (mrp_minor IS NULL OR (
                        mrp_minor <= 1000000000 AND mrp_minor >= selling_price_minor)),
  -- Standard cost entered by the user or confirmed on a goods receipt; not
  -- derivable from purchase history (opening items have no purchases).
  cost_price_minor    INTEGER CHECK (cost_price_minor IS NULL OR cost_price_minor BETWEEN 0 AND 1000000000),
  reorder_level_milli INTEGER CHECK (reorder_level_milli IS NULL OR reorder_level_milli >= 0),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  archived_at         INTEGER,
  UNIQUE (product_id, variant_name)
) STRICT;

CREATE INDEX product_variants_unit_code ON product_variants (unit_code);
-- At most one unnamed (default) variant per product.
CREATE UNIQUE INDEX product_variants_one_default
  ON product_variants (product_id) WHERE variant_name IS NULL;

-- A variant can carry several barcodes; a barcode identifies exactly one variant.
CREATE TABLE barcodes (
  barcode    TEXT PRIMARY KEY CHECK (length(barcode) BETWEEN 1 AND 64 AND barcode = trim(barcode)),
  variant_id INTEGER NOT NULL REFERENCES product_variants (variant_id),
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX barcodes_variant_id ON barcodes (variant_id);

-- ===========================================================================
-- Parties
-- ===========================================================================

CREATE TABLE customers (
  customer_id             INTEGER PRIMARY KEY,
  name                    TEXT NOT NULL CHECK (length(trim(name)) > 0),
  phone                   TEXT UNIQUE,
  email                   TEXT,
  address                 TEXT,
  tax_registration_number TEXT,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  archived_at             INTEGER
) STRICT;

CREATE INDEX customers_name ON customers (name COLLATE NOCASE);

CREATE TABLE suppliers (
  supplier_id             INTEGER PRIMARY KEY,
  name                    TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  contact_person          TEXT,
  phone                   TEXT,
  email                   TEXT,
  address                 TEXT,
  tax_registration_number TEXT,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  archived_at             INTEGER
) STRICT;

-- ===========================================================================
-- Payments
-- ===========================================================================

CREATE TABLE payment_methods (
  payment_method_id INTEGER PRIMARY KEY,
  method_code       TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL COLLATE NOCASE UNIQUE,
  -- Behaviour, not identity: e.g. 'cash' enables tendered amount and change.
  kind              TEXT NOT NULL CHECK (kind IN ('cash', 'upi', 'card', 'other')),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  archived_at       INTEGER
) STRICT;

-- ===========================================================================
-- Sales (completed, immutable documents)
-- ===========================================================================

CREATE TABLE sales (
  sale_id            INTEGER PRIMARY KEY,
  invoice_number     TEXT NOT NULL UNIQUE,
  -- Idempotency key from the checkout operation: a retried checkout cannot
  -- create a second sale.
  checkout_key       TEXT NOT NULL UNIQUE,
  completed_at       INTEGER NOT NULL,
  cashier_user_id    INTEGER NOT NULL REFERENCES users (user_id),
  customer_id        INTEGER REFERENCES customers (customer_id),
  -- Snapshot of the store's pricing basis when the sale was made.
  prices_include_tax INTEGER NOT NULL CHECK (prices_include_tax IN (0, 1)),
  -- Bill rounding applied under the rounding rule in force at the time.
  round_off_minor    INTEGER NOT NULL DEFAULT 0 CHECK (round_off_minor BETWEEN -100000 AND 100000)
) STRICT;

CREATE INDEX sales_completed_at ON sales (completed_at);
CREATE INDEX sales_cashier_user_id ON sales (cashier_user_id);
CREATE INDEX sales_customer_id ON sales (customer_id);

CREATE TABLE sale_items (
  sale_item_id     INTEGER PRIMARY KEY,
  sale_id          INTEGER NOT NULL REFERENCES sales (sale_id),
  line_number      INTEGER NOT NULL CHECK (line_number >= 1),
  variant_id       INTEGER NOT NULL REFERENCES product_variants (variant_id),
  -- Snapshots, as printed on the invoice.
  description      TEXT NOT NULL,
  hsn_code         TEXT,
  unit_code        TEXT NOT NULL REFERENCES units (unit_code),
  quantity_milli   INTEGER NOT NULL CHECK (quantity_milli BETWEEN 1 AND 1000000000),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor BETWEEN 0 AND 1000000000),
  -- Line discount plus this line's share of any bill-level discount.
  discount_minor   INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  unit_cost_minor  INTEGER CHECK (unit_cost_minor IS NULL OR unit_cost_minor BETWEEN 0 AND 1000000000),
  UNIQUE (sale_id, line_number),
  CHECK (discount_minor <= (quantity_milli * unit_price_minor + 500) / 1000)
) STRICT;

CREATE INDEX sale_items_variant_id ON sale_items (variant_id);
CREATE INDEX sale_items_unit_code ON sale_items (unit_code);

-- One row per tax component (e.g. CGST + SGST, or IGST) charged on a line.
CREATE TABLE sale_item_taxes (
  sale_item_id       INTEGER NOT NULL REFERENCES sale_items (sale_item_id),
  tax_component_code TEXT NOT NULL REFERENCES tax_components (tax_component_code),
  rate_bp            INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  amount_minor       INTEGER NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (sale_item_id, tax_component_code)
) STRICT, WITHOUT ROWID;

CREATE INDEX sale_item_taxes_tax_component_code ON sale_item_taxes (tax_component_code);

CREATE TABLE sale_payments (
  sale_payment_id   INTEGER PRIMARY KEY,
  sale_id           INTEGER NOT NULL REFERENCES sales (sale_id),
  payment_method_id INTEGER NOT NULL REFERENCES payment_methods (payment_method_id),
  amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),
  -- Cash handed over; change is derived (tendered - amount).
  tendered_minor    INTEGER CHECK (tendered_minor IS NULL OR tendered_minor >= amount_minor),
  -- Payer-side reference such as a UPI transaction id. Recorded, not verified.
  reference         TEXT
) STRICT;

CREATE INDEX sale_payments_sale_id ON sale_payments (sale_id);
CREATE INDEX sale_payments_payment_method_id ON sale_payments (payment_method_id);

-- A void reverses a whole sale. Being a separate fact keeps sales immutable.
CREATE TABLE sale_voids (
  sale_id             INTEGER PRIMARY KEY REFERENCES sales (sale_id),
  voided_at           INTEGER NOT NULL,
  voided_by_user_id   INTEGER NOT NULL REFERENCES users (user_id),
  approved_by_user_id INTEGER REFERENCES users (user_id),
  reason              TEXT NOT NULL CHECK (length(trim(reason)) > 0)
) STRICT;

CREATE INDEX sale_voids_voided_by_user_id ON sale_voids (voided_by_user_id);
CREATE INDEX sale_voids_approved_by_user_id ON sale_voids (approved_by_user_id);

-- ===========================================================================
-- Returns and refunds
-- ===========================================================================

CREATE TABLE sale_returns (
  sale_return_id       INTEGER PRIMARY KEY,
  return_number        TEXT NOT NULL UNIQUE,
  sale_id              INTEGER NOT NULL REFERENCES sales (sale_id),
  returned_at          INTEGER NOT NULL,
  processed_by_user_id INTEGER NOT NULL REFERENCES users (user_id),
  reason               TEXT
) STRICT;

CREATE INDEX sale_returns_sale_id ON sale_returns (sale_id);
CREATE INDEX sale_returns_returned_at ON sale_returns (returned_at);
CREATE INDEX sale_returns_processed_by_user_id ON sale_returns (processed_by_user_id);

CREATE TABLE sale_return_items (
  sale_return_item_id INTEGER PRIMARY KEY,
  sale_return_id      INTEGER NOT NULL REFERENCES sale_returns (sale_return_id),
  sale_item_id        INTEGER NOT NULL REFERENCES sale_items (sale_item_id),
  disposition         TEXT NOT NULL CHECK (disposition IN ('restock', 'quarantine', 'write_off')),
  quantity_milli      INTEGER NOT NULL CHECK (quantity_milli BETWEEN 1 AND 1000000000),
  -- Value credited for the goods, on the same price basis as the original sale.
  credit_amount_minor INTEGER NOT NULL CHECK (credit_amount_minor BETWEEN 0 AND 1000000000000),
  UNIQUE (sale_return_id, sale_item_id, disposition)
) STRICT;

CREATE INDEX sale_return_items_sale_item_id ON sale_return_items (sale_item_id);

CREATE TABLE sale_return_item_taxes (
  sale_return_item_id INTEGER NOT NULL REFERENCES sale_return_items (sale_return_item_id),
  tax_component_code  TEXT NOT NULL REFERENCES tax_components (tax_component_code),
  rate_bp             INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  amount_minor        INTEGER NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (sale_return_item_id, tax_component_code)
) STRICT, WITHOUT ROWID;

CREATE INDEX sale_return_item_taxes_tax_component_code ON sale_return_item_taxes (tax_component_code);

CREATE TABLE return_refunds (
  return_refund_id  INTEGER PRIMARY KEY,
  sale_return_id    INTEGER NOT NULL REFERENCES sale_returns (sale_return_id),
  payment_method_id INTEGER NOT NULL REFERENCES payment_methods (payment_method_id),
  amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),
  reference         TEXT
) STRICT;

CREATE INDEX return_refunds_sale_return_id ON return_refunds (sale_return_id);
CREATE INDEX return_refunds_payment_method_id ON return_refunds (payment_method_id);

-- ===========================================================================
-- Held (unfinished) bills: mutable drafts, not sales
-- ===========================================================================

CREATE TABLE held_bills (
  held_bill_id    INTEGER PRIMARY KEY,
  label           TEXT,
  customer_id     INTEGER REFERENCES customers (customer_id),
  held_by_user_id INTEGER NOT NULL REFERENCES users (user_id),
  held_at         INTEGER NOT NULL
) STRICT;

CREATE INDEX held_bills_customer_id ON held_bills (customer_id);
CREATE INDEX held_bills_held_by_user_id ON held_bills (held_by_user_id);

CREATE TABLE held_bill_items (
  held_bill_item_id         INTEGER PRIMARY KEY,
  held_bill_id              INTEGER NOT NULL REFERENCES held_bills (held_bill_id) ON DELETE CASCADE,
  line_number               INTEGER NOT NULL CHECK (line_number >= 1),
  variant_id                INTEGER NOT NULL REFERENCES product_variants (variant_id),
  quantity_milli            INTEGER NOT NULL CHECK (quantity_milli BETWEEN 1 AND 1000000000),
  -- NULL means "use the current selling price when the bill is resumed".
  unit_price_override_minor INTEGER CHECK (unit_price_override_minor IS NULL OR
                              unit_price_override_minor BETWEEN 0 AND 1000000000),
  discount_minor            INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  UNIQUE (held_bill_id, line_number)
) STRICT;

CREATE INDEX held_bill_items_variant_id ON held_bill_items (variant_id);

-- ===========================================================================
-- Purchasing
-- ===========================================================================

-- Status is derived from the event timestamps (see v_purchase_orders).
CREATE TABLE purchase_orders (
  purchase_order_id  INTEGER PRIMARY KEY,
  order_number       TEXT NOT NULL UNIQUE,
  supplier_id        INTEGER NOT NULL REFERENCES suppliers (supplier_id),
  created_by_user_id INTEGER NOT NULL REFERENCES users (user_id),
  notes              TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  confirmed_at       INTEGER,
  closed_at          INTEGER,
  cancelled_at       INTEGER,
  CHECK (closed_at IS NULL OR confirmed_at IS NOT NULL),
  CHECK (closed_at IS NULL OR cancelled_at IS NULL)
) STRICT;

CREATE INDEX purchase_orders_supplier_id ON purchase_orders (supplier_id);
CREATE INDEX purchase_orders_created_by_user_id ON purchase_orders (created_by_user_id);

CREATE TABLE purchase_order_items (
  purchase_order_item_id INTEGER PRIMARY KEY,
  purchase_order_id      INTEGER NOT NULL REFERENCES purchase_orders (purchase_order_id) ON DELETE CASCADE,
  line_number            INTEGER NOT NULL CHECK (line_number >= 1),
  variant_id             INTEGER NOT NULL REFERENCES product_variants (variant_id),
  quantity_milli         INTEGER NOT NULL CHECK (quantity_milli BETWEEN 1 AND 1000000000),
  unit_cost_minor        INTEGER NOT NULL CHECK (unit_cost_minor BETWEEN 0 AND 1000000000),
  UNIQUE (purchase_order_id, line_number),
  UNIQUE (purchase_order_id, variant_id)
) STRICT;

CREATE INDEX purchase_order_items_variant_id ON purchase_order_items (variant_id);

-- A receipt of goods from a supplier. posted_at NULL = draft (no stock effect).
CREATE TABLE goods_receipts (
  goods_receipt_id        INTEGER PRIMARY KEY,
  receipt_number          TEXT NOT NULL UNIQUE,
  supplier_id             INTEGER NOT NULL REFERENCES suppliers (supplier_id),
  supplier_invoice_number TEXT,
  supplier_invoice_date   TEXT CHECK (supplier_invoice_date IS NULL OR
                            supplier_invoice_date IS date(supplier_invoice_date)),
  created_by_user_id      INTEGER NOT NULL REFERENCES users (user_id),
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  posted_at               INTEGER,
  posted_by_user_id       INTEGER REFERENCES users (user_id),
  CHECK ((posted_at IS NULL) = (posted_by_user_id IS NULL)),
  -- The same supplier bill cannot be entered twice.
  UNIQUE (supplier_id, supplier_invoice_number)
) STRICT;

CREATE INDEX goods_receipts_posted_at ON goods_receipts (posted_at);
CREATE INDEX goods_receipts_created_by_user_id ON goods_receipts (created_by_user_id);
CREATE INDEX goods_receipts_posted_by_user_id ON goods_receipts (posted_by_user_id);

-- Optional link from a receipt to the order it fulfils. Kept out of
-- goods_receipts so the receipt's supplier is not transitively implied.
CREATE TABLE goods_receipt_purchase_orders (
  goods_receipt_id  INTEGER PRIMARY KEY REFERENCES goods_receipts (goods_receipt_id) ON DELETE CASCADE,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders (purchase_order_id)
) STRICT;

CREATE INDEX goods_receipt_purchase_orders_purchase_order_id
  ON goods_receipt_purchase_orders (purchase_order_id);

CREATE TABLE goods_receipt_items (
  goods_receipt_item_id INTEGER PRIMARY KEY,
  goods_receipt_id      INTEGER NOT NULL REFERENCES goods_receipts (goods_receipt_id) ON DELETE CASCADE,
  line_number           INTEGER NOT NULL CHECK (line_number >= 1),
  variant_id            INTEGER NOT NULL REFERENCES product_variants (variant_id),
  quantity_milli        INTEGER NOT NULL CHECK (quantity_milli BETWEEN 1 AND 1000000000),
  unit_cost_minor       INTEGER NOT NULL CHECK (unit_cost_minor BETWEEN 0 AND 1000000000),
  UNIQUE (goods_receipt_id, line_number)
) STRICT;

CREATE INDEX goods_receipt_items_variant_id ON goods_receipt_items (variant_id);

-- ===========================================================================
-- Stock adjustments (opening stock, count corrections, damage, ...)
-- ===========================================================================

CREATE TABLE stock_adjustments (
  stock_adjustment_id    INTEGER PRIMARY KEY,
  adjustment_number      TEXT NOT NULL UNIQUE,
  adjustment_reason_code TEXT NOT NULL REFERENCES adjustment_reasons (adjustment_reason_code),
  adjusted_at            INTEGER NOT NULL,
  adjusted_by_user_id    INTEGER NOT NULL REFERENCES users (user_id),
  notes                  TEXT
) STRICT;

CREATE INDEX stock_adjustments_adjusted_at ON stock_adjustments (adjusted_at);
CREATE INDEX stock_adjustments_reason ON stock_adjustments (adjustment_reason_code);
CREATE INDEX stock_adjustments_adjusted_by_user_id ON stock_adjustments (adjusted_by_user_id);

CREATE TABLE stock_adjustment_items (
  stock_adjustment_item_id INTEGER PRIMARY KEY,
  stock_adjustment_id      INTEGER NOT NULL REFERENCES stock_adjustments (stock_adjustment_id),
  variant_id               INTEGER NOT NULL REFERENCES product_variants (variant_id),
  quantity_delta_milli     INTEGER NOT NULL CHECK (
                             quantity_delta_milli <> 0 AND
                             quantity_delta_milli BETWEEN -1000000000 AND 1000000000),
  UNIQUE (stock_adjustment_id, variant_id)
) STRICT;

CREATE INDEX stock_adjustment_items_variant_id ON stock_adjustment_items (variant_id);

-- ===========================================================================
-- Expenses
-- ===========================================================================

CREATE TABLE expense_categories (
  expense_category_id INTEGER PRIMARY KEY,
  name                TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  archived_at         INTEGER
) STRICT;

CREATE TABLE expenses (
  expense_id          INTEGER PRIMARY KEY,
  expense_category_id INTEGER NOT NULL REFERENCES expense_categories (expense_category_id),
  expense_date        TEXT NOT NULL CHECK (expense_date IS date(expense_date)),
  amount_minor        INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),
  payment_method_id   INTEGER NOT NULL REFERENCES payment_methods (payment_method_id),
  description         TEXT,
  recorded_by_user_id INTEGER NOT NULL REFERENCES users (user_id),
  recorded_at         INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  archived_at         INTEGER
) STRICT;

CREATE INDEX expenses_expense_date ON expenses (expense_date);
CREATE INDEX expenses_expense_category_id ON expenses (expense_category_id);
CREATE INDEX expenses_payment_method_id ON expenses (payment_method_id);
CREATE INDEX expenses_recorded_by_user_id ON expenses (recorded_by_user_id);

-- ===========================================================================
-- Integrity triggers: append-only records
-- ===========================================================================

CREATE TRIGGER sales_immutable_update BEFORE UPDATE ON sales
BEGIN SELECT RAISE(ABORT, 'sales are immutable; void the sale or record a return instead'); END;
CREATE TRIGGER sales_immutable_delete BEFORE DELETE ON sales
BEGIN SELECT RAISE(ABORT, 'sales are immutable; void the sale or record a return instead'); END;

CREATE TRIGGER sale_items_immutable_update BEFORE UPDATE ON sale_items
BEGIN SELECT RAISE(ABORT, 'sale_items are immutable'); END;
CREATE TRIGGER sale_items_immutable_delete BEFORE DELETE ON sale_items
BEGIN SELECT RAISE(ABORT, 'sale_items are immutable'); END;

CREATE TRIGGER sale_item_taxes_immutable_update BEFORE UPDATE ON sale_item_taxes
BEGIN SELECT RAISE(ABORT, 'sale_item_taxes are immutable'); END;
CREATE TRIGGER sale_item_taxes_immutable_delete BEFORE DELETE ON sale_item_taxes
BEGIN SELECT RAISE(ABORT, 'sale_item_taxes are immutable'); END;

CREATE TRIGGER sale_payments_immutable_update BEFORE UPDATE ON sale_payments
BEGIN SELECT RAISE(ABORT, 'sale_payments are immutable'); END;
CREATE TRIGGER sale_payments_immutable_delete BEFORE DELETE ON sale_payments
BEGIN SELECT RAISE(ABORT, 'sale_payments are immutable'); END;

CREATE TRIGGER sale_voids_immutable_update BEFORE UPDATE ON sale_voids
BEGIN SELECT RAISE(ABORT, 'sale_voids are immutable'); END;
CREATE TRIGGER sale_voids_immutable_delete BEFORE DELETE ON sale_voids
BEGIN SELECT RAISE(ABORT, 'sale_voids are immutable'); END;

CREATE TRIGGER sale_returns_immutable_update BEFORE UPDATE ON sale_returns
BEGIN SELECT RAISE(ABORT, 'sale_returns are immutable'); END;
CREATE TRIGGER sale_returns_immutable_delete BEFORE DELETE ON sale_returns
BEGIN SELECT RAISE(ABORT, 'sale_returns are immutable'); END;

CREATE TRIGGER sale_return_items_immutable_update BEFORE UPDATE ON sale_return_items
BEGIN SELECT RAISE(ABORT, 'sale_return_items are immutable'); END;
CREATE TRIGGER sale_return_items_immutable_delete BEFORE DELETE ON sale_return_items
BEGIN SELECT RAISE(ABORT, 'sale_return_items are immutable'); END;

CREATE TRIGGER sale_return_item_taxes_immutable_update BEFORE UPDATE ON sale_return_item_taxes
BEGIN SELECT RAISE(ABORT, 'sale_return_item_taxes are immutable'); END;
CREATE TRIGGER sale_return_item_taxes_immutable_delete BEFORE DELETE ON sale_return_item_taxes
BEGIN SELECT RAISE(ABORT, 'sale_return_item_taxes are immutable'); END;

CREATE TRIGGER return_refunds_immutable_update BEFORE UPDATE ON return_refunds
BEGIN SELECT RAISE(ABORT, 'return_refunds are immutable'); END;
CREATE TRIGGER return_refunds_immutable_delete BEFORE DELETE ON return_refunds
BEGIN SELECT RAISE(ABORT, 'return_refunds are immutable'); END;

CREATE TRIGGER stock_adjustments_immutable_update BEFORE UPDATE ON stock_adjustments
BEGIN SELECT RAISE(ABORT, 'stock_adjustments are immutable; record a new adjustment'); END;
CREATE TRIGGER stock_adjustments_immutable_delete BEFORE DELETE ON stock_adjustments
BEGIN SELECT RAISE(ABORT, 'stock_adjustments are immutable; record a new adjustment'); END;

CREATE TRIGGER stock_adjustment_items_immutable_update BEFORE UPDATE ON stock_adjustment_items
BEGIN SELECT RAISE(ABORT, 'stock_adjustment_items are immutable'); END;
CREATE TRIGGER stock_adjustment_items_immutable_delete BEFORE DELETE ON stock_adjustment_items
BEGIN SELECT RAISE(ABORT, 'stock_adjustment_items are immutable'); END;

CREATE TRIGGER audit_logs_immutable_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs are immutable'); END;
CREATE TRIGGER audit_logs_immutable_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs are immutable'); END;

-- Posted goods receipts are immutable; drafts can be edited or deleted.
CREATE TRIGGER goods_receipts_posted_update BEFORE UPDATE ON goods_receipts
WHEN OLD.posted_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'posted goods receipts are immutable'); END;
CREATE TRIGGER goods_receipts_posted_delete BEFORE DELETE ON goods_receipts
WHEN OLD.posted_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'posted goods receipts are immutable'); END;

CREATE TRIGGER goods_receipt_items_posted_insert BEFORE INSERT ON goods_receipt_items
WHEN (SELECT posted_at FROM goods_receipts WHERE goods_receipt_id = NEW.goods_receipt_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'posted goods receipts are immutable'); END;
CREATE TRIGGER goods_receipt_items_posted_update BEFORE UPDATE ON goods_receipt_items
WHEN (SELECT posted_at FROM goods_receipts WHERE goods_receipt_id = OLD.goods_receipt_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'posted goods receipts are immutable'); END;
CREATE TRIGGER goods_receipt_items_posted_delete BEFORE DELETE ON goods_receipt_items
WHEN (SELECT posted_at FROM goods_receipts WHERE goods_receipt_id = OLD.goods_receipt_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'posted goods receipts are immutable'); END;

CREATE TRIGGER goods_receipt_purchase_orders_posted_change BEFORE UPDATE ON goods_receipt_purchase_orders
WHEN (SELECT posted_at FROM goods_receipts WHERE goods_receipt_id = OLD.goods_receipt_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'posted goods receipts are immutable'); END;

-- Confirmed purchase orders: only closing or cancelling is allowed.
CREATE TRIGGER purchase_orders_confirmed_update BEFORE UPDATE ON purchase_orders
WHEN OLD.confirmed_at IS NOT NULL AND (
  NEW.order_number IS NOT OLD.order_number OR
  NEW.supplier_id IS NOT OLD.supplier_id OR
  NEW.created_by_user_id IS NOT OLD.created_by_user_id OR
  NEW.created_at IS NOT OLD.created_at OR
  NEW.confirmed_at IS NOT OLD.confirmed_at)
BEGIN SELECT RAISE(ABORT, 'confirmed purchase orders cannot be edited'); END;
CREATE TRIGGER purchase_orders_confirmed_delete BEFORE DELETE ON purchase_orders
WHEN OLD.confirmed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'confirmed purchase orders cannot be deleted; cancel them instead'); END;

CREATE TRIGGER purchase_order_items_confirmed_insert BEFORE INSERT ON purchase_order_items
WHEN (SELECT confirmed_at FROM purchase_orders WHERE purchase_order_id = NEW.purchase_order_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'confirmed purchase orders cannot be edited'); END;
CREATE TRIGGER purchase_order_items_confirmed_update BEFORE UPDATE ON purchase_order_items
WHEN (SELECT confirmed_at FROM purchase_orders WHERE purchase_order_id = OLD.purchase_order_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'confirmed purchase orders cannot be edited'); END;
CREATE TRIGGER purchase_order_items_confirmed_delete BEFORE DELETE ON purchase_order_items
WHEN (SELECT confirmed_at FROM purchase_orders WHERE purchase_order_id = OLD.purchase_order_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'confirmed purchase orders cannot be edited'); END;

-- ===========================================================================
-- Integrity triggers: cross-row business rules
-- ===========================================================================

-- A returned line must belong to the returned sale, the sale must not be
-- voided, and the total returned can never exceed the quantity sold (FR-071).
CREATE TRIGGER sale_return_items_rules BEFORE INSERT ON sale_return_items
BEGIN
  SELECT RAISE(ABORT, 'returned item does not belong to the returned sale')
  WHERE (SELECT sale_id FROM sale_items WHERE sale_item_id = NEW.sale_item_id)
    IS NOT (SELECT sale_id FROM sale_returns WHERE sale_return_id = NEW.sale_return_id);
  SELECT RAISE(ABORT, 'a voided sale cannot be returned')
  WHERE EXISTS (SELECT 1 FROM sale_voids WHERE sale_id =
    (SELECT sale_id FROM sale_returns WHERE sale_return_id = NEW.sale_return_id));
  SELECT RAISE(ABORT, 'return quantity exceeds the quantity sold')
  WHERE NEW.quantity_milli + (
      SELECT coalesce(sum(quantity_milli), 0) FROM sale_return_items
      WHERE sale_item_id = NEW.sale_item_id)
    > (SELECT quantity_milli FROM sale_items WHERE sale_item_id = NEW.sale_item_id);
END;

CREATE TRIGGER sale_voids_rules BEFORE INSERT ON sale_voids
BEGIN
  SELECT RAISE(ABORT, 'a sale with returns cannot be voided')
  WHERE EXISTS (SELECT 1 FROM sale_returns WHERE sale_id = NEW.sale_id);
END;

-- A receipt can only fulfil a confirmed, open order from the same supplier.
CREATE TRIGGER goods_receipt_purchase_orders_rules BEFORE INSERT ON goods_receipt_purchase_orders
BEGIN
  SELECT RAISE(ABORT, 'goods receipt and purchase order have different suppliers')
  WHERE (SELECT supplier_id FROM goods_receipts WHERE goods_receipt_id = NEW.goods_receipt_id)
    IS NOT (SELECT supplier_id FROM purchase_orders WHERE purchase_order_id = NEW.purchase_order_id);
  SELECT RAISE(ABORT, 'purchase order is not confirmed and open')
  WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE purchase_order_id = NEW.purchase_order_id
    AND confirmed_at IS NOT NULL AND closed_at IS NULL AND cancelled_at IS NULL);
END;

-- ===========================================================================
-- Product search index (FTS5). An index, not a source of truth: it holds no
-- data of its own (contentless) and is maintained by the triggers below.
-- ===========================================================================

CREATE VIRTUAL TABLE variant_search USING fts5 (
  name, sku, barcodes,
  content = '',
  contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '1 2 3'
);

CREATE TRIGGER variant_search_variant_insert AFTER INSERT ON product_variants
BEGIN
  INSERT INTO variant_search (rowid, name, sku, barcodes)
  SELECT NEW.variant_id, p.name || coalesce(' ' || NEW.variant_name, ''), NEW.sku, ''
  FROM products p WHERE p.product_id = NEW.product_id;
END;

CREATE TRIGGER variant_search_variant_update AFTER UPDATE OF product_id, variant_name, sku ON product_variants
BEGIN
  DELETE FROM variant_search WHERE rowid = NEW.variant_id;
  INSERT INTO variant_search (rowid, name, sku, barcodes)
  SELECT NEW.variant_id, p.name || coalesce(' ' || NEW.variant_name, ''), NEW.sku,
    coalesce((SELECT group_concat(barcode, ' ') FROM barcodes WHERE variant_id = NEW.variant_id), '')
  FROM products p WHERE p.product_id = NEW.product_id;
END;

CREATE TRIGGER variant_search_product_rename AFTER UPDATE OF name ON products
BEGIN
  DELETE FROM variant_search
  WHERE rowid IN (SELECT variant_id FROM product_variants WHERE product_id = NEW.product_id);
  INSERT INTO variant_search (rowid, name, sku, barcodes)
  SELECT v.variant_id, NEW.name || coalesce(' ' || v.variant_name, ''), v.sku,
    coalesce((SELECT group_concat(barcode, ' ') FROM barcodes b WHERE b.variant_id = v.variant_id), '')
  FROM product_variants v WHERE v.product_id = NEW.product_id;
END;

CREATE TRIGGER variant_search_barcode_insert AFTER INSERT ON barcodes
BEGIN
  DELETE FROM variant_search WHERE rowid = NEW.variant_id;
  INSERT INTO variant_search (rowid, name, sku, barcodes)
  SELECT v.variant_id, p.name || coalesce(' ' || v.variant_name, ''), v.sku,
    coalesce((SELECT group_concat(barcode, ' ') FROM barcodes b WHERE b.variant_id = v.variant_id), '')
  FROM product_variants v JOIN products p ON p.product_id = v.product_id
  WHERE v.variant_id = NEW.variant_id;
END;

CREATE TRIGGER variant_search_barcode_delete AFTER DELETE ON barcodes
BEGIN
  DELETE FROM variant_search WHERE rowid = OLD.variant_id;
  INSERT INTO variant_search (rowid, name, sku, barcodes)
  SELECT v.variant_id, p.name || coalesce(' ' || v.variant_name, ''), v.sku,
    coalesce((SELECT group_concat(barcode, ' ') FROM barcodes b WHERE b.variant_id = v.variant_id), '')
  FROM product_variants v JOIN products p ON p.product_id = v.product_id
  WHERE v.variant_id = OLD.variant_id;
END;

-- ===========================================================================
-- Derived data (views). These are the single definitions of every total,
-- balance and status; application code must not re-derive them differently.
-- ===========================================================================

-- Line amounts. gross = quantity x unit price, rounded half-up to the minor
-- unit; shared/money.ts multiplyByQuantity implements the same rule.
CREATE VIEW v_sale_item_amounts AS
SELECT
  si.sale_item_id,
  si.sale_id,
  si.variant_id,
  si.quantity_milli,
  si.unit_price_minor,
  g.gross_minor,
  si.discount_minor,
  g.gross_minor - si.discount_minor AS net_minor,
  g.tax_minor,
  CASE WHEN s.prices_include_tax = 1
    THEN g.gross_minor - si.discount_minor - g.tax_minor
    ELSE g.gross_minor - si.discount_minor END AS taxable_minor,
  CASE WHEN s.prices_include_tax = 1
    THEN g.gross_minor - si.discount_minor
    ELSE g.gross_minor - si.discount_minor + g.tax_minor END AS total_minor
FROM sale_items si
JOIN sales s ON s.sale_id = si.sale_id
JOIN (
  SELECT
    sale_item_id,
    (quantity_milli * unit_price_minor + 500) / 1000 AS gross_minor,
    (SELECT coalesce(sum(t.amount_minor), 0) FROM sale_item_taxes t
     WHERE t.sale_item_id = sale_items.sale_item_id) AS tax_minor
  FROM sale_items
) g ON g.sale_item_id = si.sale_item_id;

CREATE VIEW v_sale_totals AS
SELECT
  s.sale_id,
  s.invoice_number,
  s.completed_at,
  s.cashier_user_id,
  s.customer_id,
  count(a.sale_item_id) AS line_count,
  sum(a.gross_minor) AS gross_minor,
  sum(a.discount_minor) AS discount_minor,
  sum(a.taxable_minor) AS taxable_minor,
  sum(a.tax_minor) AS tax_minor,
  s.round_off_minor,
  sum(a.total_minor) + s.round_off_minor AS grand_total_minor,
  (SELECT coalesce(sum(p.amount_minor), 0) FROM sale_payments p WHERE p.sale_id = s.sale_id) AS paid_minor,
  EXISTS (SELECT 1 FROM sale_voids v WHERE v.sale_id = s.sale_id) AS is_voided
FROM sales s
JOIN v_sale_item_amounts a ON a.sale_id = s.sale_id
-- Grouping by every sales column (all determined by sale_id) lets SQLite push
-- filters such as a completed_at range down to the sales index.
GROUP BY s.sale_id, s.invoice_number, s.completed_at, s.cashier_user_id, s.customer_id, s.round_off_minor;

CREATE VIEW v_sale_return_item_amounts AS
SELECT
  ri.sale_return_item_id,
  ri.sale_return_id,
  ri.sale_item_id,
  si.variant_id,
  ri.disposition,
  ri.quantity_milli,
  ri.credit_amount_minor,
  (SELECT coalesce(sum(t.amount_minor), 0) FROM sale_return_item_taxes t
   WHERE t.sale_return_item_id = ri.sale_return_item_id) AS tax_minor,
  s.prices_include_tax
FROM sale_return_items ri
JOIN sale_items si ON si.sale_item_id = ri.sale_item_id
JOIN sales s ON s.sale_id = si.sale_id;

CREATE VIEW v_sale_return_totals AS
SELECT
  r.sale_return_id,
  r.return_number,
  r.sale_id,
  r.returned_at,
  sum(a.tax_minor) AS tax_minor,
  sum(CASE WHEN a.prices_include_tax = 1 THEN a.credit_amount_minor
           ELSE a.credit_amount_minor + a.tax_minor END) AS refund_due_minor,
  (SELECT coalesce(sum(f.amount_minor), 0) FROM return_refunds f
   WHERE f.sale_return_id = r.sale_return_id) AS refunded_minor
FROM sale_returns r
JOIN v_sale_return_item_amounts a ON a.sale_return_id = r.sale_return_id
GROUP BY r.sale_return_id;

-- The stock ledger: every stock change, traced to the document line that
-- caused it. Built from the source documents, so it cannot drift from them.
CREATE VIEW v_inventory_movements AS
SELECT 'sale' AS movement_type, s.completed_at AS occurred_at, si.variant_id,
       -si.quantity_milli AS quantity_delta_milli,
       'sale_item' AS source_table, si.sale_item_id AS source_id, s.invoice_number AS document_number
FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id
UNION ALL
SELECT 'sale_void', v.voided_at, si.variant_id, si.quantity_milli,
       'sale_item', si.sale_item_id, s.invoice_number
FROM sale_voids v JOIN sales s ON s.sale_id = v.sale_id JOIN sale_items si ON si.sale_id = v.sale_id
UNION ALL
SELECT 'sale_return', r.returned_at, si.variant_id, ri.quantity_milli,
       'sale_return_item', ri.sale_return_item_id, r.return_number
FROM sale_return_items ri
JOIN sale_returns r ON r.sale_return_id = ri.sale_return_id
JOIN sale_items si ON si.sale_item_id = ri.sale_item_id
WHERE ri.disposition = 'restock'
UNION ALL
SELECT 'goods_receipt', g.posted_at, gi.variant_id, gi.quantity_milli,
       'goods_receipt_item', gi.goods_receipt_item_id, g.receipt_number
FROM goods_receipt_items gi JOIN goods_receipts g ON g.goods_receipt_id = gi.goods_receipt_id
WHERE g.posted_at IS NOT NULL
UNION ALL
SELECT 'adjustment', a.adjusted_at, ai.variant_id, ai.quantity_delta_milli,
       'stock_adjustment_item', ai.stock_adjustment_item_id, a.adjustment_number
FROM stock_adjustment_items ai JOIN stock_adjustments a ON a.stock_adjustment_id = ai.stock_adjustment_id;

-- Current stock for inventory-tracked variants. For a single variant prefer
-- querying v_inventory_movements WHERE variant_id = ? (uses the indexes).
CREATE VIEW v_stock_on_hand AS
SELECT v.variant_id, coalesce(sum(m.quantity_delta_milli), 0) AS on_hand_milli
FROM product_variants v
JOIN products p ON p.product_id = v.product_id
LEFT JOIN v_inventory_movements m ON m.variant_id = v.variant_id
WHERE p.tracks_inventory = 1
GROUP BY v.variant_id;

CREATE VIEW v_purchase_orders AS
SELECT
  po.*,
  CASE
    WHEN po.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN po.closed_at IS NOT NULL THEN 'closed'
    WHEN po.confirmed_at IS NOT NULL THEN 'confirmed'
    ELSE 'draft'
  END AS status
FROM purchase_orders po;

-- Ordered vs received per order line (FR-062).
CREATE VIEW v_purchase_order_receipts AS
SELECT
  poi.purchase_order_item_id,
  poi.purchase_order_id,
  poi.variant_id,
  poi.quantity_milli AS ordered_milli,
  coalesce((
    SELECT sum(gi.quantity_milli)
    FROM goods_receipt_purchase_orders l
    JOIN goods_receipts g ON g.goods_receipt_id = l.goods_receipt_id AND g.posted_at IS NOT NULL
    JOIN goods_receipt_items gi ON gi.goods_receipt_id = g.goods_receipt_id
    WHERE l.purchase_order_id = poi.purchase_order_id AND gi.variant_id = poi.variant_id
  ), 0) AS received_milli
FROM purchase_order_items poi;

-- ===========================================================================
-- Seed reference data
-- ===========================================================================

INSERT INTO currencies (currency_code, name, symbol, minor_units) VALUES
  ('INR', 'Indian rupee', '₹', 2),
  ('USD', 'US dollar', '$', 2),
  ('AED', 'UAE dirham', 'AED', 2),
  ('LKR', 'Sri Lankan rupee', 'Rs', 2),
  ('NPR', 'Nepalese rupee', 'Rs', 2),
  ('BDT', 'Bangladeshi taka', '৳', 2);

INSERT INTO business_types (business_type_code, name) VALUES
  ('grocery', 'Grocery / retail'),
  ('restaurant', 'Restaurant'),
  ('electronics', 'Electronics'),
  ('pharmacy', 'Pharmacy');

INSERT INTO modules (module_code, name) VALUES
  ('grocery', 'Grocery and retail'),
  ('restaurant', 'Restaurant'),
  ('electronics', 'Electronics'),
  ('pharmacy', 'Pharmacy');

INSERT INTO units (unit_code, name, allows_fraction) VALUES
  ('pcs', 'Pieces', 0),
  ('kg', 'Kilograms', 1),
  ('g', 'Grams', 0),
  ('l', 'Litres', 1),
  ('ml', 'Millilitres', 0),
  ('pack', 'Packs', 0),
  ('box', 'Boxes', 0),
  ('dozen', 'Dozens', 1);

INSERT INTO tax_components (tax_component_code, name) VALUES
  ('CGST', 'Central GST'),
  ('SGST', 'State GST'),
  ('IGST', 'Integrated GST'),
  ('CESS', 'Compensation cess');

INSERT INTO adjustment_reasons (adjustment_reason_code, name) VALUES
  ('opening_stock', 'Opening stock'),
  ('count_correction', 'Stock count correction'),
  ('damage', 'Damaged'),
  ('expiry', 'Expired'),
  ('theft_loss', 'Theft or loss'),
  ('other', 'Other');

INSERT INTO roles (role_code, name, is_system) VALUES
  ('administrator', 'Administrator', 1),
  ('manager', 'Manager', 1),
  ('cashier', 'Cashier', 1),
  ('inventory_operator', 'Inventory operator', 1);

INSERT INTO payment_methods (method_code, name, kind, sort_order) VALUES
  ('cash', 'Cash', 'cash', 1),
  ('upi', 'UPI', 'upi', 2);

INSERT INTO document_sequences (document_type, prefix) VALUES
  ('sale_invoice', 'INV'),
  ('sale_return', 'CN'),
  ('purchase_order', 'PO'),
  ('goods_receipt', 'GRN'),
  ('stock_adjustment', 'ADJ');

INSERT INTO expense_categories (name) VALUES
  ('Rent'), ('Electricity'), ('Salaries'), ('Transport'), ('Maintenance'), ('Other');
