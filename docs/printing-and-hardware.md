# Printing, Hardware & Grocery Extensions (M13, M21, M24)

How StorePro formats and prints receipts, detects hardware barcode scanners, communicates with thermal printers and cash drawers, and handles grocery variable-weight barcodes and shelf/pack price labels.

---

## 1. Receipt Template Engine & Thermal Layouts (`M13-02`, `M13-03`, `M13-05`)

`src/shared/receipt.ts` is a pure, dependency-free template engine shared by the main and renderer processes:

- **Paper widths (`RECEIPT_WIDTH_COLS`):**
  - **58 mm thermal roll:** `32` monospace character columns (`8.5 pt` font in HTML print view).
  - **80 mm thermal roll:** `48` monospace character columns (`9.5 pt` font in HTML print view).
- **Document sections (`buildReceiptDocument`):**
  1. **Store header:** uppercase store name, address lines, phone, email, `GSTIN` / `Tax ID`, and optional custom receipt header.
  2. **Status banners:**
     - `*** DUPLICATE / REPRINT ***` between `=` double rules whenever `isReprint === true` (`M13-05`, FR-043).
     - `*** VOIDED INVOICE ***` between `=` double rules whenever `sale.voidInfo !== null`.
  3. **Invoice metadata:** invoice number (`INV000001`), timestamp formatted in the store's IANA time zone (`formatStoreTime`), cashier name, and optional customer name.
  4. **Itemized lines:** description, optional `[HSN:xxxx]`, formatted quantity with unit (`1.25 kg`), unit rate, line discount if any, and line total.
  5. **Totals & tax summary:** item count and gross total, total discount, taxable amount, per-component tax breakdown (`CGST`, `SGST`, `CESS`, or `TAX` with `(incl.)` tag when tax-inclusive), round-off, and `TOTAL PAYABLE`.
  6. **Payments & change:** each recorded payment method, reference, UPI `Recorded (not verified)` notice (`M12-03`), cash tendered, change returned, and any linked return refunds (`M12-04`).
  7. **Receipt footer:** optional custom receipt footer from store settings.
- **HTML rendering (`renderReceiptHtml`):** produces a self-contained HTML document with `@page { size: 58mm auto }` or `@page { size: 80mm auto }` for crisp printing through Windows printer drivers.

---

## 2. Checkout Printing, Non-Fatal Failure & Reprints (`M13-04`, `M13-05`)

- **Post-checkout printing (`M13-04`):**
  - Checkout (`sales:checkout`) commits the sale atomically to SQLite *before* any print job is dispatched.
  - In `CompletedSaleDialog`, the cashier sees a collapsible receipt preview (`receipts:preview`) and a **Print receipt** button (`receipts:print`).
  - When **Automatically print receipt after checkout** (`autoPrintReceipt`) is enabled in **Manage → Settings**, the receipt is sent to the printer automatically as soon as the dialog opens.
  - If the printer is offline, unplugged, or errors out, the saved sale is **unaffected**: the dialog shows a warning banner (*"Sale is saved, but receipt printing failed"*) with a **Retry print** button.
- **Reprinting past invoices (`M13-05`):**
  - On **Sell → Sales**, opening an invoice shows a **Reprint receipt** button.
  - Calling `receipts:print` with `isReprint: true` requires the `sale.reprint` permission. Cashiers without `sale.reprint` are prompted for a one-time manager approval (`M06-05`).
  - Every reprint records a `sale.reprinted` entry in `audit_logs` (including `approved_by_user_id` when manager-approved) and prints the `*** DUPLICATE / REPRINT ***` banner.

---

## 3. Hardware Integration (`M21-01` to `M21-05`)

### 3.1 Keyboard-Wedge Barcode Scanner Detection (`M21-01`)

`ScannerBurstDetector` (`src/shared/scanner.ts`) distinguishes rapid hardware keyboard-wedge scanner bursts from human typing:

- **Inter-key threshold:** `maxInterKeyMs = 45` ms between consecutive printable ASCII characters (`0x20`–`0x7e`).
- **Total burst duration:** `maxTotalBurstMs = 600` ms across the entire scan.
- **Minimum length & terminators:** at least `minLength = 4` characters terminated by `Enter` or `Tab`.
- **Global POS capture (`BillingPage.tsx`):** while on the Billing screen with no modal dialog open, a window `keydown` listener feeds non-input keystrokes into `ScannerBurstDetector`. Even if focus is on a button or table row rather than the barcode input box, scanning an item immediately adds it to the bill.

### 3.2 Windows Printer Discovery, Silent Driver Printing & ESC/POS (`M21-02`, `M21-03`, `M21-04`)

- **Discovery (`printers:list`):** queries Electron's `webContents.getPrintersAsync()` (falling back to `System Default Printer` when no OS printers are installed).
- **Device-local settings (`PrinterRepository`):** stored in `app_settings` (`setting_key = 'printerconfig'`):
  - `printerName`: selected OS printer name or `null` (system default).
  - `paperWidthMm`: `58` or `80`.
  - `printMode`: `'driver'` (Windows GDI/XPS driver via silent hidden `BrowserWindow.webContents.print({ silent: true, deviceName })`) or `'escpos'` (raw ESC/POS byte stream).
  - `autoPrintReceipt`: boolean.
  - `openCashDrawer`: boolean.
