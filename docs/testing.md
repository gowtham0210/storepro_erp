# Testing StorePro

How StorePro is tested: what kind of test goes where, how to run it, and what CI checks on every
push. The release acceptance plan in the PRD (§12) builds on this.

## 1. Test layers

| Layer           | Tool                             | Where                               | What it covers                                                                                                                     | Speed         |
| --------------- | -------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Unit**        | Vitest (Node)                    | `src/**/*.test.ts` next to the code | Pure logic: money, quantities, validation, shortcuts parsing, redaction, window state                                              | ms            |
| **Integration** | Vitest (Node) + real SQLite      | `src/main/**/*.test.ts`             | Services and repositories against a migrated database: constraints, triggers, views, migrations, integrity checks                  | ms per test   |
| **Component**   | Vitest (jsdom) + Testing Library | `src/renderer/**/*.test.tsx`        | React components, forms, keyboard behaviour, focus, live regions, axe accessibility (without colour contrast)                      | ms            |
| **End-to-end**  | Playwright + real Electron       | `e2e/*.spec.ts`                     | The built app: security boundaries, start-up and shutdown, crash recovery, navigation, axe accessibility including colour contrast | ~1 s per test |
| **Performance** | Vitest (Node)                    | `src/**/*.perf.test.ts`             | PRD §11 targets on a 10,000-product store                                                                                          | ~20 s         |

Most tests are unit, integration or component tests: fast and precise. End-to-end tests are kept
for what only the real app can show: Electron security settings, processes, the file system and
real rendering.

## 2. Running tests

| Command                      | What it runs                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `npm test`                   | Unit, integration and component tests (both Vitest projects)                   |
| `npm run test:watch`         | The same, re-running on save                                                   |
| `npm run test:coverage`      | The same with coverage; fails below the thresholds. HTML report in `coverage/` |
| `npm run test:e2e`           | Builds the app, then runs the Playwright suite                                 |
| `npm run test:e2e:only`      | Playwright against the current build in `out/`                                 |
| `npm run test:perf`          | Performance targets                                                            |
| `npx playwright show-report` | Opens the last end-to-end report (screenshots and app logs of failures)        |

Run one file or test with `npx vitest run src/main/db/schema.test.ts -t "barcode"` or
`npx playwright test e2e/lifecycle.spec.ts -g "hard kill"`.

On Linux without a display, prefix end-to-end runs with `xvfb-run -a`.

## 3. Writing tests

### Shared helpers

| Helper                                                    | Use                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `useTempDir()` (`src/main/test/helpers.ts`)               | A fresh temporary folder per test, deleted afterwards (with retries for Windows file locks)                     |
| `createTestLogger()`                                      | A logger whose methods are spies                                                                                |
| `useMigratedDb()` (`src/main/db/test/testDb.ts`)          | A migrated **in-memory** database per test. The default for integration tests                                   |
| `useMigratedFileDb()`                                     | A migrated database **file** with production settings (WAL, FULL sync), for backups, reopening or WAL behaviour |
| `fixedClock`                                              | A constant time, so tests never depend on the real clock                                                        |
| `src/main/db/dev/builders.ts`                             | Insert well-formed products, sales, returns, receipts and adjustments in one call                               |
| `renderApp(path)` (`src/renderer/src/test/renderApp.tsx`) | The whole renderer (providers + routes) at a path                                                               |
| `e2e/fixtures.ts`                                         | `test` with `storepro`, `ui` and `userDataDir` fixtures; `launchStorePro()` for tests that restart the app      |

### Rules

- **Isolation.** Every test gets its own database or data folder. End-to-end launches set
  `STOREPRO_USER_DATA_DIR`, which unpackaged builds honour, so tests never touch a real store's data
  and can run in parallel.
- **Determinism.** Use `fixedClock`, seeded data and explicit waits on conditions
  (`expect.poll`, `toBeVisible`), never fixed sleeps for correctness. The end-to-end suite was run
  3× in parallel with retries off: 72/72 passed.
- **Test behaviour, not implementation.** Query the UI by role and accessible name, as a user or
  screen reader would. That also checks the accessibility of what you built.
- **Cover failure paths.** The PRD requires tests for invalid input, interrupted operations,
  database errors and restarts (§12). Each domain service needs at least one test that injects a
  failure and checks nothing was half-written.
- **Cross-platform.** Build paths with `path.join`/`resolve`, close database handles before temp
  folders are deleted, and don't assume `/` separators. CI runs everything on Windows too.
- **New screens** add an axe check (component test, and an end-to-end path in
  `e2e/accessibility.spec.ts`).

## 4. Coverage

Coverage counts unit, integration and component tests. The thin Electron wiring (`main/index.ts`,
window creation, session hardening, process crash handlers, preload) is excluded because only the
end-to-end tests can exercise it.

Thresholds are set just below the measured level, so coverage can rise but not quietly fall:

| Metric     | Measured | Threshold |
| ---------- | -------- | --------- |
| Statements | 90.6%    | 89%       |
| Branches   | 84.0%    | 83%       |
| Functions  | 89.0%    | 87%       |
| Lines      | 93.4%    | 91%       |

Raise the thresholds when coverage rises. Never lower them to make a change pass.

## 5. Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push to `main`, every pull
request, and on demand:

| Job                 | Runs on         | Steps                                                                                                                |
| ------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Checks              | Ubuntu, Windows | Lint and formatting (Ubuntu), type-check, unit + integration + component tests (with coverage on Ubuntu)             |
| End-to-end          | Ubuntu, Windows | Build, then the Playwright suite against real Electron. The report, screenshots and app logs are uploaded on failure |
| Performance targets | Ubuntu          | `npm run test:perf`                                                                                                  |
| Windows installer   | Windows         | Only after all the above pass: `npm run dist:win`, uploaded as the `StorePro-Setup` artifact                         |

On Ubuntu 24.04, Electron's sandbox helper is given its setuid bit rather than turning the sandbox
off. Older runs of a branch are cancelled when a newer commit is pushed.

## 6. Not automated yet

| Area                                                                       | Plan                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Installing and upgrading the packaged installer on a clean Windows machine | M30-09: manual checklist, then a Windows VM job                                     |
| Real receipt printers and barcode scanners                                 | M30-10: supported-device matrix, manual                                             |
| Performance on the reference hardware                                      | M30-08: once the reference machine is chosen (PRD §15)                              |
| End-to-end tests against the _packaged_ app                                | Needs a test-only way in that the fuses still allow; added with the installer tests |
