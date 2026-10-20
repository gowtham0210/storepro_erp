# Billing and payments

How StorePro handles Point of Sale (POS) billing, payment recording, held bills, and sale voiding
(PRD FR-020 to FR-038; modules M11, M12, M13-01, M24-01).

## 1. Payment rules and methods (M12-01 to M12-04)

`src/shared/payments.ts` and `PaymentService` (`src/main/payments/paymentService.ts`) govern how
payments are configured and recorded:

- **Payment methods (`M12-01`):** Seeded with **Cash** (`cash`), **UPI** (`upi`) and **Card**
  (`card`), and extensible (`payments:create-method`, `payments:update-method`,
  `payments:set-method-active`). At least one payment method must remain active at all times.
- **Cash tendering and change (`M12-02`):** `planCashTender(amountDueMinor, tenderedMinor)`
  computes change due (`tenderedMinor − amountDueMinor`) in integer minor units and rejects
  under-tendered cash payments.
- **UPI reference recording (`M12-03`, FR-035):** UPI payments accept an optional transaction
  reference and are explicitly labelled **`Recorded (not verified)`** (`UPI_RECORDED_NOTICE`) on
  both the payment dialog and completed invoices so cashiers know StorePro does not verify bank
  settlement.
- **Split payments:** A bill's payable total can be split across any combination of active payment
  methods, provided the sum of payment allocations equals `payableMinor`.
- **Return refund records (`M12-04`):** `PaymentRepository.listSaleRefunds()` and
  `SalesRepository.findById()` surface linked `return_refunds` records alongside original sale
  payments on every invoice.

## 2. Cart model and live pricing (M11-01, M11-05, M24-01)

`src/renderer/src/sales/cart.ts` maintains the POS cart in the renderer and prices it with the
shared `calculateBill()` engine (`src/shared/pricing.ts`):

- **Lines and quantities:** Scanning or selecting an already-present item increments its quantity by
  one unit (`1000` milli-units), preserving any line discount or custom price. Weight and volume
  items (`allowsFraction = true`, e.g. `kg`, `L`) accept decimal quantities down to `0.001`
  (`M24-01`).
- **Line and bill discounts:** Each line and the overall bill can carry a percentage (basis points)
  or flat minor-unit discount.
- **Permission detection:** `priceCart()` flags whether any line overrides the catalogue price
  (`requiresPriceOverride`) or whether any line/bill discount exceeds the store's cashier discount
  threshold (`requiresDiscountOverride`), prompting for a one-time manager approval (`M06-05`) at
  checkout when needed.

## 3. Atomic checkout and invoice sequence (M11-07, M11-08, M11-13, M13-01)

`SalesService.checkout()` (`sales:checkout`) executes inside a single `db.transaction()`:

1. **Idempotency (`M11-08`):** Every cart carries a unique `checkoutKey`. If `sales.checkout_key`
   already exists (from a retry or double-click), `checkout()` returns the existing `SaleDetail`
   without duplicating the sale or deducting stock twice.
2. **Catalogue & MRP checks:** Verifies every variant exists, is active, obeys its unit's fraction
   rule, and does not exceed its MRP (when set).
3. **Pricing & authorization:** Runs `calculateBill()` and `PricingService.authorizeBill(actor, …)`.
   When a manager override token (`overrideId`) is supplied on `sales:checkout`, `AuthService`
   attaches the approved secondary permission (`discount.override` or `price.override`) and records
   `approved_by_user_id` in the audit log.
4. **Stock check:** Calls `InventoryService.assertOutflowAllowed()` so negative-stock rules are
   enforced before writing.
5. **Sequential invoice number (`M13-01`):** Allocates the next `INV000001`-style invoice number
   from `document_sequences` inside the transaction, so rolled-back checkouts never leave gaps.
6. **Immutable snapshot:** Inserts `sales`, `sale_items` (with catalogue cost snapshot),
   `sale_item_taxes` (`CGST`/`SGST`/`CESS` or `SALES_TAX`), and `sale_payments`, deletes any
   resumed `held_bills` draft, and writes `sale.created` to the append-only audit log.
7. **Performance (`M11-13`):** A 10-line checkout against a 10,000-product catalogue completes well
   under the 500 ms budget (`src/main/sales/salesService.test.ts`).

## 4. Held bills and sale voiding (M11-09, M11-10, M11-12)

- **Held bills (`M11-09`):** Cashiers can park an unfinished bill (`sales:hold`, `F9`) with an
  optional reference label, list held bills (`sales:list-held`, `F8`), resume a held bill back into
  the cart (`sales:resume-held`), or discard it (`sales:discard-held`).
- **A resumed bill stays held until it is finished.** The cart lives only in the window, so
  resuming does not delete the held bill: a crash or power cut before Pay loses nothing. The bill
  is deleted by the checkout that completes it (`heldBillId`, in the same transaction as the
  sale), replaced when the cart is held again (`replacesHeldBillId`, in the same transaction as
  the new hold), or discarded by hand. While it is on the counter, Held bills marks it "On the
  counter now" and it can't be resumed a second time. Cancelling the bill (`F2`) clears the
  counter and leaves it in Held bills.
- **Cancel vs. void (`M11-10`):**
  - Clearing an unfinished cart (`F2`) only resets in-memory cart state after confirmation.
  - Voiding a completed sale (`sales:void`) requires `sale.void` (or a manager override for a
    cashier) and a mandatory reason, inserts an append-only `sale_voids` reversal record (which
    automatically restores stock via `v_inventory_movements`), and logs `sale.voided` in the audit
    log.
- **Sales screen (`M11-12`):** **Sell → Sales** lists completed and voided invoices with search by
  invoice number, customer or cashier, status filter, full invoice breakdown (lines, tax summary,
  payment records, return refunds), and the void workflow.
