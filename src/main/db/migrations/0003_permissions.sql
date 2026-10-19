-- M06: the permission catalogue and what each role may do (FR-011, FR-012).
--
-- The codes and descriptions match src/shared/permissions.ts exactly; a test
-- fails if they drift. The mapping is explicit and fixed in this version:
-- change it with a new migration, never by editing this one.
--
--   administrator       everything
--   manager             everything except changing settings, restoring a
--                       backup and importing data
--   cashier             billing, customers, and looking up products and stock
--   inventory_operator  products, stock, purchases and suppliers

INSERT INTO permissions (permission_code, description) VALUES
  ('sale.create', 'Bill customers at the counter'),
  ('sale.view', 'View past sales and invoices'),
  ('sale.reprint', 'Reprint invoices and receipts'),
  ('sale.void', 'Void a completed sale'),
  ('discount.apply', 'Give discounts within the store limit'),
  ('discount.override', 'Give discounts above the store limit'),
  ('price.override', 'Change an item''s price on a bill'),
  ('return.create', 'Take returns and give refunds'),
  ('customer.view', 'View customers'),
  ('customer.manage', 'Add and edit customers'),
  ('product.view', 'View products and prices'),
  ('product.manage', 'Add and edit products and prices'),
  ('inventory.view', 'View stock levels and movements'),
  ('stock.adjust', 'Adjust stock quantities'),
  ('purchase.view', 'View purchases'),
  ('purchase.manage', 'Record purchases and goods received'),
  ('supplier.view', 'View suppliers'),
  ('supplier.manage', 'Add and edit suppliers'),
  ('expense.view', 'View expenses'),
  ('expense.manage', 'Record expenses'),
  ('report.view', 'View reports and the dashboard'),
  ('user.manage', 'Add users, change their roles and reset passwords'),
  ('settings.view', 'View store settings'),
  ('settings.edit', 'Change store settings'),
  ('audit.view', 'View the audit log'),
  ('backup.create', 'Back up store data'),
  ('backup.restore', 'Restore store data from a backup'),
  ('data.export', 'Export data to files'),
  ('data.import', 'Import data from files');

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.role_id, p.permission_code
FROM roles r CROSS JOIN permissions p
WHERE r.role_code = 'administrator';

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.role_id, p.permission_code
FROM roles r CROSS JOIN permissions p
WHERE r.role_code = 'manager'
  AND p.permission_code NOT IN ('settings.edit', 'backup.restore', 'data.import');

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.role_id, v.column1
FROM roles r CROSS JOIN (VALUES
  ('sale.create'), ('sale.view'), ('discount.apply'),
  ('customer.view'), ('customer.manage'),
  ('product.view'), ('inventory.view')
) v
WHERE r.role_code = 'cashier';

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.role_id, v.column1
FROM roles r CROSS JOIN (VALUES
  ('product.view'), ('product.manage'), ('inventory.view'), ('stock.adjust'),
  ('purchase.view'), ('purchase.manage'), ('supplier.view'), ('supplier.manage')
) v
WHERE r.role_code = 'inventory_operator';
