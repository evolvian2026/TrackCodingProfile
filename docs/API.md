# API reference

Base URL: `/api`. All responses are JSON unless the endpoint returns a file.

Authentication is a short-lived bearer token (`Authorization: Bearer <token>`)
plus a rotating refresh token in an `httpOnly`, `SameSite=Strict` cookie scoped
to `/api/auth`. The SPA refreshes transparently on a 401.

Roles: `ADMIN` > `TRAINER` > `VIEWER`. `ADMIN` satisfies every requirement.

## Errors

```json
{ "error": { "code": "BAD_REQUEST", "message": "Human-readable explanation", "details": [] } }
```

`VALIDATION_ERROR` carries a `details` array of `{ path, message }`.

| Status | Meaning |
|---|---|
| 400 | Invalid request or validation failure |
| 401 | Missing, expired or invalid token |
| 403 | Authenticated but insufficient role |
| 404 | Not found |
| 409 | Conflict (duplicate email, duplicate student ID) |
| 429 | Rate limited |

---

## Auth

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/login` | — | Returns `accessToken` + sets the refresh cookie |
| POST | `/auth/refresh` | — | Rotates the refresh token, returns a new access token |
| POST | `/auth/logout` | — | Revokes the presented refresh token |
| GET | `/auth/me` | any | The signed-in user |
| POST | `/auth/change-password` | any | Revokes all other sessions |
| GET | `/auth/users` | ADMIN | List users |
| POST | `/auth/users` | ADMIN | Create a user |
| PATCH | `/auth/users/:id` | ADMIN | Change role or active state |

## Students

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/students` | any | Paginated, filtered, sorted list |
| GET | `/students/filters` | any | Distinct values for the filter dropdowns |
| GET | `/students/search?q=` | any | Typeahead over name, ID, email, college, handles |
| GET | `/students/:id` | any | Full detail (accepts internal id or student ID) |
| GET | `/students/:id/platforms` | any | Platform profiles with capability flags |
| GET | `/students/:id/problems` | any | Paginated solved problems |
| GET | `/students/:id/topics` | any | Unified and per-platform topic counts |
| GET | `/students/:id/contests` | any | Contest results plus a summary |
| GET | `/students/:id/ratings` | any | Rating series per platform |
| GET | `/students/:id/history` | any | Dated snapshots for growth charts |
| GET | `/students/:id/analytics` | any | Materialized analytics and skills |
| POST | `/students/:id/score-preview` | any | Recompute the score under different weights |
| POST | `/students/compare` | any | Compare 2–10 students |
| POST | `/students/:id/refresh` | TRAINER | Queue a refresh for one student |
| POST | `/students/refresh` | TRAINER | Refresh a selection, batch, platform or everything |
| PATCH | `/students/:id` | TRAINER | Edit details and platform handles |
| DELETE | `/students/:id` | TRAINER | Delete a student and their data |

**List filters:** `search`, `university`, `college`, `batch`, `branch`,
`section`, `platform`, `status`, `minRating`, `maxRating`, `minSolved`,
`maxSolved`, `minContests`, `minScore`, `hasData`.
**Pagination:** `page`, `pageSize` (max 200), `sortBy`, `sortDir`.

## Uploads

`POST /api/students/upload` is an alias of `POST /api/uploads`.

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/uploads/fields` | TRAINER | Mappable fields with aliases |
| GET | `/uploads` | TRAINER | Recent uploads |
| POST | `/uploads` | TRAINER | Multipart `file`; returns preview, suggested mapping, validation |
| POST | `/uploads/:id/validate` | TRAINER | Re-validate with an edited mapping |
| POST | `/uploads/:id/commit` | TRAINER | Import and optionally start a job |
| DELETE | `/uploads/:id` | TRAINER | Discard an upload |

## Jobs

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/jobs` | any | Paginated job list |
| GET | `/jobs/queue-status` | any | Queue driver, waiting and active counts |
| GET | `/jobs/:id` | any | Progress, per-platform status, current student |
| GET | `/jobs/:id/items` | any | Every (student, platform) attempt with its error |
| POST | `/jobs/:id/retry` | TRAINER | Re-queue failed and rate-limited items |
| POST | `/jobs/:id/cancel` | TRAINER | Cancel pending items |
| GET | `/jobs/errors/recent` | any | Recent platform errors across all jobs |

## Analytics

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/analytics/overview` | any | Headline counts, distributions, platform coverage |
| GET | `/analytics/topics` | any | Unified topics plus a topic × platform heatmap |
| GET | `/analytics/difficulty` | any | Difficulty split and per-platform totals |
| GET | `/analytics/batch?batch=` | any | Batch dashboard |
| GET | `/analytics/university?groupBy=` | any | College or university comparison |
| GET | `/analytics/growth?days=` | any | Cohort growth trend |
| POST | `/analytics/recompute` | TRAINER | Rebuild all derived analytics |
| GET | `/leaderboard` | any | Ranked, filtered, sortable leaderboard |

All analytics endpoints accept the same filter parameters as `/students`.

## Reports

| Method | Path | Formats |
|---|---|---|
| GET | `/reports/student/:id?format=` | `pdf`, `xlsx`, `csv` |
| GET | `/reports/batch/:batch?format=` | `pdf`, `xlsx`, `csv` |
| GET | `/reports/leaderboard?format=` | `xlsx`, `csv` |
| GET | `/reports/failures?format=&jobId=` | `xlsx`, `csv` |

## Settings

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/settings` | any | All settings, defaults and runtime configuration |
| PATCH | `/settings/:key` | ADMIN | Update a setting; `recompute: true` rebuilds analytics |
| POST | `/settings/:key/reset` | ADMIN | Restore defaults; recomputes analytics for scoring keys unless `recompute: false` |
| GET | `/settings/platforms/meta` | any | Platform capabilities and how each is sourced |
| POST | `/settings/cache/purge` | ADMIN | Clear cached platform responses |

