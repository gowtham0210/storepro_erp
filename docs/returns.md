# Returns and refunds

How StorePro takes goods back and gives money back (PRD FR-070 to FR-074, section 6.7; module M16). A return
is made against one invoice and never changes it.

## 1. Taking a return

**Sell → Sales → Returns → Take a return**, or **Return items** on an invoice's detail.

1. **Find the invoice** by number (any case). The screen shows what was sold, what has already come
   back, and what can still come back. A voided invoice can't be returned.
2. **Choose what is coming back.** For each line, enter the quantity (whole numbers for pieces,
   fractions for kilograms and litres) and what happens to **the goods**:

   | Choice                    | Effect on stock                        |
   | ------------------------- | -------------------------------------- |
   | Back into stock (default) | Added back to stock through the ledger |
   | Set aside (quarantine)    | No stock effect                        |
   | Write off                 | No stock effect                        |

   **Split** adds a second row for the same line, for when part of it is resalable and part isn't
   (one bag restocked, one written off).

3. **See what is due.** The credit appears per line and the refund due in total as you type.
4. **Record the refund.** By default the whole amount goes back the way the customer paid. **Refund
   part another way** splits it across methods (a UPI refund takes an optional reference, recorded
   and not verified, like UPI payments). **The refunds must add up to exactly what is due.**
5. **Record return and refund.** The return, its lines, the tax credited and the refunds are saved
   in one transaction, with the audit entry. If any part fails, none is kept.

Returns are numbered `CN000001`, `CN000002`, … (`document_sequences`).

## 2. What a return is worth

A return credits a share of **what the customer actually paid** for the line, after its own
discount and its share of any bill discount, not the shelf price. Tax is credited the same way,
component by component (CGST, SGST, …). The calculation is one pure function,
`quoteReturn` in `src/shared/returns.ts`, used by the service to decide and by the screen to show,
so they cannot disagree.

- **Prices include tax:** the refund is the credit.
- **Prices exclude tax:** the refund is the credit plus its tax.
- **Exact to the paisa.** Shares use cumulative rounding: the credit for the Nth unit is
  `round(net × returned-so-far ÷ sold)` minus what was credited before. However a line comes
  back (all at once, in parts, split across dispositions) the credits add up to exactly what was
  paid when the last unit is back.
- The sale's bill-level **round-off isn't refunded**.

## 3. Rules that keep it honest

- **Never more than was sold.** Quantities already returned count, across all returns on the
  invoice, and the lines of one request count together. A database trigger enforces the same rule
  (FR-071) so nothing can bypass it.
- **The original sale is never changed.** The invoice detail shows its refunds as a separate list.
- **Invoices with returns can't be voided** (void, then return, would put the goods back twice).
- **Idempotence.** The same item and goods choice entered twice in one request is added together,
  not rejected.
- **Stock.** Only goods marked "back into stock" appear in the ledger (`sale_return` movements,
  numbered with the return). `verifyLedgerConsistency` and the integrity check still pass.

## 4. Who may do it (M16-06)

Taking a return needs **`return.create`**. Administrators and managers hold it; **cashiers don't**,
so when a cashier records a return the screen asks for a **manager's approval** (the approver's own
username and password, single-use, two minutes, as for voids). The audit entry records who took the
return and who approved it.

Looking an invoice up, listing returns and reading one need only `sale.view`.

## 5. Return receipt (M16-05)

The receipt (a credit note) is built by the same engine as invoice receipts
(`src/shared/returnReceipt.ts`): store header, return and invoice numbers, handled by, customer,
each line and its credit, the tax credited, **TOTAL REFUND**, how it was refunded, and the reason.
It fits 58 mm and 80 mm paper, prints through the driver or ESC/POS, and opens the cash drawer for a
**cash** refund when that is switched on (ESC/POS mode, as for sales).

- Straight after a return, **Print receipt** prints the original (and prints automatically if
  _Automatically print receipt_ is on in **Settings → Receipt printer**).
- Every later print is a **Reprint**: marked `*** DUPLICATE / REPRINT ***`, needs `sale.reprint`
  (a manager can approve it) and is audited (`return.reprinted`).
- **A failed print never affects the saved return.** The screen says so and offers to try again.

## 6. Audit

`return.created` (return and invoice numbers, each item with quantity, what happened to the goods
and the credit, the refund due, how it was refunded, the reason) and `return.reprinted`, in the
transaction of the change. See `docs/audit-log.md`.

## 7. Where things are

| What         | Where                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Calculation  | `src/shared/returns.ts`                                                          |
| Rules        | `src/main/returns/returnService.ts`; SQL in `returnRepository.ts`                |
| Validation   | `src/shared/schemas/returns.ts`                                                  |
| IPC channels | `returns:*` (`src/main/ipc/handlers/returns.ts`)                                 |
| Screens      | `src/renderer/src/returns/` (new return, list, detail), plugged into `SalesPage` |
| Receipt      | `src/shared/returnReceipt.ts`; `PrintingService.printDocument`                   |
| Tables       | `sale_returns`, `sale_return_items`, `sale_return_item_taxes`, `return_refunds`  |

## 8. Not done yet

- **Exchanges** (a return and a new sale in one step): take the return, then bill the new item.
- **A return window or policy** (for example, no returns after 30 days).
- **Returns without an invoice.**
- **Refund to store credit** (customer credit is P1).
- **Returns reports** (M19).
