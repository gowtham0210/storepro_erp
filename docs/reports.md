# Reports, dashboard and CSV export

How StorePro reports on sales, stock, purchases and expenses, and saves reports as files (PRD FR-090
to FR-096 in section 6.9; modules M19 and M22-03). **Manage → Reports** has seven tabs: Overview (the
dashboard), Sales, Top items, Stock, Stock movements, Purchases and Expenses.

## 1. What the figures mean (M19-02)

The definitions live in one place, `src/shared/reports.ts` (`REPORT_METRICS`), and the screens, the
CSV files and this page all use those words. **Gross sales, discounts, tax, refunds, net sales and
collections are separate lines and are never folded into one "total"** (FR-096).

| Figure        | Meaning                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------- |
| Bills         | Completed sales that were not voided, counted on the day they were billed                           |
| Gross sales   | Quantity × price for every item, before any discount. Tax is inside it when prices include tax      |
| Discounts     | Line discounts plus each line's share of any bill discount                                          |
| Tax           | GST or sales tax on those bills. Already inside the billed total, whichever way the store prices    |
| Round-off     | The adjustment that rounds each bill to the store's rounding step                                   |
| Billed total  | What customers were charged: gross − discounts, plus tax when prices exclude it, plus round-off     |
| Refunds       | What was paid back on returns taken in the period (goods and tax), counted on the day of the return |
| Net sales     | Billed total − refunds                                                                              |
| Collected     | Money received on those bills, by payment method                                                    |
| Paid back     | Refund money paid out on returns in the period, by payment method                                   |
| Net collected | Collected − paid back, by payment method                                                            |
| Voided        | Bills cancelled after billing; left out of everything above and shown on their own line             |
| Average bill  | Billed total ÷ bills, rounded half up to the minor unit                                             |

Rules that apply everywhere:

- **Finalised transactions only.** A sale counts once it is completed; held bills never do.
- **Reports show the current state.** A sale voided later disappears from the day it was billed on.
- **Reversals count on their own day.** A refund is counted on the day of the return, whenever the sale
  was made. So a past day's figures change only through voids. A period that holds a return but not its
  sale shows the refund against no bills, and a negative net.
- **The store's day.** A day is midnight to midnight in the store's time zone (**Settings**), including
  23 and 25 hour days when the clocks change. A bill at 23:59 and one at 00:01 are on different days even
  though they are a minute apart. Both ends of a period are included.
- **Exact money.** Every amount is an integer in minor units summed from stored amounts. The only thing
  rounded is the average bill.
- **Each invoice's own price basis.** If the store changed between prices that include tax and prices
  that exclude it, sales on either side keep their own basis.

## 2. The reports

All need `report.view` (administrators and managers). Pick a period with the **From** and **To** dates or
a quick period (Today, Yesterday, Last 7 days, This month, Last month). It is kept in the address, so a
reload or a tab change keeps it, and it starts as today at the store. A backwards period is refused on
screen without asking; a period is at most 731 days.

| Tab             | Shows                                                                                                                                               | Task   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Overview        | Net sales, bills, average bill, refunds; how the figures are made up, line by line, each with its definition; money by payment method; voided bills | M19-03 |
| Sales           | One row for every date in the period (quiet days show zeros) and a Total row                                                                        | M19-04 |
| Top items       | Items by net sales value or net quantity: sold − returned in the period, voided sales left out, items with no net sales left out                    | M19-05 |
| Stock           | Stock on hand **now** (no period), worth at cost, low and out-of-stock counts, items with no cost price flagged                                     | M19-06 |
| Stock movements | Every movement across all items in the period, with the document behind it                                                                          | M19-06 |
| Purchases       | Posted goods receipts by supplier and one by one. Drafts are not purchases                                                                          | M19-07 |
| Expenses        | By category and by how it was paid, by the date spent; voided expenses on their own line                                                            | M19-08 |

