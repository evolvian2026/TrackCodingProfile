/**
 * Regression guard for the session-refresh race.
 *
 * Refresh tokens rotate, so two concurrent refreshes would burn the token and
 * sign a valid user out. Every full page load and every extra tab triggers a
 * boot refresh, so this walks a long series of reloads and then loads two tabs
 * at once, asserting the session survives.
 *
 *   npm run e2e:session
 */
import { chromium } from 'playwright';
const BASE = process.env.E2E_WEB ?? 'http://localhost:5173';
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

let refreshCalls = 0, refresh401 = 0;
page.on('response', (r) => {
  if (r.url().includes('/api/auth/refresh')) { refreshCalls++; if (r.status() === 401) refresh401++; }
});

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', 'admin@tracker.local');
await page.fill('#password', 'Admin@12345');
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 20000 });
await page.waitForTimeout(1500);

// Every page.goto is a full reload -> AuthProvider remounts -> boot refresh.
// This is exactly what logged the session out before.
let loggedOut = 0;
const routes = ['/students', '/leaderboard', '/analytics', '/batches', '/colleges', '/jobs',
                '/platforms', '/settings', '/compare', '/upload', '/', '/students', '/analytics',
                '/leaderboard', '/batches', '/', '/jobs', '/settings'];
for (const route of routes) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (page.url().includes('/login')) { loggedOut++; console.log(`  LOGGED OUT while navigating to ${route}`); break; }
}

console.log(`reloads: ${routes.length}  refresh calls: ${refreshCalls}  refresh 401s: ${refresh401}  spurious logouts: ${loggedOut}`);

// Two tabs refreshing at once — the production version of the same race.
const t2 = await ctx.newPage();
await Promise.all([
  page.goto(`${BASE}/students`, { waitUntil: 'networkidle' }),
  t2.goto(`${BASE}/leaderboard`, { waitUntil: 'networkidle' }),
]);
await page.waitForTimeout(2000);
const bothOk = !page.url().includes('/login') && !t2.url().includes('/login');
console.log(`two tabs loading simultaneously stay signed in: ${bothOk}`);

await browser.close();
process.exitCode = loggedOut === 0 && bothOk ? 0 : 1;