Keys: `scoring.weights`, `scoring.targets`, `skills.thresholds`,
`processing.limits`, `cache.settings`, `ui.platformColors`,
`processing.schedule`, `alerts.rules`.

Updating `alerts.rules` with `recompute: true` re-runs the rules against every
student and returns `realerted` — the number re-evaluated — alongside the usual
`recomputed`.

## Alerts

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/alerts` | any | Open alerts, most severe and longest-standing first |
| GET | `/alerts/types` | any | The alert catalogue with display labels |
| GET | `/alerts/summary` | any | Counts by severity and by type |
| POST | `/alerts/:id/acknowledge` | TRAINER | Acknowledge (`{"acknowledged": false}` reopens) |
| POST | `/alerts/recompute` | TRAINER | Re-run the rules for every student |

`/alerts` accepts the `/students` filters plus `type`, `severity`,
`includeAcknowledged`, `page` and `pageSize`. Every alert carries an `evidence`
object holding the two observations the rule compared, so the claim can be
checked rather than trusted.

Types: `NO_PROGRESS`, `RATING_DECLINE`, `CONTEST_INACTIVE`, `NO_DATA`,
`PROFILE_UNAVAILABLE`, `NO_PLATFORM_HANDLES`, `STALE_DATA`.

The last three describe our data, not the student. `STALE_DATA` also suppresses
`NO_PROGRESS` and `RATING_DECLINE` for that student: if we stopped fetching, we
cannot tell whether they stopped working.

Alerts are re-evaluated automatically whenever a student's analytics are
rebuilt, so a refresh keeps the list current without a separate call. An alert
is keyed on `(student, type)`, so `detectedAt` keeps answering "since when";
when a rule stops firing its alert is deleted rather than left to go stale.

## Schedule

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/schedule` | any | Schedule, next/previous run and the last 10 runs |
| POST | `/schedule/run-now` | TRAINER | Start a refresh immediately, outside the schedule |

`run-now` is independent of the schedule: it starts even when the day's slot has
already been used and even when automatic refresh is switched off. It returns
202 with the job when a refresh starts, 200 with a reason when it does not
(everything still inside the cache window, no handles on file).

## Goals

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/goals` | any | Active goals with cohort progress (`includeInactive=true` for archived) |
| GET | `/goals/metrics` | any | The metric catalogue with labels and decimal places |
| GET | `/goals/:id` | any | One goal with its progress |
| GET | `/goals/:id/students` | any | The students behind the roll-up |
| POST | `/goals` | TRAINER | Create a goal |
| PATCH | `/goals/:id` | TRAINER | Update it; passing `targets` replaces them wholesale |
| DELETE | `/goals/:id` | TRAINER | Delete it |
| GET | `/students/:id/goals` | any | Every active goal covering one student |

Metrics: `PROBLEMS_SOLVED`, `CONTESTS_ATTENDED`, `CP_SCORE`, `CONTEST_RATING`,
`TOPICS_COVERED`. Targets are absolute totals to reach, not gains.

A goal's scope is the set of `university` / `college` / `batch` / `branch` /
`section` fields it sets; a null field widens it, and all null means everyone.

Each student scores one of four outcomes per target:

| Outcome | Meaning |
|---|---|
| `MET` | At or above the target |
| `BEHIND` | Measurable and short, with `remaining` |
| `UNKNOWN` | No platform of theirs publishes this metric |
| `NO_DATA` | Nothing has ever been retrieved for them |

`metRate` is computed over `MET + BEHIND` only, and is **null**, never `0`, when
nobody in scope can be measured — 0% would read as "everybody failed" when what
happened is that nobody could be assessed. `/goals/:id/students` accepts
`metric` and `outcome` so every cohort figure opens into the names behind it,
including the unmeasurable ones.

`/students/:id/goals` additionally returns `requiredPerWeek` (arithmetic on the
shortfall and the deadline, not a prediction) and `observedGain` /
`observedOverDays` from dated snapshots — null when there are not two readings
to subtract.

## Student view links

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/shared/:token` | **none** | A student's own read-only view |
| GET | `/students/:id/share-link` | any | Whether a link exists and its usage |
| POST | `/students/:id/share-link` | TRAINER | Issue or regenerate; returns the URL **once** |
| DELETE | `/students/:id/share-link` | TRAINER | Revoke |
| POST | `/share-links` | TRAINER | Issue for a cohort, returning every URL once |
| GET | `/share-links` | any | Who has a link, and whether it has been opened |

`/shared/:token` is the only unauthenticated endpoint besides `/health`. It
carries its own rate limit (120 per 15 minutes) and returns exactly one
student's record: their platforms with real statuses, skills, topics, history,
goals and rank — never their email, phone, internal notes, or any other student.

Tokens are 32 random bytes stored **hashed**, like refresh tokens, so a database
read cannot produce a working link. That is why the URL is returned only at the
moment it is issued, and why a lost link is regenerated rather than recovered.

Revoked, expired, unknown and deleted all return the same 404 message: telling
an anonymous caller which case it was is free information about who exists.

`POST /share-links` skips students who already hold a live link unless
`regenerateExisting: true` — silently reissuing would break links already sitting
in inboxes. The response reports `issued` and `skipped`.

Set `APP_BASE_URL` to the address students reach the app on; without it links are
built from the first `CORS_ORIGIN`.

## Health

`GET /api/health` — no authentication. Returns 200 when the database is
reachable, 503 otherwise.
