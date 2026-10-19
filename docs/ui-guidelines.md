# StorePro UI guidelines

How StorePro's interface is designed and built. Every new screen (M03–M22) follows this document.
Use the components in `src/renderer/src/components/ui`; don't style raw HTML. During development
you can see every component at **Developer → Components** (`/dev/components`).

## 1. Principles

These come from Nielsen's usability heuristics, WCAG 2.2 AA, and Fitts's and Hick's laws, adapted
for the people who use StorePro: cashiers working quickly at a busy counter (keyboard, scanner,
sometimes a touch screen), and owners, managers and stock staff working in the back office.

| #   | Principle                                | What it means in StorePro                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Speed for frequent users**             | Keyboard-first. Every frequent action has a shortcut, and F-keys work even while typing in the barcode field. The app opens on Billing. Primary POS actions are large (`lg`, 48 px) and few (Fitts's and Hick's laws).                                                                                    |
| 2   | **Visibility of system status**          | A connectivity indicator is always in the top bar. Buttons show a spinner while working and block repeat clicks. Toasts confirm what happened, and a skeleton holds the layout while data loads. Being offline is shown calmly ("billing still works"), because it is normal.                             |
| 3   | **Match the real world**                 | Shop words: Bill, Hold, Pay, Void. Money in ₹ with Indian grouping (₹1,23,456.78). Quantities in the item's unit (1.25 kg). Windows conventions: Enter confirms, Esc cancels, F1 opens help.                                                                                                              |
| 4   | **User control and freedom**             | Esc closes every dialog. Focus returns to where you were. Cancel is always offered, and destructive actions ask first.                                                                                                                                                                                    |
| 5   | **Consistency**                          | One component library. Semantic colour tokens only (the default palette is switched off). The same shortcut does the same thing everywhere.                                                                                                                                                               |
| 6   | **Error prevention**                     | Number fields refuse characters that can't be valid. Impossible actions are disabled. Destructive confirmations focus **Cancel**, and their button names the action ("Void bill", never "OK").                                                                                                            |
| 7   | **Recognition over recall**              | Shortcut hints on buttons and in the sidebar. F1 lists exactly what works on the current screen. Visible labels on every field (placeholders are not labels).                                                                                                                                             |
| 8   | **Help people recover from errors**      | Messages say what happened and what to do, in plain language, next to the field. After a failed submit, focus moves to the first problem. Internal details stay in the log.                                                                                                                               |
| 9   | **Accessible to everyone (WCAG 2.2 AA)** | 4.5:1 text contrast, 3:1 for control borders and focus. Visible focus ring. Everything works by keyboard. Status is never shown by colour alone. Landmarks and labels for screen readers; toasts are announced. Reduced motion is respected. Windows High Contrast mode works. Text size goes up to 150%. |
| 10  | **Clear hierarchy, calm surface**        | Light workspace, dark navy navigation, and one dominant element per screen. On Billing that element is the total to pay. One `<h1>` per page. Numbers are right-aligned with tabular digits.                                                                                                              |
| 11  | **Fast and stable**                      | No layout shift: skeletons reserve space and fonts are local. Motion is about 150 ms and only conveys change.                                                                                                                                                                                             |

## 2. Design tokens

All defined in [`src/renderer/src/styles/theme.css`](../src/renderer/src/styles/theme.css). Components
use the semantic names (`bg-surface`, `text-fg-muted`, `border-input`, ...). The Tailwind default
palette is disabled, so a raw colour such as `bg-blue-500` doesn't compile to anything.

| Token                                               | Use                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `canvas` / `surface` / `surface-muted`              | Page background / cards and inputs / table headers and footers   |
| `fg` / `fg-muted` / `fg-subtle`                     | Body text / secondary text / hints and placeholders              |
| `divider`                                           | Decorative separators only, never the only boundary of a control |
| `input`                                             | Control borders (3.65:1 on white)                                |
| `accent` (+ `-hover`, `-soft`, `-fg`)               | Primary actions, selection, info                                 |
| `success` / `warning` / `danger` (+ `-soft`, `-fg`) | Status. Always paired with an icon or text                       |
| `nav*`                                              | The navy sidebar and the total-to-pay panel                      |
| `focus` / `focus-on-dark`                           | Focus ring on light / dark surfaces                              |

**Contrast is tested.** `styles/contrast.test.ts` computes the WCAG ratio of every foreground and
background pair used in the UI and fails the build below 4.5:1 for text or 3:1 for controls and
focus. When you add a token or pairing, add it to that test.

