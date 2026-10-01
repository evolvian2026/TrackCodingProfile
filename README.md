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
- [The database](#the-database)
- [Architecture](#architecture)
- [Deploying](#deploying)
- [Configuration](#configuration)
- [Importing students](#importing-students)
- [Processing and rate limiting](#processing-and-rate-limiting)
- [Scheduled refresh](#scheduled-refresh)
- [Alerts: who needs attention](#alerts-who-needs-attention)
- [Goals and progress to target](#goals-and-progress-to-target)
- [The student's own view](#the-students-own-view)
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
```

That is the whole sequence. A one-shot `migrate` service applies the schema
before the API and the worker start, so there is no manual migration step and
no window in which the app is serving a database with no tables.

To load the 24 sample students as well:

```bash
docker compose run --rm migrate npm run db:seed:prod --workspace=backend
```

Open <http://localhost:8080> and sign in with the seeded administrator
(`admin@tracker.local` / `Admin@12345` unless you changed it in `.env`).

The stack runs PostgreSQL, Redis, a one-shot migration step, the API, a separate
background worker, and nginx serving the built SPA. The API, worker and
migration step share one image, so it is built once.

If the stack does not come up, `docker compose logs api` and
`docker compose logs migrate` say why; the migration service fails loudly rather
than letting the app start against an unmigrated database.

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

## The database

**PostgreSQL, with Prisma as the schema owner and query layer.** There is no
other store: job state, cached platform responses, analytics and historical
snapshots all live in Postgres, which is why `QUEUE_DRIVER=inline` needs no
Redis at all.

### Where the schema comes from

[`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) is the single
source of truth — 24 tables covering students, per-platform profiles, problems,
topics, contests, ratings, snapshots, jobs, analytics, alerts, goals and share
links. Every change to it is a numbered migration in
`backend/prisma/migrations/`, applied with:

```bash
npm run db:migrate --workspace=backend        # prisma migrate deploy — production safe
npm run db:migrate:dev --workspace=backend    # creates a new migration from schema edits
```

`migrate deploy` only ever applies pending migrations, never rewrites history,
so it is what runs in Docker and in any deployment.

### Looking at the tables

```bash
npm run db:studio --workspace=backend   # Prisma Studio on :5555 — browse and edit every table
```

Prisma Studio is the quickest option and needs nothing installed. For SQL:

```bash
psql "$DATABASE_URL"                          # local
docker compose exec postgres psql -U tcp tcp  # inside the Docker stack
\dt                                           # list tables
select count(*) from students;
```

Any standard client works too — pgAdmin, DBeaver, TablePlus, DataGrip — pointed
at the `DATABASE_URL` host, port, database, user and password.

### Persistence

| Where it runs | What holds the data | Survives |
|---|---|---|
| Docker Compose | named volume `postgres-data` | `docker compose down`, restarts, image rebuilds |
| Docker Compose | named volume `redis-data` | the same (queue state, append-only) |
| Docker Compose | named volume `uploads` | the same (uploaded spreadsheets) |
| Local, no Docker | your own PostgreSQL data directory | whatever your install does |
| Managed host | the provider's volume or managed Postgres | per that provider |

`docker compose down` keeps all three volumes. **`docker compose down -v`
deletes them** — that is the one command that destroys your data. To reset
deliberately:

```bash
docker compose down -v && docker compose up --build -d
```

Uploaded spreadsheets are the only state outside Postgres. They are kept so a
failed import can be re-examined; nothing reads them after a job finishes, so
the volume can be cleared without affecting any dashboard.

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
  src/modules/                auth · students · upload · jobs · analytics · reports
                              settings · alerts · schedule · goals · share
  src/services/               ingestion · processing · analytics · scoring · settings
    alerts.service.ts         The needs-attention rules (pure, so they are testable)
    schedule.service.ts       Time-zone and DST-correct slot arithmetic
    scheduler.ts              The loop, slot claiming and manual runs
    goals.service.ts          Target measurement, including the unmeasurable cases
    share.service.ts          Hashed read-only links and the student's own view
  src/queue/                  Redis and in-process drivers behind one interface
  tests/                      219 tests
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

**Scheduled slots are claimed by inserting a row.** The scheduled run's slot
instant is unique, so the database settles the race between workers without an
external lock, and a restart cannot re-fire a slot that already went.

**The alert rules are a pure function.** `evaluateRules()` takes snapshots and
thresholds and returns concerns; nothing in it touches the database. Every rule,
including the ordering that stops a stale-data gap being reported as a student
failing to progress, is tested directly against fabricated histories.

---

## Deploying

The app can run as **one container** — the API serves the built SPA from its own
process and drains the queue in-process, so a deployment needs exactly one web
service and one Postgres. That is the shape free hosting tiers are built for.

```bash
docker build -t tracker .
docker run -p 4000:4000 \
  -e DATABASE_URL="postgresql://…" \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e APP_BASE_URL="https://your-app.example.com" \
  -e CORS_ORIGIN="https://your-app.example.com" \
  tracker
```

The container migrates itself on boot (`prisma migrate deploy`, which is a no-op
when the schema is current). Add `SEED_ON_START=true` to load the 24 sample
students — the seed upserts, so it is safe on every restart.

### Why one origin rather than two

Hosting the SPA on a static host and the API elsewhere looks tidier and
**breaks sessions**. The refresh token lives in a `SameSite=Strict` cookie,
which is the correct setting — and it means a browser on `app.example.com` will
not send that cookie to `api.example.net`. Logins would appear to work and then
every user would be signed out when their 30-minute access token expired.

Serving both from one origin removes the problem instead of weakening the
cookie. If you do split them, you need a shared parent domain and
`sameSite: 'lax'` or `'none'` — a deliberate trade, not a default.

### A free setup that works

| Piece | Service | Notes |
|---|---|---|
| App (one container) | **Render** free web service | Spins down after 15 minutes idle; ~1 minute cold start. 750 instance-hours/month per workspace. |
| Database | **Neon** free Postgres | Permanent free tier, 0.5 GB per project, scales to zero. No card. |
| Queue | none needed | `QUEUE_DRIVER=inline` keeps job state in Postgres. |

Render's own free Postgres **expires 30 days after creation**, which is why the
database belongs on Neon for anything you want to leave up. Point
`DATABASE_URL` at the Neon connection string and Render at this repo's root
`Dockerfile`.

Set these on the web service: `DATABASE_URL`, `JWT_SECRET`,
`APP_BASE_URL` and `CORS_ORIGIN` (both the Render URL),
`DATA_SOURCE=mock` for a showcase, and `SEED_ON_START=true` for the first boot.

**Two things to expect on a free tier**, both worth knowing before you demo it:

- **The first visit after an idle period takes about a minute** while the
  service wakes. Open it yourself before showing anyone.
- **The scheduled refresh only fires while the process is alive.** The scheduler
  is a 60-second interval inside the app, so a spun-down free instance simply
  misses its slot; the grace window means it runs on the next wake if that is
  within 12 hours. Harmless with `DATA_SOURCE=mock`, worth paying for a
  warm instance if you are tracking real profiles.

### Other options

- **Railway** — supports this Dockerfile directly and does not spin down. The
  permanent free plan grants only $1/month of credit after its trial, so in
  practice it is the $5/month Hobby plan.
- **Fly.io** — deploys the Dockerfile well and does not sleep, but no longer has
  an ongoing free allowance for new accounts.
- **Any VPS** — `docker compose up -d` gives you the full split stack with Redis
  and a separate worker, which is the right shape once real refreshes matter.

A static host such as Vercel, Netlify or Cloudflare Pages can serve the SPA, but
only alongside an API on the same origin — see the cookie note above.

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
cache durations, platform colours, the refresh schedule and the
needs-attention thresholds are **runtime settings**, editable by an
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

## Scheduled refresh

Refreshing every profile by hand is the step that quietly stops happening, and
stale numbers are worse than no numbers because they still look like answers. So
the refresh can run itself: **Settings → Automation** sets a daily or weekly
time, in a real IANA time zone, and the app fetches everyone on that schedule.

The parts that matter in practice:

- **Time zones are honoured properly.** 02:00 in `Asia/Kolkata` is 02:00 there
  all year. Where a clock jumps forward and the chosen time does not exist that
  day, the run happens at the first instant that does — never an hour early.
- **A slot fires once.** Workers claim a slot by inserting a row keyed on the
  slot instant, so the unique index settles the race: however many processes are
  running, exactly one wins, and a restart cannot re-fire a slot that already
  went.
- **A missed slot is not fired late.** If the app was down past the grace window
  (12 hours by default), the slot is recorded as `SKIPPED` rather than kicking
  off a surprise full refresh in the middle of a working day.
- **The history is visible.** The Automation tab lists the last ten runs with
  their status and job number, so "did last night's refresh actually run?" is a
  question with an answer on screen.

**Refresh everyone now** starts a run immediately, independently of the
schedule — it works when the day's slot is already spent and when automatic
refresh is switched off entirely, because someone pressed the button.

Finding nothing to do is a success, not a failure: an unforced refresh shortly
after a manual one legitimately finds every profile still inside the cache
window, and the run is recorded as `COMPLETED`.

---

## Alerts: who needs attention

A leaderboard shows who is ahead. It does not show the student who has not
solved anything in three weeks, because they are somewhere in the middle of a
long list. The **Needs attention** screen is that missing view.

| Alert | Fires when |
|---|---|
| `NO_PROGRESS` | Solved count moved by at most the threshold over the window (default: 0 in 21 days) |
| `RATING_DECLINE` | Rating fell by at least the threshold from a recent peak (default: 100) |
| `CONTEST_INACTIVE` | No new contest entry for the configured period (default: 60 days) |
| `NO_DATA` | Handles are on file but nothing has ever been retrieved |
| `PROFILE_UNAVAILABLE` | A handle has been failing as not-found, private or erroring |
| `NO_PLATFORM_HANDLES` | No handles on file, so nothing can be fetched |
| `STALE_DATA` | We have not refreshed this student recently enough to judge |

Two rules run through all of it:

**A student is never blamed for a gap in our own data collection.** If the last
successful fetch is older than the staleness threshold, the engine raises
`STALE_DATA` and stops — it does not also raise `NO_PROGRESS`. Not knowing
whether someone is working is a different statement from knowing they are not,
and the app makes that distinction rather than blurring it. The last three rows
of the table are operator problems; the screen groups them separately, under
"needs a data fix" rather than "needs coaching".

**Every alert carries its evidence.** The two observations the rule compared,
with their dates and values, travel with the alert and are shown on screen, so a
trainer can check the claim instead of trusting it. `Solved count moved by 0 in
21 days (1 → 1)` is a statement someone can argue with; "inactive" is not.

Alerts are keyed on `(student, type)`, so `detectedAt` keeps answering "since
when" as an alert persists across refreshes, and an alert is deleted when its
rule stops firing rather than being left to rot. They are recomputed whenever a
student's analytics are rebuilt, and can be acknowledged (and reopened) by
trainers. Thresholds live in **Settings → Automation**; changing them offers to
re-run the rules immediately so the list matches the numbers on screen.

---

## Goals and progress to target

Training programs are run against goals, so the dashboards should be too. An
administrator sets a target for a cohort — *2023-26 CSE: 300 solved and 5
contests by December* — and the Goals screen reports how the batch is doing
against it.

A goal's scope is whichever of college / batch / branch / section it names; the
fields it leaves blank widen it, and a goal that names none applies to everyone.
Targets are absolute totals to reach, not gains since the start date.

**The question this feature turns on: what does a target mean for a student
whose platforms do not publish the metric?** Counting them as "not met" would
report a gap in the platforms' data as a student falling short, which is the
mistake the rest of the app exists to avoid. So every student scores one of four
outcomes per target:

| Outcome | Meaning |
|---|---|
| **Met** | At or above the target |
| **Short** | Measurable and behind, with the shortfall |
| **Not measurable** | No platform of theirs publishes this metric |
| **No data** | Nothing has ever been retrieved for them |

The percentage is computed over the students it is *measurable* for, and the
rest are reported in their own columns rather than folded in. When nobody in
scope can be measured, the rate is **not shown at all** rather than shown as 0% —
0% reads as "everybody failed"; the truth is "we cannot say".

Two things keep the numbers arguable-with rather than merely assertive:

- **Every cohort figure opens into the names behind it.** Clicking "6 short"
  lists those six students with their current value against the target — and the
  unmeasurable students are just as reachable, not quietly hidden.
- **A student behind a target is told the pace that closes it.** "70 to go,
  about 35 a week from here" is arithmetic on the shortfall and the deadline,
  deliberately not a prediction of whether they will make it. Alongside it sits
  what they actually did — "gained 60 over the last 27 days" — from dated
  snapshots, so the reader draws the comparison rather than the app asserting
  one.

---

## The student's own view

Everything above is for coordinators. But the person who most needs to see a
weak-topics breakdown is the student, and provisioning several hundred accounts
to show each of them one page is a poor trade.

So each student gets a **read-only link**. Opening it shows their own record —
platforms with honest statuses, strongest topics, where to focus next, their
goals with progress, their position in their batch, and a progress chart — with
no account, no navigation, and no way into anything else.

What makes it safe to hand out:

- **The token is stored hashed**, exactly like a refresh token. A database dump,
  a log line or a screenshot of that table hands nobody a working link. The
  consequence is deliberate: the URL is shown **once**, at the moment it is
  issued, and a lost link is regenerated rather than recovered.
- **It carries no contact details.** No email, no phone, no internal notes —
  and no other student, by name or otherwise. The rank is included because a
  position without identities is motivating rather than exposing.
- **Revoked, expired, unknown and deleted all answer identically.** Telling an
  anonymous caller which case it was is free information about who exists.
- **It is not a way in.** The link authenticates nothing; visiting any other
  page still lands on the sign-in screen.
- **Our own failures stay ours.** A `STALE_DATA` alert — we stopped refreshing
  this student — is filtered out of the student's view. It is not news they can
  act on, and showing it to them reports our problem as though it were theirs.

Links are issued one at a time from a student's page, or for a whole cohort from
**Settings → Student links**, which returns every URL once with a CSV export for
a mail merge. Reissuing skips students who already hold a live link unless you
explicitly ask to replace them — silently regenerating would break links already
sitting in inboxes. The same screen shows which links have actually been opened,
so a batch nobody clicked is visible rather than assumed successful.

Set `APP_BASE_URL` to the address students reach the app on; without it, links
are built from the first `CORS_ORIGIN`.

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

Two layers: fast tests that need no server, and end-to-end suites that drive the
running application.

```bash
npm test          # 219 unit + integration tests
npm run e2e       # 436 end-to-end checks against a running app
```

### Unit and integration

219 tests covering topic normalization, scoring and skill levels, all four
platform parsers, rate limiting and backoff, Excel reading and column mapping,
row validation, schedule arithmetic across time zones and daylight saving, every
needs-attention rule, goal measurement including the unmeasurable cases, share
link issuing and revocation, the full upload → process → analytics pipeline
against a real database, the REST API including authentication and
authorization, and a static contract check that the paths the Dockerfiles and
start scripts invoke are the ones the build actually emits.

Tests never touch a real platform — `DATA_SOURCE=mock` is forced in
`tests/setup.ts`.

Integration tests need a PostgreSQL database; set `TEST_DATABASE_URL` (defaults
to `postgresql://tcp@127.0.0.1:5432/tcp_test`). The schema is pushed
automatically. Test files run sequentially because they share that database.

### End-to-end

`npm run e2e` needs the app running and a freshly seeded database — see
[`e2e/README.md`](e2e/README.md). It runs 245 API checks (every endpoint,
authn/authz, upload → process → retry, reports, scheduling, the alert rules,
goals, share links, error paths) and 189 browser checks (every screen, forms,
filters, sorting, pagination, the upload wizard, modals, downloads, the
signed-out student view, theming, mobile), plus a regression guard for the
session refresh race.

### What the tests have caught

They have already earned their keep. In the unit layer: a greedy regex in the
CodeChef parser that captured `7` instead of `1967`, a mock/live
handle-validation mismatch, and a `NULLS FIRST` ordering bug that floated
students with no data to the top of every "best first" list.

End-to-end found three more that unit tests structurally could not:

- **Sorting the leaderboard by a column silently did nothing.** Two sequential
  `setSearchParams` calls in one handler clobbered each other, so the sort
  direction changed but the column did not.
- **A valid session could be signed out at random.** Refresh tokens rotate, and
  the boot refresh bypassed the client's single-flight guard — so two concurrent
  refreshes (React StrictMode, or simply two open tabs) burned the token and
  logged the user out. Every refresh now funnels through one in-flight request.
- **A malformed request body returned 500.** body-parser rejects unreadable
  bodies before any route runs; those now surface as 400 and 413.
- **Resetting a scoring setting left every stored score stale.** Saving weights
  offered a recompute; resetting them did not, so the leaderboard kept showing
  scores calculated under the old weights with nothing to indicate it. Reset now
  recomputes exactly as saving does.
- **A nightly job would have run an hour early twice a year.** Converting a wall
  clock to an instant resolved *backwards* across a spring-forward gap, so 02:30
  on a day when 02:30 does not exist became 01:30 rather than 03:30. The
  conversion now round-trips and takes the later candidate.
- **The inactivity rule could essentially never fire.** It filtered snapshots to
  the window before measuring the change across it, which discarded the older
  reading it needed to compare against. It now takes the most recent observation
  *at or before* the window start.
- **"Run now" did nothing once the day's slot had gone.** It was routed through
  the same claim as the scheduler, so the button was dead for the rest of the
  day. A manual run is now keyed on the instant it was requested.
- **The audit trail forgot that a run was manual.** Finishing a job overwrote the
  run's note with its outcome, so "somebody pressed the button" was lost.
  How a run started is now a field of its own.
- **Every unknown route started answering 401 instead of 404.** Mounting the
  share-link admin routes at `/api` put a blanket auth check in front of the
  whole prefix, so "no such route" became "you are not signed in". They are
  mounted on their own paths now.
- **The Docker stack could never have started.** `tsconfig` keeps `rootDir` at
  the package root so `prisma/seed.ts` compiles too, which means the build emits
  `dist/src/index.js` — but the Dockerfile ran `node dist/index.js` and compose
  ran `node dist/worker.js`. Both crash-looped on `MODULE_NOT_FOUND`. Every one
  of the 200-plus tests passed throughout, because they all run the TypeScript
  sources through `tsx` and never touch the compiled output. There is now a
  static contract test asserting that every path a container invokes is a path
  the build produces.
- **The documented migrate and seed commands could not run either.** `prisma`
  and `tsx` are devDependencies and the runtime image installs with
  `--omit=dev`, so `docker compose exec api npm run db:migrate` would have
  failed with "prisma: not found". The CLI is now a runtime dependency, a
  one-shot `migrate` service applies the schema before the app starts, and
  production seeding runs the compiled seed.
- **Docker would have rejected every request the SPA made.** `.env.example` sets
  `CORS_ORIGIN` to Vite's dev port, and compose's `:-` default could not
  override a value that was set, so the API allow-listed `:5173` while the
  browser was on `:8080`. Compose now reads a separate `WEB_ORIGIN`.

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
identifiers and public data. Student view links are 32 random bytes stored
hashed and rate-limited separately; they authenticate nothing beyond the one
record they point at.

**Scale.** Every list endpoint is paginated, hot columns are indexed, analytics
are materialized, imports and analytics rebuilds run in bounded batches, and the
UI never loads more than a page of students at a time.

**The scheduler is safe to run everywhere.** Every API and worker process starts
the loop; slot claiming means only one of them fires each occurrence, so there
is no "which container owns cron" question to get wrong. Set the schedule's time
outside working hours — a full refresh of 10,000 students is a long run against
rate-limited platforms, and the grace window exists so that a deploy or a short
outage does not turn into one starting at 11am.
