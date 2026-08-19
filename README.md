# Competitive Programming Student Performance Tracker

Upload a spreadsheet of students, fetch their **publicly available** competitive
programming statistics from LeetCode, CodeChef, HackerRank and Codeforces, and
analyse the results through dashboards, leaderboards and downloadable reports.

The application is built around one rule: **it never invents a number.** If a
platform does not publish a statistic, or a profile is private, missing, or the
platform rate-limited us, that is recorded and displayed as such — never as `0`.

---

## Contents

- [Quick start](#quick-start)
- [What the platforms actually publish](#what-the-platforms-actually-publish)
- [Data integrity](#data-integrity)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Importing students](#importing-students)
- [Processing and rate limiting](#processing-and-rate-limiting)
- [The Competitive Programming Score](#the-competitive-programming-score)
- [Reports](#reports)
- [Testing](#testing)
- [Adding a new platform](#adding-a-new-platform)
- [Operational notes](#operational-notes)

---

## Quick start

### With Docker (everything included)

```bash
cp .env.example .env
# Set JWT_SECRET to a long random value before anything else.
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env

docker compose up --build -d
docker compose exec api npm run db:migrate
docker compose exec api npm run db:seed
```

Open <http://localhost:8080> and sign in with the seeded administrator
(`admin@tracker.local` / `Admin@12345` unless you changed it in `.env`).

The stack runs PostgreSQL, Redis, the API, a separate background worker, and
nginx serving the built SPA.

### Locally, without Docker

Requires Node.js 20+ and a PostgreSQL 14+ database.

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your database

npm run db:migrate --workspace=backend
npm run db:seed --workspace=backend

npm run dev                   # API on :4000, SPA on :5173
```

`QUEUE_DRIVER=inline` is the default, so **Redis is not required** for local
development — the queue runs in-process and job state lives in PostgreSQL.

### Mock mode

`DATA_SOURCE=mock` (the default) serves deterministic sample responses instead
of calling the real platforms. Every dashboard, report and test works without a
single outbound request. Set `DATA_SOURCE=live` to fetch real profiles.

The mock adapter deliberately reproduces each platform's **real gaps** — it will
not hand you a HackerRank contest history, because HackerRank does not publish
one. Handle-syntax validation is delegated to the real adapters, so an import
that passes in mock mode passes in live mode too.

Sample handles trigger specific outcomes, so every branch is reachable:

| Handle contains | Result |
|---|---|
| `notfound`, `missing` | `NOT_FOUND` |
| `private`, `hidden` | `PRIVATE` |
| `ratelimit`, `throttled` | `RATE_LIMITED` (retryable) |
| `unavailable`, `maintenance` | `UNAVAILABLE` |
| `error`, `broken` | `ERROR` |
| `elite`, `pro`, `beginner`, `inactive` | Sets the performance tier |

A ready-made import file is in [`samples/students-sample.xlsx`](samples/), which
includes a title row above the headers, placeholder handles, a duplicate ID and
a duplicate handle so you can watch the validator work.

---

## What the platforms actually publish

This is the single most important thing to understand about the application.
The four platforms expose very different amounts of data, and the product is
honest about it rather than papering over the differences.

| | LeetCode | CodeChef | HackerRank | Codeforces |
|---|---|---|---|---|
| **How it is retrieved** | Public GraphQL endpoint | Public profile page | Public REST endpoints | **Official public API** |
| Total solved | ✅ | ✅ | ⚠️ derived | ✅ |
| Easy / Medium / Hard | ✅ | ❌ | ❌ | ⚠️ derived |
| Per-problem list | ❌ | ❌ | ❌ | ✅ |
| Topic breakdown | ✅ | ❌ | ⚠️ by domain | ✅ |
| Contest history | ✅ | ✅ | ❌ | ✅ |
| Rating & rating history | ✅ | ✅ | ❌ | ✅ |
| Global rank | ✅ | ✅ | ❌ | ❌ |
| Recent activity | ✅ | ❌ | ❌ | ✅ |

**On the ⚠️ entries:**

- **HackerRank total solved** is summed from the per-track counters published on
  a profile's badges. HackerRank does not publish an overall figure. The
  provenance is recorded on the profile (`raw.provenance`) so the derivation is
  never mistaken for a platform-reported number.
- **Codeforces difficulty** is derived from each problem's numeric rating
  (`≤1200` Easy, `≤1900` Medium, above that Hard), because Codeforces has no
  Easy/Medium/Hard concept. Unrated problems stay `UNKNOWN`.

Codeforces is the only one of the four with a documented public API, so its
adapter never parses HTML. LeetCode's GraphQL endpoint is undocumented but is
what its own public profile pages call, and only logged-out-visible fields are
requested. CodeChef publishes nothing machine-readable, so its public profile
page is parsed defensively — any selector that stops matching yields `null`
(reported as `UNAVAILABLE`) rather than a wrong number.

---

## Data integrity

Section 33 of the brief — never fabricate or estimate — is enforced at four
levels, not just in the UI.

**1. The adapter layer** returns every value inside a status envelope. There is
no "0 means we did not get it":

```
AVAILABLE · NOT_FOUND · PRIVATE · UNAVAILABLE · ERROR · RATE_LIMITED · PENDING
```

**2. The database** stores absent values as `NULL`, never `0`. A failed fetch
updates only the status fields — it never overwrites data that was previously
retrieved, so a dashboard keeps showing the last known good numbers next to
"last updated" and the failure reason.

**3. Derived analytics** record whether each metric was even *knowable*:
`difficultyKnown`, `topicsKnown` and `contestsKnown` are true only when a
platform that actually returned data publishes that metric. A student whose only
working platform is CodeChef has no difficulty split — not a zero one.

**4. The UI and every export** render `N/A` with the reason on hover, and
aggregate views separate "unclassified" solves (a platform published a total but
no split) from Easy/Medium/Hard. Students with no retrieved data are excluded
from leaderboards and averages rather than ranked as zero.

---

## Architecture

```
                    ┌──────────────┐
                    │  React SPA   │  Vite · TypeScript · Tailwind · Recharts
                    └──────┬───────┘
                           │ REST + JWT
                    ┌──────▼───────┐
                    │  Express API │  auth · students · uploads · jobs
                    │              │  analytics · leaderboard · reports
                    └──┬────────┬──┘
                       │        │
        ┌──────────────▼──┐  ┌──▼────────────────────┐
        │  PostgreSQL     │  │  Queue (BullMQ/Redis  │
        │  (Prisma)       │  │  or in-process)       │
        └─────────────────┘  └──────────┬────────────┘
                                        │
                              ┌─────────▼──────────┐
                              │  Platform adapters │
                              ├────────────────────┤
                              │ LeetCode  CodeChef │
                              │ HackerRank  Codef. │
                              │      (or mock)     │
                              └────────────────────┘
```

Platform-specific code never touches the dashboard. Every integration
implements one `PlatformAdapter` contract, and a registry decides which
implementation serves a platform. Adding AtCoder, GeeksforGeeks, InterviewBit,
Coding Ninjas or HackerEarth means writing one adapter and registering it —
nothing else changes.

### Repository layout

```
backend/
  prisma/schema.prisma        Data model and migrations
  src/config/                 Environment, platform metadata, tunable defaults
  src/platforms/              The adapter layer
    types.ts                  The PlatformAdapter contract
    base.ts                   Shared caching, error mapping, one fetch per pass
    http.ts                   Rate-limited retrying HTTP client
    rateLimiter.ts            Per-platform token buckets
    topics.ts                 Canonical topic names across platforms
    leetcode|codechef|hackerrank|codeforces/
    mock/                     Deterministic sample source
  src/modules/                auth · students · upload · jobs · analytics · reports · settings
  src/services/               ingestion · processing · analytics · scoring · settings
  src/queue/                  Redis and in-process drivers behind one interface
  tests/                      101 tests
frontend/
  src/api/                    Typed client with silent token refresh
  src/components/             Shared UI and chart primitives
  src/pages/                  One file per screen
  src/lib/palette.ts          Validated chart colours
```

### Key design decisions

**One job item per (student, platform).** A job is not a single unit of work —
it decomposes into one retryable item per profile. One platform failing for one
student never blocks the other 3,999 items, and retries target exactly the
profiles that failed.

**Materialized analytics.** `student_analytics` and `student_skills` are
computed after each student finishes processing, so a leaderboard over 10,000
students is one indexed read instead of an aggregation across every profile.

**Snapshots, never overwrites.** Each refresh writes at most one dated snapshot
per student per platform per day, which is what makes growth-over-time charts
possible without unbounded row growth.

**Two queue drivers.** `inline` needs no infrastructure beyond PostgreSQL and is
the local default; `redis` (BullMQ) scales to multiple worker processes. Job
*state* lives in the database either way, so a restart resumes cleanly —
interrupted items are re-queued at boot.

---

## Configuration

Every value has a working default; see [`.env.example`](.env.example) for the
full list. The ones that matter most:

| Variable | Default | Notes |
|---|---|---|
| `DATA_SOURCE` | `mock` | `mock` or `live` |
| `QUEUE_DRIVER` | `inline` | `inline` or `redis` |
| `RUN_WORKER_IN_API` | `true` | Set `false` when running a separate worker |
| `JWT_SECRET` | dev value | **Required** in production; the app refuses to start otherwise |
| `CACHE_TTL_MINUTES` | `720` | How long a successful fetch stays fresh |
| `MAX_UPLOAD_MB` / `MAX_UPLOAD_ROWS` | `15` / `20000` | Upload limits |
| `QUEUE_CONCURRENCY` | `4` | Worker concurrency |

Scoring weights, score targets, skill thresholds, per-platform rate limits,
cache durations and platform colours are **runtime settings**, editable by an
administrator in the Settings screen without a redeploy.

---

## Importing students

`Upload Excel` walks through four steps: choose a file, map the columns, review
validation, import.

- **Formats:** `.xlsx`, `.xlsm`, `.csv`. Legacy `.xls` is rejected with an
  explanation — see [Operational notes](#operational-notes).
- **Header detection** scans the first ten rows, so a title row above the
  headers is handled automatically.
- **Column mapping** is suggested from a large alias list (`Roll No`, `Dept`,
  `Passing Year`, `Code Chef`, …) and is fully editable.
- **Handles** may be bare usernames or full profile URLs. Placeholder cells
  (`-`, `N/A`, `nil`, …) are treated as "no account", not as a handle.
- **Validation** reports errors (blocking) and warnings (non-blocking)
  separately: missing required fields, malformed handles, invalid emails,
  duplicate student IDs within the file and against the database, handles shared
  between students, and rows with no platform at all.

Only `Student ID` and `Name` are required. A student may have one platform, four,
or none.

Re-uploading a file **updates** existing students matched on Student ID.

---

## Processing and rate limiting

Nothing is fetched in the request that uploads the file. Importing creates a
background job, and the Processing screen shows live progress: students
processed, per-platform success counts, the student currently being fetched, and
every individual failure with its reason and attempt count.

Politeness towards the platforms is enforced in the shared HTTP client:

- a **token bucket per platform** (default 10–30 requests/minute, configurable)
- **exponential backoff with full jitter**, capped
- **`Retry-After` is honoured** and applied to the whole platform, not just the
  one request that hit the limit
- **response caching** in PostgreSQL, so refreshing 10,000 students does not
  re-fetch data that is still fresh
- a bounded **retry count**, after which the profile is marked `RATE_LIMITED`
  and the run continues

A profile that is rate-limited or errors is retried on demand from the job
screen; a profile that genuinely does not exist is not retried, because it will
not start existing.

> With multiple worker processes the buckets are per-process. Divide the
> per-platform limit by the worker count, or run a single worker for the
> platforms with the tightest limits.

---

## The Competitive Programming Score

A 0–100 composite computed **by this application**. It is not an official
platform metric, and it is labelled as such everywhere it appears — in the UI, in
the PDF and in the spreadsheet exports.

Default weights, all administrator-configurable:

| Component | Weight | Full marks at |
|---|---|---|
| Problems solved | 30% | 1,100 solved |
| Problem difficulty | 20% | 2,200 points (Easy 1 · Medium 3 · Hard 6) |
| Contest participation | 15% | 55 contests |
| Contest rating | 20% | 2,100 rating |
| Topic coverage | 15% | 28 distinct topics |

Each component is a ratio against its target, capped at 100%, then weighted;
weights are normalized, so they do not have to add up to 100. The rating
component subtracts an 800 floor, since ratings start there on every platform —
without it an unrated newcomer would already score ~40%.

Every student's page shows the full calculation: each component's weight,
achievement, points contributed, and the arithmetic behind it. Changing the
weights offers to recompute every student.

---

## Reports

| Report | Formats | Contents |
|---|---|---|
| Student | PDF, XLSX, CSV | Profile, platform statistics, difficulty split, topics, skill matrix, contests, rating history, growth, score breakdown |
| Batch | PDF, XLSX, CSV | Statistics with medians, highlights, top 10, platform adoption, topic analysis, leaderboard |
| Leaderboard | XLSX, CSV | The current filtered ranking |
| Failures | XLSX, CSV | Every failed profile with platform, status, attempts and error |

PDFs are rendered with primitives (no chart library), including bar charts for
platform, difficulty and topic distributions.

---

## Testing

```bash
npm test --workspace=backend
```

101 tests covering topic normalization, scoring and skill levels, all four
platform parsers, rate limiting and backoff, Excel reading and column mapping,
row validation, the full upload → process → analytics pipeline against a real
database, and the REST API including authentication and authorization.

Tests never touch a real platform — `DATA_SOURCE=mock` is forced in
`tests/setup.ts`.

Integration tests need a PostgreSQL database; set `TEST_DATABASE_URL` (defaults
to `postgresql://tcp@127.0.0.1:5432/tcp_test`). The schema is pushed
automatically. Test files run sequentially because they share that database.

The suite has already earned its keep — it caught a greedy regex in the CodeChef
parser that captured `7` instead of `1967`, a mock/live handle-validation
mismatch, and a `NULLS FIRST` ordering bug that floated students with no data to
the top of every "best first" list.

---

## Adding a new platform

1. Add the platform to the `Platform` enum in `prisma/schema.prisma` and migrate.
2. Add an entry to `PLATFORMS` in `src/config/platforms.ts` — label, colours,
   profile URL builder, rate limit, and which capabilities it publishes.
3. Write `src/platforms/<name>/adapter.ts` extending `BaseAdapter`. Only `load()`
   and `buildProfileUrl()` are required; caching, retries, rate limiting and
   error mapping are inherited.
4. Register it in `src/platforms/liveFactories.ts`.

Nothing else changes. The importer picks up the new column automatically, the
mock source works immediately, and every dashboard includes it.

**Before implementing any integration, verify how that platform currently allows
its public data to be accessed.** Prefer an official API; fall back to public
endpoints; scrape only where the platform's terms and robots policy permit it.

---

## Operational notes

**Legacy `.xls` is not supported.** Reading it requires a parser with known
prototype-pollution and ReDoS advisories, which is a poor trade for an
authenticated file-upload endpoint. The app detects `.xls` and tells the user to
re-save as `.xlsx` or `.csv`. `.xlsx`, `.xlsm` and `.csv` are handled natively.

**Chart colours are accessibility-checked, not brand-exact.** The platforms'
marketing colours fail as a chart palette — LeetCode's orange and HackerRank's
green are far too light against a white surface, and CodeChef's brown reads as
gray. Each hue was re-stepped and machine-validated (lightness band, chroma
floor, colour-blind separation, contrast) for both themes. Both steps per
platform are configurable in Settings if you need to match a brand guideline.

**Outbound requests are host-locked.** Handles are normalized to a bare
username and validated before use, so a crafted value cannot change the target
host, and redirects are followed manually with an allowlist of platform
hostnames — a hijacked response cannot pivot the server onto an internal
address.

**Security.** Argon-grade password hashing via bcrypt, short-lived access tokens
with rotating refresh tokens in `httpOnly` `SameSite=Strict` cookies,
role-based access control (`ADMIN` / `TRAINER` / `VIEWER`), per-endpoint rate
limiting with a stricter limit on sign-in, Zod validation on every request body
and query, upload type and size limits with server-generated filenames,
parameterized queries throughout via Prisma, and Helmet security headers. No
platform passwords are ever requested or stored — only public profile
identifiers and public data.

**Scale.** Every list endpoint is paginated, hot columns are indexed, analytics
are materialized, imports and analytics rebuilds run in bounded batches, and the
UI never loads more than a page of students at a time.