**Type.** Windows system fonts (Segoe UI, with Nirmala UI for Indic scripts), so nothing is
downloaded and text renders natively.

- Base size is 16px with 1.5 line height. `text-sm` (14px) is for secondary text and dense tables.
- `text-xs` (12px) is only for badges and shortcut hints.
- The total to pay uses `text-display` (44px).
- All sizes are in rem, so the text-size setting (Ctrl+= / Ctrl+- / Ctrl+0, 87.5–150%) scales the
  whole UI, and the sidebar collapses to icons when the scaled layout gets narrow.

**Sizes.** Controls are `sm` 32px (dense back-office tables), `md` 40px (default) and `lg` 48px
(billing actions and touch screens). Every target is at least 24px (WCAG 2.5.8).

**Motion.** 150 ms ease-out for entering elements. `prefers-reduced-motion` turns animation off.

## 3. Components

| Component                                        | Use it for                                  | Rules it enforces                                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                         | Every action                                | Variants: primary (one per area), secondary, ghost, danger. `loading` blocks repeat clicks. Icon-only buttons must have `aria-label` (a type error otherwise). `shortcut` shows the hint and sets `aria-keyshortcuts` |
| `Field` + `TextInput` / `Select` / `NumberInput` | Every form control                          | Visible label, required marker, hint, and an error with an icon. All wired via `aria-describedby` and `aria-invalid`                                                                                                  |
| `NumberInput`                                    | Money and quantities                        | Refuses invalid characters. Right-aligned tabular digits. Selects all on focus so the value can be typed over. Optional ±step with arrow keys and large +/− buttons                                                   |
| `Money`, `Quantity`, `TotalDisplay`              | Showing amounts                             | Currency formatting from `shared/money.ts`. `TotalDisplay` is the high-contrast total to pay                                                                                                                          |
| `DataTable`                                      | Lists                                       | Real `<table>` with caption and sticky header. `aria-sort`. Arrow/Home/End/Page keys move between rows, Enter opens one. Skeleton while loading, and an empty state                                                   |
| `Dialog`                                         | Focused tasks                               | Native `<dialog>`: focus trap, Esc, background made inert, focus returned afterwards. Global shortcuts are suspended. A scrolling body is keyboard-reachable                                                          |
| `useConfirm()`                                   | Destructive or irreversible actions         | Consequence stated, verb label, Cancel focused for danger                                                                                                                                                             |
| `useToast()`                                     | Feedback about something that just finished | Bottom-right, away from totals. Success and info disappear on their own; errors stay until dismissed. Hovering or focusing pauses the timer. Errors are announced assertively, others politely                        |
| `Alert`                                          | A message tied to a place on the screen     | Icon + title + text, optional action. `role=alert` only for danger                                                                                                                                                    |
| `Badge`                                          | Short status ("Voided", "Low stock")        | Icon + text                                                                                                                                                                                                           |
| `EmptyState`                                     | Nothing to show yet                         | Says why, and what to do next                                                                                                                                                                                         |
| `PageHeader`                                     | Top of every page                           | The page's only `<h1>`. Sets the window title. Receives focus after navigation                                                                                                                                        |

### Forms

Use `useForm` with a schema built from `src/shared/validation.ts`. Put the schema in `src/shared`
when the main process validates the same input; then one rule and one message serve both sides.

- **Timing.** A field is checked when the user leaves it. Once it shows an error, it is rechecked
  on every keystroke, so the error disappears as soon as it's fixed. Everything is checked on
  submit, and focus moves to the first invalid field on screen.
- **Server errors.** `form.applyServerError(error)` places a handler's `VALIDATION_FAILED` details
  on the matching fields. Other errors go through `describeError()` into an `Alert` or toast.
- **Messages.** Tell the person what to do: "Enter the selling price", not "Required" or
  "Invalid input".
- **Submitting.** Use `<form noValidate>` and a `type="submit"` primary button, so Enter submits.
  Ctrl+Enter also works on long forms.

### Errors

`describeError(error)` turns any error into a title and message for the user. It never shows
internal details.

| Code                    | Title                                  | Message                            |
| ----------------------- | -------------------------------------- | ---------------------------------- |
| `VALIDATION_FAILED`     | "Some details need fixing"             | Fields are highlighted             |
| `FORBIDDEN`             | "You don't have permission to do this" | Ask a manager                      |
| `NOT_FOUND`, `CONFLICT` | Specific titles                        | Refresh or reload, then try again  |
| `INTERNAL`, unexpected  | "Something went wrong"                 | Try again; your saved data is safe |

