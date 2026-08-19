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
`processing.limits`, `cache.settings`, `ui.platformColors`.

## Health

`GET /api/health` — no authentication. Returns 200 when the database is
reachable, 503 otherwise.