- **ESC/POS encoder (`src/shared/escpos.ts`, `M21-04`):**
  - Generates standard ESC/POS command sequences: `ESC @` (`0x1b 0x40`) init, optional `ESC p 0 25 250` (`0x1b 0x70 0x00 0x19 0xfa`) RJ-11 cash-drawer kick pulse on cash sales, bold emphasis (`ESC E`) on store title/banners/total, ASCII-safe line conversion (`₹` → `Rs.`), line feeds, and `GS V 66 3` (`0x1d 0x56 0x42 0x03`) partial paper cut.
- **Settings UI (`PrintingSettings.tsx`, `M21-03`):** under **Manage → Settings → Receipt printer**, administrators can choose the printer, paper width, print mode, auto-print and cash-drawer options, and click **Test print** (`printers:test-print`).

### 3.3 Supported-Device Matrix (`M21-05`)

| Device Category | Supported Interface / Protocol | Tested / Reference Models | Paper / Format | Notes |
|---|---|---|---|---|
| **1D / 2D Barcode Scanners** | USB HID Keyboard Wedge (plug-and-play, no driver required) | Honeywell Voyager 1200g / 1470g, Zebra DS2208 / LS2208, TVS BS-i101G / BS-C101, Datalogic QuickScan QD2430 | EAN-13, EAN-8, UPC-A, Code-128, QR | Configure scanner suffix to `Enter` (`CR`) or `Tab`. Captured whether barcode input is focused or not (`M21-01`). |
| **80 mm Thermal Receipt Printers** | Windows Print Spooler (`driver` mode) or ESC/POS (`escpos` mode) over USB / Ethernet | Epson TM-T82 / TM-T88, TVS RP-3200 / RP-3230, Citizen CT-S310II, Rugtek RP80, Bixolon SRP-330II | 79.5 ± 0.5 mm roll (`48` columns) | Supports RJ-11 cash-drawer kick (`ESC p 0 25 250`) and auto-cutter (`GS V 66 3`). |
| **58 mm Thermal Receipt Printers** | Windows Print Spooler (`driver` mode) or ESC/POS (`escpos` mode) over USB | TVS RP-45 Shoppe, Epson TM-P20, Rugtek RP58, Xprinter XP-58IIH | 57.5 ± 0.5 mm roll (`32` columns) | Compact 32-column layout wraps long item descriptions cleanly. |
| **Cash Drawers** | RJ-11 / RJ-12 24V solenoid connected to receipt printer DK port | TVS Cash Drawer, Posiflex CR-4000, Rugtek CD-410 | Pulse via thermal printer | Triggered on cash sales when `openCashDrawer` and `escpos` mode are enabled. |
| **Barcode Label Printers (Grocery)** | Windows Print Spooler (`driver` mode) | TSC TE244 / TTP-244 Pro, Zebra ZD220 / ZD230, TVS LP-46 Neo | 50 mm × 30 mm die-cut thermal labels | Prints Code-128B vector SVG barcodes, MRP, selling price, and optional packed date (`M24-03`). |
| **Label-Printing Weighing Scales** | Offline EAN-13 barcode label (`M24-02`) | Essae DS-215 / Teraoka, Sansui, Phoenix, CAS CL-5200 | 13-digit EAN-13 (`20`/`21` prefix) | Scale prints weight-embedded (`20`) or price-embedded (`21`) EAN-13 labels scanned at POS. Direct serial/USB live weight streaming (`M24-04`) is deferred pending PRD §15 hardware decision. |

---

## 4. Grocery / Retail Extensions (`M24-01`, `M24-02`, `M24-03`)

1. **Fractional quantities (`M24-01`):** units marked `allowsFraction = true` (`kg`, `g`, `l`, `ml`) accept up to 3 decimal places (`0.001` precision stored in integer milli-units).
2. **Variable-weight & embedded-price EAN-13 scale barcodes (`M24-02`):**
   - Format: `PP IIIII VVVVV C` (13 digits with valid EAN-13 modulo-10 check digit `C`).
   - Configurable 2-digit prefixes under **Manage → Settings → Scale barcodes (Grocery)** (`grocery:get-weigh-barcode`, `grocery:set-weigh-barcode`):
     - **Weight prefix (default `20`):** `IIIII` resolves the product variant (by 5-digit code, `ITEM-00007` SKU, or variant ID for fractional items) and `VVVVV` is the weight in grams / milli-units (e.g. `01250` → `1.25 kg`).
     - **Price prefix (default `21`):** `VVVVV` is the total price in minor units / paise; StorePro divides by the variant's `sellingPriceMinor` to populate `scannedQuantityMilli` automatically.
3. **Shelf & pre-pack price/barcode label printing (`M24-03`):**
   - `src/shared/label.ts` generates a deterministic Code-128B SVG barcode (`renderCode128Svg`) and print-ready `50 mm × 30 mm` HTML labels (`buildPriceLabel`) for `1..50` copies.
   - Available from **Stock → Products → Pack sizes → Print label** (`PrintLabelDialog.tsx`) whenever the `grocery` module is enabled.
