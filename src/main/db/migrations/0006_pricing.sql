-- M10: pricing, discounts and tax (FR-033, FR-034).
--
--  * businesses.bill_rounding_minor: the payable amount is rounded to a
--    multiple of this (1 = not rounded; 100 = nearest rupee). The round-off
--    of each sale is stored on the sale (sales.round_off_minor), so changing
--    this never changes past bills. Matches ROUNDING_STEPS in
--    src/shared/pricing.ts.
--  * businesses.max_discount_bp: the most discount a cashier may give on a
--    bill, as a share of its gross amount, without `discount.override` or a
--    manager's approval (M10-05). 10% to start with.
--  * tax_components 'TAX': the single sales tax (VAT) of a store outside
--    India. Indian stores use CGST + SGST (+ CESS).
--
-- GST rules are provisional (M10-07): see docs/pricing-and-tax.md.

ALTER TABLE businesses ADD COLUMN bill_rounding_minor INTEGER NOT NULL DEFAULT 1
  CHECK (bill_rounding_minor IN (1, 5, 10, 50, 100, 500, 1000));

ALTER TABLE businesses ADD COLUMN max_discount_bp INTEGER NOT NULL DEFAULT 1000
  CHECK (max_discount_bp BETWEEN 0 AND 10000);

INSERT INTO tax_components (tax_component_code, name) VALUES ('TAX', 'Sales tax');
