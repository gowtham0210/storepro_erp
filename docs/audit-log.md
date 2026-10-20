# Audit log

What StorePro records about who did what, and how (PRD FR-013; module M07).

## 1. Principles

- **Append-only.** `audit_logs` rejects every `UPDATE` and `DELETE` with a trigger. Nobody can
  edit or remove an entry through StorePro, administrators included.
- **Atomic with the change.** An entry describing a change is written in the same transaction
  as the change, so there is never a change without its entry, or an entry for a change that
  was rolled back (M07-02). `AuditLog.change()` throws if it is called outside a transaction.
- **One shared service.** Every module records through `AuditLog`
  (`src/main/audit/auditLog.ts`). Actions are typed: a module can only record an action registered
  in `src/shared/audit.ts`, which also gives it the label people see.
- **Readable later.** Details are written for a person reading them months later. They use names
  rather than ids, and edits are stored as `changes: { field: { from, to } }`.
- **No secrets.** Fields that look secret (passwords, PINs, tokens) are masked before writing. The
  username typed in a failed sign-in is kept; the password never is.
- **Who approved it.** When a manager approval (M06-05) unlocked an action, the approver is
  stored in its own column next to the person who did it.

## 2. What an entry holds

| Column                | Meaning                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `occurred_at`         | When, in epoch milliseconds                                             |
| `user_id`             | Who did it; null for StorePro itself                                    |
| `approved_by_user_id` | Who approved it, if a manager approval was used (migration 0004)        |
| `action`              | What happened, e.g. `user.updated`                                      |
| `entity_type`, `_id`  | Which record it was about, e.g. `user` 3. Not a foreign key, by design  |
| `details`             | A JSON document of facts. Validated as JSON; never queried relationally |

## 3. Recording an action

```ts
db.transaction(() => {
  products.setPrice(variantId, newPrice)
  audit.change({
    action: 'product.price_changed',
    actor, // the request's actor: records who did it, and who approved it
    entity: { type: 'product_variant', id: variantId },
    details: { changes: changesBetween({ price: oldText }, { price: newText }) }
  })
})
```

- Use `change()` for anything that changes stored data, inside its transaction.
- Use `event()` for something that happened without a change: a sign-in, a refused request, a
  failed approval.
- Pass `actor` from the handler's context. Use `userId` only when there is no actor (sign-in)
  or `null` for StorePro's own entries.
- New actions: add them to `AUDIT_CATEGORIES` with a label. If the generic description in the
  viewer isn't clear enough, add a sentence to `describeAuditEntry()`
  (`src/renderer/src/audit/describeAuditEntry.ts`).

## 4. What is recorded

| Area                | Actions                                                                                                                                                                             | Recorded by    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Sign-in and access  | sign-in, failed sign-in, sign-out, password changed, refused request (`access.denied`)                                                                                              | M05, M06       |
| Approvals           | approval given, approval refused (wrong password, or the approver isn't allowed either)                                                                                             | M06            |
| User accounts       | added, changed (name, role), password reset, deactivated, reactivated                                                                                                               | M05            |
| StorePro itself     | store data upgraded (with the backup file name), unexpected shutdown recovered, data check found problems                                                                           | M07 (start-up) |
| Store settings      | store set up, settings changed, module switched on or off, bill rounding or discount limit changed, tax rate added, changed, archived or restored, payment method added, changed, archived or restored, receipt printer settings changed, scale barcode settings changed | M03, M04, M10, M12, M21, M24 |
| Products and prices | product added, changed, archived, restored; price changed (before and after); pack size added, archived, restored; category added, renamed, archived, restored; unit added, renamed                           | M09                |
| Stock               | stock adjusted (reason, items, delta, balance after); physical stock counted (recorded, counted, delta)                                                                                                       | M14                |
| Suppliers and purchases | supplier added, changed, archived, restored; purchase order started, changed, confirmed, closed (including when fully received), cancelled, deleted; goods receipt started, changed, posted (items, total, cost prices updated), deleted | M15 |
| Customers           | customer added, changed (before and after), archived, restored                                                                                                                                                 | M17                |
| Expenses            | expense recorded, changed (before and after), voided, restored; expense category added, renamed, archived, restored                                                                                           | M18                |

Sensitive actions of modules that aren't built yet must be added as those modules are built.
Each must use `change()` with the request's `actor`:

| Action (planned)         | Module |
| ------------------------ | ------ |
| Return and refund        | M16    |
| Backup made, restored    | M20    |
| Data imported / exported | M22    |

## 5. The viewer (M07-04)

**Manage → Audit log**, for roles with `audit.view` (administrators and managers).

- Newest first, 50 at a time, with **Show older entries** to page back. Pages use a keyset cursor
  on the entry id, so they load as fast a year back as today. 300,000 entries load in under 25 ms
  for any filter (`src/main/audit/auditLog.perf.test.ts`).
- Filters: person (what they did or approved), action, and a date range. Only people and actions
  that appear in the log are offered. Filters are kept in the address, so Back works and other
  screens can link to a view. **Users → History** opens one person's account history.
- Read-only. There is nothing to edit, and no way to delete.

## 6. Not done yet

- **Tamper evidence.** The triggers stop changes made through StorePro, but not someone editing
  the database file with another tool. A hash chain over entries would make such edits
  detectable; it would only deter, because the key would live on the same computer.
- **Retention and archiving.** Entries are kept forever. At a few hundred entries a day, ten years
  is about a million rows (a few hundred MB), which SQLite handles. Archiving can follow the
  backup retention decision (PRD §15).
- **Export.** Exporting the log to a file belongs with data export (M22).
