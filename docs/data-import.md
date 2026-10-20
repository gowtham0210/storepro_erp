# CSV product import

How StorePro imports products from CSV files with row-by-row validation and atomic batch commit
(PRD FR-026; modules M22-01, M22-02).

## 1. Principles

- **Preview before commit.** Uploading or pasting a CSV never writes to the database directly.
  Every row is parsed, mapped, and validated against the store's catalogue rules first, and the
  operator sees the full row-by-row preview (`import:products-preview`).
- **No silent row drops.** If even one row has a validation error, StorePro refuses to commit the
  batch (`import:products-commit`). The operator can either fix the CSV and re-validate or download
  the error report CSV (`storepro-import-errors.csv`) listing every failing row number and field
  error.
- **All-or-nothing transaction.** When all rows are valid, `ProductImportService.commit()` creates
  new categories, products, pack-size variants, SKUs, and barcodes inside a single `db.transaction()`
  and writes one `data.products_imported` entry to `audit_logs`.
- **Permission-guarded.** Only roles with `data.import` (Administrator by default) can download the
  template, preview, or commit a CSV product import.

## 2. CSV columns and template (`M22-01`)

Clicking **Download CSV template** in **Stock → Products → Import CSV** downloads
`storepro-products-template.csv` with sample rows and the following columns:

| Header             | Required | Description & validation rules                                                                                  |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------- |
| `product_name`     | Yes      | 1–200 characters. Rows with the same `product_name` (case-insensitive) are grouped as pack sizes of one product |
| `variant_name`     | No       | Pack size name (e.g. `5 kg`, `500 ml`). Leave blank for single-variant products                                 |
| `sku`              | No       | Letters, digits, `-`, `_`, `.`, `/` (max 64 chars). Auto-assigned as `ITEM-00001` if left blank                 |
| `barcode`          | No       | 4–64 characters (`A-Z0-9._-`). Multiple barcodes in one cell may be separated by spaces, commas, or semicolons  |
| `category`         | No       | Category name (max 100 chars). Existing active categories are matched case-insensitively; new ones are created  |
| `unit_code`        | Yes      | Must match an existing unit code or unit name (`pcs`, `kg`, `g`, `l`, `ml`, `pack`, `box`, `dozen`, `bag`)      |
| `selling_price`    | Yes      | Selling price in store currency (e.g. `320.00`), parsed into integer minor units                                |
| `mrp`              | No       | Maximum retail price (`>= selling_price`)                                                                       |
| `cost_price`       | No       | Standard purchase cost per unit                                                                                 |
| `tax_class`        | No       | Active tax class name (`GST 5%`) or rate (`5%`, `5`). Defaults to the lowest active tax rate if left blank      |
| `hsn_code`         | No       | 4, 6, or 8 digits                                                                                               |
| `reorder_level`    | No       | Low-stock threshold in the item's unit. Fractional values are rejected if the unit does not allow fractions     |
| `tracks_inventory` | No       | `yes` / `no` (`true` / `false`, `1` / `0`). Defaults to `yes`                                                   |

## 3. Header auto-detection and custom column mapping

`resolveCsvColumnMapping()` (`src/shared/csv.ts`) automatically matches common column header aliases
(for example `item_name` → `productName`, `rate` / `price` → `sellingPrice`, `uom` / `unit` →
`unitCode`, `gst` → `taxClass`). If a spreadsheet uses non-standard column headers, the operator
can expand **Column mapping** in the import dialog to map each StorePro field to any detected CSV
column header and re-run validation immediately.

## 4. Validation rules (`M22-02`)

`ProductImportService` checks every row for:
1. Required fields (`product_name`, `unit_code`, `selling_price`) and field length/character rules.
2. Price rules: valid currency decimal places, non-negative bounds, and `selling_price <= mrp`.
3. Unit rules: unit exists in `units`, and `reorder_level` obeys `unit.allowsFraction`.
4. Tax & HSN rules: `tax_class` matches an active tax class, and `hsn_code` is 4, 6, or 8 digits.
5. Uniqueness against existing store data: `sku` and every `barcode` are checked against
   `ProductRepository.skuOwner()` and `ProductRepository.barcodeOwner()`.
6. Uniqueness within the CSV batch itself: duplicate SKUs or barcodes across two rows in the same
   file report the exact conflicting row number.
7. Multi-variant consistency: when multiple rows share the same `product_name`, they must have
   distinct `variant_name` values and agree on product-level fields (`category`, `tax_class`,
   `hsn_code`).
