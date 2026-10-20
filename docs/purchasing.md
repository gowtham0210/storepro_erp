# Suppliers and purchases

How StorePro records who you buy from, what you order, and what arrives (PRD FR-060 to FR-063; module M15). Posting goods received is the only thing that adds purchased stock.

## 1. Suppliers (M15-01)

**Stock → Suppliers** lists the people and companies you buy from: name, contact person, phone,
email, address and GSTIN or tax number. Only the name is required, and it is unique ignoring case.

- A supplier is **archived**, never deleted, so past orders and receipts keep their supplier.
  Archived suppliers are hidden by default (Show → Archived suppliers) and can't be chosen on new
  orders or receipts. Restore one to use it again.
- Anyone with `supplier.view` can see the list; `supplier.manage` adds, edits and archives.
- Every change is audited, with the fields that changed (`supplier.updated`).

## 2. Documents

**Stock → Purchases** has two lists: **Purchase orders** and **Goods received**. Each can be
searched, filtered by supplier and status, and opened for its detail.

| Document            | Number      | States                                  | Effect on stock                |
| ------------------- | ----------- | --------------------------------------- | ------------------------------ |
| Purchase order (PO) | `PO000001`  | draft → confirmed → closed or cancelled | None, ever                     |
| Goods receipt (GRN) | `GRN000001` | draft → posted                          | Adds its quantities on posting |

Numbers come from `document_sequences`. They are allocated when a draft is first saved, so
deleting a draft leaves a gap; the sequence only has to be unique.

### Purchase orders (M15-02)

- A **draft** can be edited (supplier, note, items) or deleted. It is a working copy.
- **Confirm** fixes it: its items and costs can no longer change (the database refuses it too).
  Use **Save and confirm** to do both at once.
- A confirmed order can take goods, be **closed** (the supplier won't send the rest) or
  **cancelled**. Cancelling is refused once any goods have arrived against it: close it instead.
- Closing or cancelling is refused while a draft receipt is waiting on the order. Post or delete
  the draft first.
- When the last outstanding line is fully received, the order **closes itself** and the audit log
  says which receipt did it.

### Goods receipts (M15-03, M15-04)

A receipt records what actually arrived and what was paid. It is either:

- **against an order**, started with **Receive goods** on a confirmed order, prefilled with what is
  still outstanding at the order's cost; or
- a **direct purchase** (**Receive without order**), for goods you didn't order through StorePro.

Saved as a **draft**, it changes nothing and can be edited or deleted. **Post and add to stock** is
the one action that adds stock, and it asks first because a posted receipt is permanent: it can't be
edited or deleted, and a mistake is corrected with a stock adjustment (`docs/inventory.md` §3).

- **Posting is one transaction.** The receipt is frozen, any cost updates are applied, a fully
  received order closes, and the audit entry is written, or none of it is. A retry after a failure
  adds the stock once. The stock ledger (`v_inventory_movements`) reads posted receipts, so there is
  no separate movement to write and the balance cannot drift.
- **Against an order**, the supplier must match, the order must be confirmed and open, and every
  item must be on the order (substitutes go on a direct purchase). Receiving **more than ordered**
  is allowed, because suppliers do send extra; the order then shows nothing outstanding.
- **Supplier bill number.** Optional, but one bill number can only be entered once per supplier,
  and the error names the receipt that already has it. The bill date is optional.
- **Order of events is re-checked at posting.** An order that was closed or cancelled after the
  draft was saved, an item archived since, or a supplier archived since, stops the post.

### Which items can be bought

Only **active, stock-tracked** items. An item that doesn't track stock (a carry bag, a service) has
no ledger, so it can't be on a purchase. Units that don't allow fractions need whole quantities.
Each item appears once per document.

### Totals

A line is `quantity × cost each`, rounded to the minor unit exactly as billing rounds
(`multiplyByQuantity`). Order and receipt totals are the sum of their lines. The lists compute the
same figure in SQL, and a test checks it against the detail view. Costs are recorded as paid:
**GST input credit is not tracked** in this release.

## 3. Purchase cost (M15-05)

- **Cost history.** **Purchases → Cost history** finds an item and lists what it cost on each
  _posted_ receipt, newest first, next to its cost price today. Drafts are not history.
- **Updating the cost price.** When posting, **Update each item's cost price to what was paid**
  sets the product's `cost_price_minor` for every line whose cost differs, and lists the changes
  in the audit entry. It is off by default and needs `product.manage` as well, because it changes
  a product. Selling prices are never touched.

## 4. Permissions

| Permission        | Allows                                                            | Default roles                         |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------- |
| `supplier.view`   | See suppliers                                                     | Administrator, Manager, Inventory op. |
| `supplier.manage` | Add, edit, archive suppliers                                      | Administrator, Manager, Inventory op. |
| `purchase.view`   | See orders, receipts and cost history                             | Administrator, Manager, Inventory op. |
| `purchase.manage` | Write, confirm, cancel, close orders; save, post, delete receipts | Administrator, Manager, Inventory op. |
| `product.manage`  | Also needed to update cost prices while posting                   | Administrator, Manager, Inventory op. |

Cashiers hold none of them. See `docs/permissions.md`.

## 5. Audit

Every change is recorded in the same transaction as the change (`docs/audit-log.md`):

`supplier.created`, `.updated`, `.archived`, `.restored` · `purchase_order.created`, `.updated`,
`.confirmed`, `.closed`, `.cancelled`, `.deleted` · `goods_receipt.created`, `.updated`, `.posted`,
`.deleted`.

Entries carry names and formatted amounts (items, quantities, costs, totals), not ids.

## 6. Where things are

| What                | Where                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Rules               | `src/main/purchasing/purchaseService.ts`, `supplierService.ts`                    |
| SQL                 | `purchaseRepository.ts`, `supplierRepository.ts` (same folder)                    |
| Validation          | `src/shared/schemas/purchasing.ts`                                                |
| IPC channels        | `suppliers:*` and `purchases:*` (`src/main/ipc/handlers/purchasing.ts`)           |
| Screens             | `src/renderer/src/pages/SuppliersPage.tsx`, `PurchasesPage.tsx`, `purchasing/`    |
| Tables and triggers | `docs/data-model.md` §3.5; migration `0001_initial_schema.sql` (no new migration) |

## 7. Not done yet

- **Purchase returns and supplier credit notes.**
- **Supplier payments and outstanding balances** (P1).
- **Printing** purchase orders or receipts, and emailing an order to the supplier.
- **GST input credit** and tax on purchases.
- **Purchase reports** by supplier and date (M19-07).
- **Date filters** on the purchase lists. They search by number, supplier and bill.
- **Batches and expiry** (pharmacy, M27).