## 4. Layout and navigation

```
┌──────────┬──────────────────────────────────────────────────────────┐
│ StorePro │ Sell / Billing              ● Online   Mon 19 Oct  F1   │ ← banner
│          ├──────────────────────────────────────────────────────────┤
│ SELL     │ (recovery notice, if the last session crashed)           │
│ Billing  │ Page title (h1)                                 actions  │
│ Sales    │ description                                              │ ← main
│ ...      │                                                          │
│ MANAGE   │                                                          │
│ Settings ├──────────────────────────────────────────────────────────┤
│ Collapse │ StorePro 0.1.0 · Data is saved on this computer          │ ← status
└──────────┴──────────────────────────────────────────────────────────┘
```

- **Skip link.** "Skip to main content" is the first Tab stop.
- **Sidebar.** Grouped by task: Sell, Stock, Manage. Each item has an icon, a label and its
  shortcut. The current page is marked with `aria-current`, a background, bold text and a side bar
  (underlined in High Contrast mode).
- **Filtering.** Items are filtered by enabled modules (M04) and permissions (M06). A screen opened
  without permission shows "You don't have access", never a blank page. This only shapes the UI;
  the main process enforces permissions.
- **After navigation.** Focus moves to the new page's `<h1>`, so screen readers announce it.
- **Narrow windows.** The sidebar collapses to icons below 1152px (scaled by text size). Ctrl+B
  toggles it on wider windows.

## 5. Keyboard

| Shortcut                      | Action                                                                                  | Where      |
| ----------------------------- | --------------------------------------------------------------------------------------- | ---------- |
| Ctrl+1 … Ctrl+9               | Billing, Sales, Customers, Products, Inventory, Purchases, Suppliers, Reports, Expenses | Everywhere |
| Ctrl+,                        | Settings                                                                                | Everywhere |
| F1                            | Shortcuts for this screen                                                               | Everywhere |
| Ctrl+B                        | Collapse/expand sidebar                                                                 | Everywhere |
| Ctrl+= / Ctrl+- / Ctrl+0      | Larger / smaller / reset text                                                           | Everywhere |
| Esc                           | Close dialog                                                                            | Dialogs    |
| ↑ ↓ Home End PgUp PgDn, Enter | Move between rows, open a row                                                           | Tables     |
| F2–F12                        | Reserved for Billing (M11: search, quantity, hold, pay, ...)                            | Billing    |

**How shortcuts work.**

- Register with `useShortcut(combo, handler, { description })` inside a
  `<ShortcutScope name="Billing">` for screen shortcuts.
- Dialogs open an exclusive scope automatically, which suspends everything behind them.
- While the cursor is in a text field, only function keys, Esc and Ctrl/Alt combos fire, so typing
  never triggers a shortcut by accident.
- Give every shortcut a `description` so it appears in F1 help. Show it on its button with the
  `shortcut` prop.
- Shortcuts are fixed per screen, even when some items are hidden, so muscle memory stays reliable.

## 6. Review checklist for new screens

Before a screen is done (in addition to the PRD Definition of Done):

- [ ] Built only from `components/ui`, with semantic tokens and no raw colours.
- [ ] One `PageHeader` (h1). Headings in order.
- [ ] Every action works by keyboard; the frequent ones have shortcuts with descriptions.
- [ ] Every field has a visible label. Errors appear next to the field and say how to fix them.
- [ ] Loading shows a skeleton or spinner within 100 ms. Empty states say what to do next.
- [ ] Destructive actions use `useConfirm` with a verb label.
- [ ] Status uses an icon or text as well as colour.
- [ ] Works at 150% text size, with the sidebar collapsed, and in Windows High Contrast mode.
- [ ] `accessibility.test.tsx`-style axe test added for the screen. No violations.

## 7. How this is verified

| Check                                                                   | Where                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Token contrast (36 pairs)                                               | `styles/contrast.test.ts`                                                                                                |
| axe-core (WCAG 2.2 AA + best practice) on the shell and every component | `test/accessibility.test.tsx` (jsdom, without colour contrast)                                                           |
| axe-core including colour contrast in real Chromium                     | Manual run against the dev app; was clean on Billing, gallery, form errors, dialogs, toasts, offline state and 150% text |
| Keyboard behaviour, focus management, live regions                      | Component, shortcut, form and shell tests                                                                                |
