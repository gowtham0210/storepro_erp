-- M09: product catalogue (FR-020 to FR-026).
--
-- The catalogue tables come from 0001. This adds what the catalogue screens
-- need on top:
--
--  * tax_classes.cess_rate_bp: a cess charged on top of GST for some goods
--    (tobacco, aerated drinks). Like the GST rate it belongs to the class, not
--    to each product. 0 for almost everything.
--  * Default tax classes for a store set up before this version. New stores
--    get them from setup (TaxClassRepository.seedDefaults), with the same
--    names and rates as src/shared/tax.ts. The Indian rates are provisional
--    until the GST rules are confirmed (M10-07, docs/pricing-and-tax.md).
--  * An index for listing products by name.

ALTER TABLE tax_classes ADD COLUMN cess_rate_bp INTEGER NOT NULL DEFAULT 0
  CHECK (cess_rate_bp BETWEEN 0 AND 10000);

CREATE INDEX products_name ON products (name COLLATE NOCASE);

-- An Indian store set up before this version: the GST slabs in force since
-- 22 September 2025 (GST 2.0).
INSERT INTO tax_classes (name, rate_bp, created_at, updated_at)
SELECT d.name, d.rate_bp, b.created_at, b.created_at
FROM (
  SELECT 1 AS position, 'GST 0% (exempt)' AS name, 0 AS rate_bp
  UNION ALL SELECT 2, 'GST 5%', 500
  UNION ALL SELECT 3, 'GST 18%', 1800
  UNION ALL SELECT 4, 'GST 40%', 4000
) d
JOIN businesses b ON b.business_id = 1 AND b.country_code = 'IN'
WHERE NOT EXISTS (SELECT 1 FROM tax_classes)
ORDER BY d.position;

-- Any other store set up before this version: one class without tax, so
-- products can be added; the administrator adds the local rates.
INSERT INTO tax_classes (name, rate_bp, created_at, updated_at)
SELECT 'No tax', 0, b.created_at, b.created_at
FROM businesses b
WHERE b.business_id = 1 AND b.country_code <> 'IN'
  AND NOT EXISTS (SELECT 1 FROM tax_classes);
