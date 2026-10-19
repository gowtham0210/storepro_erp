# Pricing, discounts and tax

How StorePro calculates line amounts, discounts, taxes, round-off and the amount payable on a bill,
and who may give discounts or override prices (PRD FR-025, FR-033, FR-034; module M10).

## 1. Tax configuration (M10-01)

Every product belongs to a **tax class** (`tax_classes`): a name, a rate in basis points (`rate_bp`,
where `1800` = 18%) and an optional cess (`cess_rate_bp`).

How tax is charged on a bill (`TaxRegime` in `src/shared/pricing.ts`) comes from the store's country
and whether it is registered for tax (`businesses.tax_registration_number`):

| Regime   | When                                 | Components on each taxed line                         |
| -------- | ------------------------------------ | ----------------------------------------------------- |
| `gst`    | India (`IN`), registered (has GSTIN) | `CGST` and `SGST`, each at half `rateBp`, plus `CESS` |
| `single` | Outside India, registered            | `TAX` at `rateBp`, plus `CESS`                        |
| `none`   | Not registered (`null` tax number)   | None — products keep their tax class for when needed  |

- **Inclusive vs exclusive (`businesses.prices_include_tax`).** Retail stores in India normally sell
  at MRP-style prices that already include GST (`true` by default). Stores that quote pre-tax prices
  switch this off in **Settings → Tax**.
- **Managing tax rates.** Administrators add, edit, archive and restore tax classes under **Settings
  → Tax rates**. At least one active tax class must remain so new products always have a rate to
  choose from. In India, `rateBp` must be even so CGST and SGST split into equal basis points.
- **Snapshots.** Changing a tax class's rate or the store's tax settings affects new bills only.
  Completed sales keep `sales.prices_include_tax`, `sales.round_off_minor` and the rows in
  `sale_item_taxes` that were recorded at checkout.

## 2. Line and bill arithmetic (M10-02, M10-03, M10-04)

`calculateBill(input, rules)` in `src/shared/pricing.ts` is a pure function with no I/O, shared by
the renderer (live cart totals) and the main process (checkout recomputation in M11). All money is
integer minor units (paise) and quantities are integer thousandths (`quantityMilli`).

For each line $i$:

1. **Gross amount:** $\text{gross}_i = \text{round}(\text{unitPrice}_i \times \text{quantityMilli}_i / 1000)$,
   rounded half away from zero (`multiplyByQuantity`).
2. **Line discount:** either a fixed amount ($\le \text{gross}_i$) or a basis-point percentage of
   $\text{gross}_i$ (`applyRate`), giving $\text{afterLine}_i = \text{gross}_i - \text{lineDiscount}_i$.
3. **Bill discount allocation (M10-03):** a bill-level discount (amount or percentage of
   $\sum \text{afterLine}_i$) is distributed across lines in proportion to $\text{afterLine}_i$ using
   largest-remainder allocation (`allocate`), so the shares add up to the bill discount to the last
   paisa. On every line, $\text{discount}_i = \text{lineDiscount}_i + \text{billDiscount}_i$ (stored
   in `sale_items.discount_minor`) and $\text{net}_i = \text{gross}_i - \text{discount}_i$.
4. **Tax per line:**
   - **Tax-exclusive:** $\text{taxable}_i = \text{net}_i$. Each component $c$ is
     $\text{applyRate}(\text{taxable}_i, \text{rate}_c)$, and
     $\text{total}_i = \text{taxable}_i + \sum_c \text{tax}_{i,c}$.
   - **Tax-inclusive:** let $R = \sum_c \text{rate}_c$. The base before tax is estimated as
     $\text{net}_i - \text{taxIncludedIn}(\text{net}_i, R)$, each component is taxed on that base so
     equal rates (CGST and SGST) always produce equal paise, and
     $\text{taxable}_i = \text{net}_i - \sum_c \text{tax}_{i,c}$ absorbs any rounding paisa so
     $\text{taxable}_i + \text{tax}_i = \text{net}_i = \text{total}_i$ holds on every line.
5. **Bill totals and rounding (M10-04):**
   - $\text{subtotal} = \sum_i \text{total}_i$.
   - $\text{payable} = \text{roundToStep}(\text{subtotal}, \text{roundingMinor})$, where
     `roundingMinor` is one of `1, 5, 10, 50, 100, 500, 1000` minor units (`1` = no rounding,
     `100` = nearest ₹1.00).
   - $\text{roundOff} = \text{payable} - \text{subtotal}$ (stored on `sales.round_off_minor`).
   - `taxSummary` groups tax amounts and taxable values by `(code, rateBp)` for the receipt's tax
     table.

A property test in `src/main/pricing/pricingService.test.ts` inserts 60 randomized bills calculated
by `calculateBill` into SQLite and verifies that `v_sale_totals` reads back the exact same
`gross_minor`, `discount_minor`, `taxable_minor`, `tax_minor` and `grand_total_minor`.

## 3. Discount limits and price overrides (M10-05)

- **Store discount limit (`businesses.max_discount_bp`).** Defaults to `1000` (10% of the bill's
  gross amount). Administrators configure it under **Settings → Rounding and discounts**.
- **`PricingService.authorizeBill(actor, lines, bill)`** checks:
  1. If any line's `unitPriceMinor` differs from its catalogue price, the actor must have
     `price.override` (or a one-time manager approval for `price.override`).
  2. If the bill has any discount (`discountMinor > 0`), the actor must have `discount.apply`.
  3. If `discountMinor / grossMinor` exceeds `maxDiscountBp` (`discountExceedsLimit`), the actor
     must have `discount.override` (or a one-time manager approval for `discount.override`).

## 4. Provisional GST rules and open items (M10-07)

The following rules are implemented as defaults for Indian grocery/retail stores and marked
**provisional** pending review by a GST practitioner (PRD §15):

1. **Default slabs (`src/shared/tax.ts`).** Setup seeds `GST 0% (exempt)`, `GST 5%`, `GST 18%` and
   `GST 40%` (the GST 2.0 slabs from September 2025), with cess at 0%. Stores can edit or add classes
   (e.g. aerated drinks or tobacco with compensation cess) in **Settings → Tax rates**.
2. **Intra-state retail supply.** Counter sales are treated as intra-state B2C supplies split equally
   into `CGST` and `SGST`. Inter-state `IGST` (for B2B invoices with a buyer GSTIN outside the
   store's state) is supported by the schema (`tax_components` includes `IGST`) and `TaxComponentCode`,
   and is deferred until B2B GST invoicing is scoped.
3. **Discounts before tax.** Both line and bill-level discounts reduce the consideration before GST
   is computed (CGST Act s. 15(3)(a): discount shown on the invoice itself).
4. **Cess base.** Compensation cess (`CESS`) is computed on the same taxable value as CGST and SGST,
   never compounded on top of GST.
