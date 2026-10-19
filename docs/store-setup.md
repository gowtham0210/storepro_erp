# Store setup and configuration

How a new StorePro installation becomes a working store, and how its details are changed later
(PRD FR-001 to FR-005; module M03).

## 1. First run (M03-02)

On first launch StorePro opens the setup wizard. It works without internet access and takes
about two minutes.

| Step                | Asks for                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Store details       | Name, country, phone, address, city, state and PIN code (India), email                                                  |
| Business and region | Business type (grocery/retail only in this version), currency, time zone                                                |
| Tax                 | Registered for GST? If so, the GSTIN. Do entered prices include tax?                                                    |
| Receipts            | Invoice number prefix (with a preview of the first number), messages at the top and bottom, with a live receipt preview |
| Your account        | The administrator's name, username and password                                                                         |
| Check and finish    | Everything entered, with a **Change** link per step                                                                     |

- **Checked as you go.** Each step is validated before **Continue**, using the same rules the
  main process applies again. Errors appear next to their fields, and focus goes to the first
  one. On a new step, focus moves to the step's heading so screen readers announce it.
- **Saved all at once.** Nothing is written until **Finish setup**. The store, its first
  administrator and the audit entries are saved in one transaction (`setup:complete`), so an
  interrupted setup leaves nothing half-done, and the next start shows the wizard again.
- **Errors found on save** (from the main process) send you back to the step with the field.
- **Sensible defaults.** India, INR, the computer's time zone, prices including tax (the MRP
  convention), invoice prefix `INV`. The tax question has no default: it must be answered.
  Choosing another country picks its currency and time zone, and swaps the Indian state list and
  PIN code for free text.

## 2. The setup guard (M03-03, FR-005)

Nobody can bill before setup is saved:

- **In the main process.** Until the store profile exists, the service host refuses every
  guarded IPC channel with `SETUP_REQUIRED`, except those marked `beforeSetup`: reading the
  profile, completing setup, and changing a password. A new screen's channels are blocked by
  default; nothing has to remember to opt in.
- **In the UI.** `AuthGate` shows the app only once the profile has loaded. A database that has
  an administrator but no store (from before M03) gets a shorter wizard without the account step,
  shown to users with `settings.edit`. Everyone else sees "StorePro isn't set up yet" and can
  only sign out.

## 3. Settings (M03-04, FR-002)

**Manage → Settings** has five sections: store details, business and region, tax, receipts and
stock. Each section saves on its own: **Save** is enabled only when something changed, and
**Unsaved changes** says so.

- Changing settings needs `settings.edit` (administrators). Managers (`settings.view`) see the
  same screen read-only.
- Every change is audited as `store.updated` with readable before-and-after values (state names
  rather than codes, yes/no for switches). Saving without changes records nothing.
- **The currency can't change after the first sale.** Amounts are stored in the currency's minor
  units, so changing it would make past amounts read in the wrong currency.
- Changing the invoice prefix affects new bills only; numbering continues.
- Choosing a country in Settings never changes the currency or time zone by itself.

## 4. Validation

| Field              | Rule                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| State (India)      | One of the 36 states and union territories, stored as its ISO 3166-2 code (`TN`)                                                        |
| PIN code (India)   | Six digits, not starting with 0                                                                                                         |
| GSTIN              | 15 characters in the GSTIN pattern, a correct check character, and the store's state code (`33` for Tamil Nadu) as its first two digits |
| Tax number (other) | Up to 30 characters                                                                                                                     |
| Time zone          | Known to the runtime; old names are saved as current ones (`Asia/Calcutta` → `Asia/Kolkata`)                                            |
| Currency           | One of the seeded currencies                                                                                                            |
| Invoice prefix     | 1–8 letters, digits, `/` or `-`, upper-cased                                                                                            |

The rules live in `src/shared/schemas/store.ts` and `src/shared/regions.ts` and are shared by
the wizard, Settings and the main process.

## 5. Dates in the store's time zone (M03-05)

Timestamps are stored in UTC. What counts as "today", which day a late-night sale belongs to, and
the times printed on bills follow the **store's** time zone, not the computer's. The helpers in
`src/shared/storeTime.ts` are used by both processes:

| Helper                               | Use                                                            |
| ------------------------------------ | -------------------------------------------------------------- |
| `businessDateOf(at, timeZone)`       | The store's calendar date of an instant (`2026-10-19`)         |
| `startOfBusinessDay(date, timeZone)` | When that date starts at the store                             |
| `businessDayRange(first, last, tz)`  | `[from, to)` instants for a range of dates, both ends included |
| `addDays(date, n)`                   | Calendar arithmetic on dates                                   |
| `formatStoreTime(at, tz, style)`     | "19 Oct 2026, 10:00 am" for people at the store                |

They handle half- and quarter-hour offsets (India, Nepal), 23- and 25-hour days at daylight-saving
changes, and days whose midnight doesn't exist. The header clock and the audit log's dates and date
filter already use them; reports (M19) and invoices (M11, M13) will too.

## 6. Data

The store profile is the single row of `businesses`, plus the invoice prefix in
`document_sequences`. The row's existence is what "set up" means. Setup also switches on the
business type's module in `enabled_modules` (grocery), which M04 builds on. No migration was
needed: the schema from M02 already had every field.

## 7. Not done yet

- Receipt paper width and printer choice: these belong to the computer, not the store, and come
  with printing (M13, M21).
- Other business types: listed but disabled until their modules exist (M25–M27).
- Exact GST invoice requirements are still an open decision (PRD §15). The GSTIN and the state
  are captured so M10 can apply them.