- **Stock value** is on hand × cost price, rounded like an invoice line. Only stock above zero and with
  a cost price is valued; negative stock is not.
- **Purchases** are valued at the cost entered on the receipt, before any GST input credit.
- **Top items:** quantities in different units (kg and pieces) aren't comparable, so rank by value to
  compare across them.
- **Expenses** carry a business date, not a time, so they are matched on that date as entered.

## 3. How the numbers are kept right (M19-09)

- One definition of every total: reports read the ledger views (`v_sale_totals`,
  `v_sale_return_totals`, `v_inventory_movements`, `v_stock_on_hand`), so a report can't add things up
  differently from an invoice.
- **Reconciliation tests** (`src/main/reports/reportService.test.ts`) check each figure against totals
  worked out separately from the invoices (`salesService.get`) and returns: gross, discounts, tax,
  round-off and billed total equal the sum of the invoices; collections equal billed; net collected
  equals net sales; the daily rows add up to the period total; and the store-day edges (23:59 and 00:01,
  the first and last instants of a day) and a 25-hour daylight-saving day land on the right dates.

## 4. CSV export (M22-03, FR-095)

Each tab has **Export CSV** for people who hold `data.export` (administrators and managers). It asks
where to save (the operating system's save dialog; nothing is written until a place is chosen, and
closing the dialog writes nothing and isn't an error).

- **It reconciles with the screen.** The file is built from the same report the screen shows (all of
  it, not just the page on screen), by `src/shared/reportCsv.ts`. The Total row of the sales file is the
  summary on screen; tests compare each file with its report and with the invoices.
- **Format.** UTF-8 with a byte-order mark so Excel keeps names and the rupee sign. Money is a plain
  decimal (`1249.00`, no symbol or grouping) and quantities have no trailing zeros, so spreadsheets read
  numbers. Times are the store's own.
- **Spreadsheet formula injection is blocked.** A text cell that starts with `=`, `+`, `-`, `@`, a tab or
  a carriage return (a product named `=HYPERLINK(...)`) is written with a leading apostrophe so it stays
  text. Real numbers, including negative amounts, are left as they are.
- **Files:** `sales_2026-10-19_to_2026-10-20.csv` (a single day: `sales_2026-10-19.csv`),
  `top-items_…`, `stock_<today>.csv`, `stock-movements_…`, `purchases_…`, `expenses_…`. The sales,
  purchases and expenses files hold more than one table, each with its own header and Total row,
  separated by a blank row.
- **Large exports.** Stock and movements include every row; an export of more than 500,000 rows is
  refused with a request to choose a shorter period.
- **Audit.** Every saved export records `report.exported` (the report, the period, the number of rows
  and the file name, not the folder). A write failure gives a plain message ("check the folder can be
  written to and that the file isn't open in another program").

## 5. Where things are

| What         | Where                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| Definitions  | `src/shared/reports.ts`                                                                 |
| Queries      | `src/main/reports/reportRepository.ts`                                                  |
| Service      | `src/main/reports/reportService.ts` (`exportReport` for CSV)                            |
| Validation   | `src/shared/schemas/reports.ts`                                                         |
| IPC channels | `reports:*` (`src/main/ipc/handlers/reports.ts`)                                        |
| CSV          | `src/shared/csv.ts`, `src/shared/reportCsv.ts`, `src/main/reports/electronFileSaver.ts` |
| Screens      | `src/renderer/src/pages/ReportsPage.tsx`, `reports/`                                    |

## 6. Not done yet

- **Profit and margin reports** (sales cost snapshots are stored, but cost accounting wasn't asked for).
- **Reports by cashier, category or customer**, and hourly sales.
- **A dashboard on the home screen.** It is the Reports page's first tab.
- **Printing reports.** Export to CSV and print from a spreadsheet.
- **Excel (.xlsx) and PDF export.**
- **CSV product import** (M22-01, M22-02) is in the backup-and-import workstream.
