# Platform data sources

How each platform's public data is retrieved, what it exposes, and what it does
not. **Verify current availability before enabling `DATA_SOURCE=live`** —
undocumented endpoints change without notice, which is exactly why each platform
sits behind its own adapter.

---

## Codeforces — official public API

**Endpoint:** `https://codeforces.com/api/*` — <https://codeforces.com/apiHelp>

The only one of the four with a documented, supported public API. This adapter
never parses HTML.

| Call | Provides |
|---|---|
| `user.info` | Handle, name, country, rating, max rating, rank, contribution, friends |
| `user.rating` | Full contest history with rank and rating before/after |
| `user.status` | Every submission, with problem tags and problem rating |

**Difficulty** is derived from the problem's numeric rating (`≤1200` Easy,
`≤1900` Medium, above Hard); Codeforces has no Easy/Medium/Hard concept.
Unrated problems stay `UNKNOWN`. Only accepted submissions count as solved, and
the earliest accepted submission is kept as the solve date.

**Not available:** global rank (only the rank *title*, e.g. "expert").

---

## LeetCode — public GraphQL endpoint

**Endpoint:** `https://leetcode.com/graphql` (undocumented but unauthenticated)

This is the endpoint LeetCode's own public profile pages call. Only fields a
logged-out visitor can already see are requested.

**Available:** username, real name, country, avatar, global ranking, reputation;
solved counts by difficulty; total and accepted submissions; contest rating,
attendance, global ranking and top percentage; full contest history; topic
counts across the fundamental/intermediate/advanced buckets; recent accepted
submissions.

**Not available:** the full list of solved problems — LeetCode publishes
*counts*, never an enumerable list. The recent-submissions feed carries no
difficulty or tags, so those entries stay `UNKNOWN`.

Contest rating *changes* are derived locally, since LeetCode reports only the
post-contest rating.

---

## CodeChef — public profile page

**Endpoint:** `https://www.codechef.com/users/<handle>`

CodeChef publishes no API for user profiles. The public profile page is fetched
once and parsed. The contest history comes from the `all_rating` JSON array
CodeChef inlines to draw its own rating chart — the most stable structured data
on the page.

**Available:** current and highest rating, stars, global and country rank, total
problems solved, and the full contest history with rank and rating.

**Not available:** any topic or difficulty breakdown, and any per-problem list.

Parsing is deliberately defensive: any selector that stops matching yields
`null`, and a page with no recognizable statistics is reported as `UNAVAILABLE`
rather than as zeros. If CodeChef changes its markup, the adapter reports
missing data — it never reports wrong data.

---

## HackerRank — public REST endpoints

**Endpoint:** `https://www.hackerrank.com/rest/hackers/<username>/*`

These back the public profile page. HackerRank exposes far less than the other
three and is the most likely to block automated requests; expect
`RATE_LIMITED` or `UNAVAILABLE` in production more often than elsewhere.

**Available:** username, name, country, school, avatar; badges with per-track
stars, solved counts and scores; certificates.

**Derived:** total solved is summed from the per-track badge counters, because
HackerRank publishes no overall figure. The provenance is stored on the profile
(`raw.provenance = "derived:sum-of-public-badge-counters"`) so it is never
mistaken for a platform-reported number.

**Not available:** contest results, rating and rating history, global ranking,
per-problem lists. These are reported `UNAVAILABLE`, never guessed.

---

## Politeness

Every adapter shares one HTTP client that enforces:

- a token bucket per platform (LeetCode 20/min, CodeChef 10/min, HackerRank
  10/min, Codeforces 30/min by default, all configurable)
- exponential backoff with full jitter, capped
- `Retry-After` honoured and applied to the whole platform bucket
- a bounded retry count, after which the profile is marked and the run continues
- response caching in PostgreSQL (12 hours by default) so a large refresh does
  not re-fetch fresh data
- a descriptive `User-Agent` identifying the application

Failures never cascade: one platform being down for one student does not affect
any other student or platform.
