# Product catalogue

What the store sells, at what price, under which barcodes (PRD FR-020 to FR-026; module M09).

## 1. Model

| Thing     | What it is                                                                      | Table              |
| --------- | ------------------------------------------------------------------------------- | ------------------ |
| Product   | What every pack size shares: name, category, tax rate, HSN code, tracks stock   | `products`         |
| Pack size | What is priced, scanned, sold and counted (a _variant_, the SKU): unit, prices  | `product_variants` |
| Barcode   | A code that identifies one pack size. A pack size may have several (FR-022)     | `barcodes`         |
| Category  | A group for searching and reports                                               | `categories`       |
| Unit      | How quantities are measured. kg, L and dozens allow fractions; pcs, g, mL don't | `units`            |
| Tax rate  | A tax class: GST rate plus an optional cess (see `pricing-and-tax.md`)          | `tax_classes`      |

A product has at least one pack size. One may be left unnamed ("Neem Soap"); the others need
names that differ ("Toor Dal 500 g", "Toor Dal 1 kg"). Bills print the product name followed by the
pack size.

## 2. Rules

| Rule                                                                                       | Where                            |
| ------------------------------------------------------------------------------------------ | -------------------------------- |
| One barcode, one item. The error names the item that has it (FR-022)                       | `barcodes` primary key, service  |
| SKUs are unique, ignoring case. Left empty, StorePro assigns `ITEM-00042`                  | `UNIQUE COLLATE NOCASE`, service |
| Selling price ≤ MRP; prices 0 to ₹1 crore; no floats                                       | `CHECK`, shared schema           |
| HSN code: 4, 6 or 8 digits                                                                 | `CHECK`, shared schema           |
| Low-stock level in whole numbers for units without fractions                               | service, form                    |
| A pack size's unit can't change once it has been sold, bought, ordered, held or adjusted   | service                          |
| Archived categories and tax rates can't be chosen for a product (they stay where they are) | service                          |
| The last pack size on sale can't be archived: archive the product instead                  | service                          |

Products and pack sizes are **archived, never deleted** (M09-08). Archived items can't be found by
barcode or search for billing, but their sales, purchases and stock history stay, and they can be
restored. Restoring checks that their SKU and barcodes are still free.

## 3. Prices (M09-09)

Prices change by editing a pack size (`product.manage`: administrators, managers, inventory
operators). A change applies to the next bill; bills already made keep the price they were sold at
(`sale_items.unit_price_minor` is a snapshot). Each change is audited as `product.price_changed`
with the amounts before and after, separately from other edits (`product.updated`).

## 4. Finding items (M09-07)

| Channel                    | Use                                                         | How                                |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| `products:find-by-barcode` | A scanner: exact barcode, then exact SKU. Active items only | Primary-key lookup                 |
| `products:search`          | Typing a name, SKU or barcode. Best match first             | FTS5 prefix match, `ORDER BY rank` |
| `products:list`            | The Products screen: search, category, status, pages of 50  | FTS5 filter, sorted by name        |

Every word typed matches as a prefix ("toor da" finds Toor Dal). Raw text never reaches FTS
`MATCH` (`buildPrefixMatchQuery`). Performance at 10,000 products is in `data-model.md` §9.

Cashiers have `product.view`, so billing (M11) can use the lookups; only `product.manage` changes
anything.

## 5. Screens

**Stock → Products** lists every pack size with its price, MRP, barcode and stock, newest search
first in the address (`?q=…&category=…&status=…&page=…`) so Back works.

- **Add product**: the product and its first pack size in one form.
- Clicking an item opens its product: details, its pack sizes with **Edit**, **Archive** and **Add
  pack size**, **History** (the audit log for the product) and **Archive product**. Without
  `product.manage` it is read-only.
- **Categories** and **Units** manage the reference lists. Unit codes and their fraction rule are
  fixed once created; only the name changes.

## 6. Not done yet

- CSV import (FR-026) comes with M22.
- Variable-weight barcodes and price labels come with the grocery module (M24).
- Product images and supplier item codes are not stored.
