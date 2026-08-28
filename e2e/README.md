# End-to-end suites

Three suites that exercise the running application rather than mocks. They are
deliberately separate from the unit and integration tests (`npm test`), which
need no server.

| Suite | What it covers |
|---|---|
| `api.e2e.ts` | Every REST endpoint, authn/authz, upload → process → retry, reports, data-integrity rules, scheduled refresh, the needs-attention rules, error paths (187 checks) |
| `ui.e2e.mjs` | Every screen driven through a real browser: forms, filters, sorting, pagination, tabs, the upload wizard, modals, downloads, theming, mobile (158 checks) |
| `session-race.e2e.mjs` | Regression guard for the rotating-refresh-token race that could sign a valid user out |

## Running them

```bash
# 1. A freshly seeded database — the suites assert on exact counts.
npm run db:migrate --workspace=backend
npm run db:seed    --workspace=backend

# 2. Start the API and the web app (a restart also clears the sign-in
#    rate limiter, which a previous run may have exhausted).
npm run dev

# 3. In another terminal:
npm run e2e            # all three
npm run e2e:api        # API only
npm run e2e:ui         # browser only
npm run e2e:session    # session race only
```

The browser suites need Playwright's Chromium:

```bash
npx playwright install chromium
# or point at an existing binary:
CHROMIUM_PATH=/path/to/chromium npm run e2e:ui
```

## Configuration

| Variable | Default |
|---|---|
| `E2E_BASE` | `http://localhost:4000` (API) |
| `E2E_WEB` | `http://localhost:5173` (web app) |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | the seeded administrator |
| `E2E_OUT` | temp dir for failure screenshots |
| `CHROMIUM_PATH` | let Playwright resolve its own browser |

## Notes

- **Run them against a freshly seeded database.** They assert on concrete counts
  (24 seeded students, a 120-row import, 386 profile fetches) and mutate data as
  they go — a second run on the same database will report differences.
- **The sign-in endpoint is rate limited** (10 attempts / 15 minutes). The suites
  use several logins between them; if a run reports "Too many sign-in attempts",
  restart the API to clear the in-memory counter. That limiter is a security
  control working as intended, not a bug.
- The suites run against `DATA_SOURCE=mock`, so they never touch a real platform
  and the numbers are deterministic.
