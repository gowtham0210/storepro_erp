# Customers

How StorePro keeps who you sell to (module M17). There is no credit or balance in this release:
customers are for finding people again and seeing what they have bought.

## 1. Records (M17-01)

**Sell → Customers** lists customers with their contact details, how many purchases they have made
and when they last bought. A customer has a name (required), phone, email, address and GSTIN or
tax number.

- **A phone number identifies one customer.** Phones are stored without spaces, dashes or
  brackets (`+919840012345`), so `98400 12345` and `(98400) 12345` are the same number. A second
  customer with that number is refused, and the error names who has it. Any number of customers can
  have no phone.
- **Search** matches name, email and tax number as typed, and phones however you type them
  (`98400`, `+91 98400`, `(98400) 12345`). Words never match every phone.
- **Archive, don't delete.** An archived customer is hidden by default (Show → Archived customers),
  isn't offered at the billing counter, and keeps their name on past invoices. Restore to use them
  again.
- Cashiers, managers and administrators hold `customer.view` and `customer.manage`. Inventory
  operators hold neither.
- Every change is audited with what changed (`customer.created`, `.updated`, `.archived`,
  `.restored`).

## 2. At the billing counter (M17-02)

The Billing screen shows **Customer: Walk-in customer** above the scan bar. **Add customer** opens
a search by name or phone (Enter picks the first match). **Add new customer** takes a name and
whatever else is known without leaving the bill, and chooses the new customer straight away.
**Remove** returns the bill to a walk-in.

- A customer is optional. Billing, holding and checkout work exactly as before without one.
- A held bill keeps its customer and gets them back when resumed.
- The customer is saved on the sale (`sales.customer_id`) and printed on the receipt.
- The customer is cleared for the next bill.
- An archived customer can't be put on a new bill; checkout says so if they were archived in the
  meantime.

## 3. Purchase history (M17-03)

**Purchases** on a customer lists their invoices, newest first: number, date, items, total, and what
was refunded on returns. The summary above it is **billed minus refunded, for invoices that weren't
voided, across every page**. A voided invoice stays on the list, struck through, and isn't counted.

Seeing history needs `sale.view` as well as `customer.view`, because it lists sales; without it the
button isn't shown.

## 4. Where things are

| What         | Where                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| Rules        | `src/main/customers/customerService.ts`; SQL in `customerRepository.ts`    |
| Validation   | `src/shared/schemas/customers.ts` (`normalizePhone`)                       |
| IPC channels | `customers:*` (`src/main/ipc/handlers/customers.ts`)                       |
| Screens      | `pages/CustomersPage.tsx`, `customers/` (dialogs, history, billing picker) |
| Billing      | `sales/cart.ts` (`setCartCustomer`), `pages/BillingPage.tsx`               |
| Tables       | `customers` in migration `0001` (no new migration)                         |

## 5. Not done yet

- **Customer credit, balances and repayments** (P1).
- **Loyalty points and discounts per customer.**
- **Importing customers** from a file (M22).
- **Merging duplicate customers.**
- A keyboard shortcut for choosing the customer at the counter.
