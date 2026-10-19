# Permissions and access control

How StorePro decides who may do what (PRD FR-011, FR-012; module M06).

## 1. Principles

- **Enforced in the main process.** Every IPC request is checked by the service host before its
  handler runs, and services check again. Hiding a button or screen is only a convenience: a
  tampered-with renderer gets the same answer as the UI (PRD §6.2, "rejected by the application
  service, not merely hidden").
- **Deny by default.** Every handler must declare an access rule; there is no default. Only nine
  channels are public: start-up, logging and the sign-in flow. A test fails if that list grows
  without the test being updated.
- **Least privilege.** Four fixed roles, each with only the permissions its job needs (§3).
- **No escalation.** Nobody can hand out, or take over, more access than they have (§4).
- **Fresh on every request.** The user and their role are re-read from the database for each
  request, so a deactivation or role change applies to the very next one.
- **Audited.** Refused requests (`access.denied`), approvals (`override.approved`) and failed
  approvals (`override.denied`) are written to `audit_logs`.

## 2. How a request is checked

```
renderer ──invoke──▶ sender check ─▶ input validation ─▶ permission guard ─▶ handler ─▶ service
                     (origin)        (Zod schema)        (access rule)        context.actor  assertCan()
```

A handler's `access` is one of:

| Access            | Who may call                                                           |
| ----------------- | ---------------------------------------------------------------------- |
| `public`          | Anyone, with no session (start-up, sign-in, logging)                   |
| `password-change` | A signed-in user, even if they must choose a new password first        |
| `signed-in`       | Any signed-in, unlocked user                                           |
| a permission code | A signed-in, unlocked user whose role grants it, e.g. `'stock.adjust'` |

For guarded handlers the service host resolves the **actor** (who the request runs as, with their
permissions) and passes it to the handler as `context.actor`; the handler passes it to the service.
A refusal is `FORBIDDEN` with `details: { permission, overridable }`.

Code: `src/main/auth/access.ts` (types), `AuthService.authorize()` (the guard),
`src/main/ipc/serviceHost.ts` (where it runs), `src/shared/permissions.ts` (the catalogue).

## 3. Roles

Administrators have every permission. Managers have everything except changing settings,
restoring a backup and importing data. Cashiers bill, look after customers and look up products
and stock. Inventory operators look after products, stock, purchases and suppliers.

The mapping is fixed in this version and set by migration
[`0003_permissions.sql`](../src/main/db/migrations/0003_permissions.sql). To change it, add a
migration and update `src/main/auth/rolePermissions.test.ts`, which pins the mapping so a change is
always deliberate. Administrators can see this table in the app: **Users → What each role can do**.

| Permission                                        | Code                | Administrator | Manager | Cashier | Inventory operator |
| ------------------------------------------------- | ------------------- | :-----------: | :-----: | :-----: | :----------------: |
| **Sales**                                         |                     |               |         |         |                    |
| Bill customers at the counter                     | `sale.create`       |       ✓       |    ✓    |    ✓    |                    |
| View past sales and invoices                      | `sale.view`         |       ✓       |    ✓    |    ✓    |                    |
| Reprint invoices and receipts                     | `sale.reprint`      |       ✓       |    ✓    |         |                    |
| Void a completed sale                             | `sale.void`         |       ✓       |    ✓    |         |                    |
| Give discounts within the store limit             | `discount.apply`    |       ✓       |    ✓    |    ✓    |                    |
| Give discounts above the store limit              | `discount.override` |       ✓       |    ✓    |         |                    |
| Change an item's price on a bill                  | `price.override`    |       ✓       |    ✓    |         |                    |
| Take returns and give refunds                     | `return.create`     |       ✓       |    ✓    |         |                    |
| **Customers**                                     |                     |               |         |         |                    |
| View customers                                    | `customer.view`     |       ✓       |    ✓    |    ✓    |                    |
| Add and edit customers                            | `customer.manage`   |       ✓       |    ✓    |    ✓    |                    |
| **Products and stock**                            |                     |               |         |         |                    |
| View products and prices                          | `product.view`      |       ✓       |    ✓    |    ✓    |         ✓          |
| Add and edit products and prices                  | `product.manage`    |       ✓       |    ✓    |         |         ✓          |
| View stock levels and movements                   | `inventory.view`    |       ✓       |    ✓    |    ✓    |         ✓          |
| Adjust stock quantities                           | `stock.adjust`      |       ✓       |    ✓    |         |         ✓          |
| **Purchasing**                                    |                     |               |         |         |                    |
| View purchases                                    | `purchase.view`     |       ✓       |    ✓    |         |         ✓          |
| Record purchases and goods received               | `purchase.manage`   |       ✓       |    ✓    |         |         ✓          |
| View suppliers                                    | `supplier.view`     |       ✓       |    ✓    |         |         ✓          |
| Add and edit suppliers                            | `supplier.manage`   |       ✓       |    ✓    |         |         ✓          |
| **Expenses and reports**                          |                     |               |         |         |                    |
| View expenses                                     | `expense.view`      |       ✓       |    ✓    |         |                    |
| Record expenses                                   | `expense.manage`    |       ✓       |    ✓    |         |                    |
| View reports and the dashboard                    | `report.view`       |       ✓       |    ✓    |         |                    |
| **Administration**                                |                     |               |         |         |                    |
| Add users, change their roles and reset passwords | `user.manage`       |       ✓       |    ✓    |         |                    |
| View store settings                               | `settings.view`     |       ✓       |    ✓    |         |                    |
| Change store settings                             | `settings.edit`     |       ✓       |         |         |                    |
| View the audit log                                | `audit.view`        |       ✓       |    ✓    |         |                    |
| Back up store data                                | `backup.create`     |       ✓       |    ✓    |         |                    |
| Restore store data from a backup                  | `backup.restore`    |       ✓       |         |         |                    |
| Export data to files                              | `data.export`       |       ✓       |    ✓    |         |                    |
| Import data from files                            | `data.import`       |       ✓       |         |         |                    |

Permissions for screens that don't exist yet (voids, stock adjustments, backups and so on) are
in the catalogue now, so later modules only declare them on their handlers.

## 4. The no-escalation rule

Anyone with `user.manage` can add users, edit them, reset their passwords and deactivate them,
but only for roles that grant **nothing beyond their own permissions**
(`canGrant()` in `src/shared/permissions.ts`). With the current mapping:

- Administrators can manage everyone, including other administrators.
- Managers can manage managers, cashiers and inventory operators. They can't create an
  administrator, promote anyone to administrator, or edit, reset or deactivate an administrator's
  account (which would let them sign in as one).
- The existing safeguards still apply: you can't deactivate yourself, and the last active
  administrator can't be demoted or deactivated.

The Users screen applies the same rule: it only offers roles you can give, and shows "Only an
administrator can change this account" instead of the actions you can't take. Taking away your
own access asks for confirmation first.

## 5. Manager approval (M06-05)

Some restricted actions at the counter, such as a void or a discount above the limit, can be
approved by another user for one request instead of being refused outright. The handler opts in
with `overridable: true` and accepts an optional `overrideId` in its input.

1. The cashier's request is refused with `FORBIDDEN` and `overridable: true`.
2. The renderer shows **Manager approval needed**. The approver types their own username and
   password, which goes to `auth:approve-override`.
3. The main process checks the password (throttled like sign-in) and checks that the approver
   holds the permission. It then issues a random approval id, valid for 2 minutes, **once**, for
   that permission and that cashier only. Approvals are held in memory and dropped on lock,
   sign-out and sign-in.
4. The renderer repeats the request with the `overrideId`. The guard consumes it, re-checks that
   the approver is still active and still allowed, and runs the request with `actor.override` set,
   so the service can record who approved it.

In the renderer, wrap the call:

```ts
const withApproval = useManagerApproval()
await withApproval((overrideId) => invoke('sales:void', { saleId, overrideId }))
```

No channel is overridable yet. Point of sale (M11) is the first to use it. PINs instead of
passwords are not supported. They would be faster at the counter, but a 4-digit PIN is easy to
guess and would need its own throttling and storage.

## 6. Adding a restricted action

1. If no existing permission fits, add one to `PERMISSION_GROUPS` in `src/shared/permissions.ts`,
   and in a new migration insert it into `permissions` and grant it to the right roles (always
   including `administrator`). The catalogue and the migration must match exactly.
2. Declare it as the handler's `access`. Add `overridable: true` if a manager may approve it at the
   counter.
3. Call `assertCan(actor, 'the.permission')` in the service.
4. Add a sample input to `SAMPLE_INPUTS` in `src/main/ipc/accessControl.test.ts`. That test then
   proves signed-out users and roles without the permission are refused.
5. In the UI, hide or disable the action with `useCan()` (`src/renderer/src/auth/permissions.ts`)
   and give navigation items a `permission`.
