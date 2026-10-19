# Inventory and stock ledger

How StorePro tracks stock on hand, movements, adjustments, physical counts and low-stock alerts
(PRD FR-050 to FR-055; module M14).

## 1. Ledger model (M14-01, M14-02, M14-08)

Stock is never edited in place. Every stock change comes from an immutable document line and is
projected through two SQL views (`docs/data-model.md` §3.3):

| View                    | What it is                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `v_inventory_movements` | Every stock movement (`sale`, `sale_void`, `sale_return`, `goods_receipt`, `adjustment`)      |
| `v_stock_on_hand`       | Current stock (`sum(quantity_delta_milli)`) for every pack size with `p.tracks_inventory = 1` |

Because `v_stock_on_hand` is derived directly from `v_inventory_movements`, the stock balance
cannot drift from the ledger. `InventoryService.verifyLedgerConsistency()` and `checkIntegrity()`
(`stock_on_hand_mismatch`) verify this invariant at startup recovery and maintenance checks.

## 2. Negative-stock policy (M14-03)

- By default, `businesses.allow_negative_stock` is `0` (**No**): any outflow (a sale or a downward
  stock adjustment) that would leave a tracked item below zero is refused with `CONFLICT`, naming
  the item, how much is on hand and how much was needed.
- Duplicate lines for the same pack size in one transaction are summed before checking stock.
- Administrators can allow selling and adjusting below zero under **Manage → Settings → Stock**.
- Products with `tracks_inventory = 0` (such as carry bags or services) are never blocked.

## 3. Stock adjustments (M14-04)

`InventoryService.adjust()` (`inventory:adjust`) records manual stock changes inside a transaction:

- Requires `stock.adjust` (administrators, managers, inventory operators).
- Allocates the next document number from `document_sequences` (`ADJ000001`, `ADJ000002`, …).
- Requires a seeded reason (`opening_stock`, `count_correction`, `damage`, `expiry`, `theft_loss`,
  `other`) and optional notes.
- Checks that every item tracks stock, is not archived, obeys its unit's fraction rule, and obeys
  the store's negative-stock policy.
- Writes `stock_adjustments` and `stock_adjustment_items` (both append-only via database triggers)
  and records `stock.adjusted` in the audit log with the before/after quantities.

## 4. Physical stock counts (M14-06)

`InventoryService.reconcile()` (`inventory:reconcile`) reconciles physical shelf counts against
recorded stock:

1. In **Stock → Inventory → Count stock**, the user enters the physical quantity on the shelf for
   any items they counted (leaving uncounted items blank).
2. StorePro shows the live variance (`counted − recorded`) per item.
3. On **Approve count**, `InventoryService.reconcile()` recomputes each item's variance inside a
   database transaction, writes a `count_correction` stock adjustment for items with a non-zero
   variance, and records `stock.counted` in the audit log with recorded, counted and delta
   quantities. If every counted item already matches recorded stock, no adjustment row is created.

## 5. Low-stock alerts and movement history (M14-05, M14-07)

- Each pack size has an optional `reorder_level_milli`. An active tracked item is flagged as **Out
  of stock** when `on_hand_milli <= 0` and **Low stock** when `on_hand_milli <= reorder_level_milli`.
- **Stock → Inventory** shows a summary banner when any items are low or out of stock and filters by
  search (`variant_search` FTS5), category, and stock level (`all`, `low`, `out`).
- Clicking any row or **Movements** opens the item's movement history (`inventory:movements`),
  newest first, with the running balance (`SUM(...) OVER (...)`) after each movement, the source
  document number (`INV…`, `CN…`, `GRN…`, `ADJ…`), the reason or note, and who recorded it.
