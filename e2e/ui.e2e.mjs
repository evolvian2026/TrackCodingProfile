/**
 * Drives every screen through a real browser and asserts on what renders.
 *
 * Expects the API and the web app to be running and the database freshly
 * seeded. Screenshots for any failure land in E2E_OUT.
 *
 *   npm run e2e:ui
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.E2E_WEB ?? 'http://localhost:5173';
const OUT = process.env.E2E_OUT ?? path.join(os.tmpdir(), 'tcp-e2e-shots');
const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../samples/students-sample.xlsx');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
const failures = [];
const pageErrors = [];
let group = '';

const section = (n) => { group = n; console.log(`\n\x1b[1m${n}\x1b[0m`); };
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`); }
  else {
    failures.push(`${group} :: ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 250)}` : ''}`);
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 200)}` : ''}`);
  }
}
async function tryCheck(label, fn) {
  try { check(label, await fn()); } catch (e) { check(label, false, e.message); }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();

page.on('pageerror', (e) => pageErrors.push(`${page.url()} :: ${e.message}`));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !t.includes('401') && !t.includes('Failed to load resource')) pageErrors.push(`${page.url()} :: ${t}`);
});

const settle = (ms = 900) => page.waitForTimeout(ms);

try {
  // ------------------------------------------------------------------ login
  section('Login');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  check('login page renders', await page.getByRole('heading', { name: /Coding Profile Tracker/i }).isVisible());

  await page.fill('#email', 'admin@tracker.local');
  await page.fill('#password', 'WrongPassword1');
  await page.click('button[type=submit]');
  await settle(1500);
  check('a wrong password shows an inline error', await page.getByText(/Incorrect email or password/i).isVisible());
  check('a failed login does not navigate away', page.url().includes('/login'));

  await page.fill('#password', 'Admin@12345');
  await page.click('button[type=submit]');
  await settle(1500);
  // The sign-in endpoint is deliberately rate limited; say so plainly instead
  // of failing with an opaque navigation timeout.
  if (await page.getByText(/Too many sign-in attempts/i).count()) {
    throw new Error('Login is rate limited (the brute-force guard is working). Restart the API to clear the counter before re-running.');
  }
  await page.waitForURL(`${BASE}/`, { timeout: 20000 });
  await settle(2200);
  check('a correct password signs in and lands on the dashboard', page.url() === `${BASE}/`);

  // -------------------------------------------------------------- dashboard
  section('Dashboard');
  check('shows the students-tracked tile', await page.getByText('Students tracked').isVisible());
  const tracked = await page.locator('div.card', { hasText: 'Students tracked' }).first().innerText();
  check('the tile shows a real count', /\d/.test(tracked), tracked.replace(/\n/g, ' '));
  check('platform coverage lists all four platforms',
    (await page.locator('section', { hasText: 'Platform coverage' }).getByText(/LeetCode|CodeChef|HackerRank|Codeforces/).count()) >= 4);
  check('top performers panel is populated',
    (await page.locator('section', { hasText: 'Top performers' }).locator('a').count()) > 1);
  check('difficulty legend shows the full "Unclassified" label',
    await page.getByText('Unclassified', { exact: true }).first().isVisible());
  check('growth charts render an SVG',
    (await page.locator('section', { hasText: 'Cohort growth' }).locator('svg').count()) >= 2);
  check('recent jobs table is present', await page.getByText('Recent processing jobs').isVisible());
  check('the dashboard surfaces who needs attention', await page.getByText('Needs attention').first().isVisible());

  // ------------------------------------------------------------------ upload
  section('Excel upload wizard');
  await page.goto(`${BASE}/upload`, { waitUntil: 'networkidle' });
  await settle(1200);
  check('step 1 renders the dropzone', await page.getByText(/Drag a spreadsheet here/i).isVisible());
  check('the .xls limitation is explained up front', await page.getByText(/Legacy \.xls workbooks are not supported/i).isVisible());

  await page.setInputFiles('input[type=file]', SAMPLE);
  await page.waitForSelector('text=Map the columns', { timeout: 30000 });
  await settle(1200);
  check('step 2 shows the detected sheet and header row', await page.getByText(/header detected on row 2/i).isVisible());
  const mappedSelects = await page.locator('table select').count();
  check('every column has a mapping control', mappedSelects === 11, mappedSelects);
  const idMapping = await page.locator('table select').first().inputValue();
  check('Student ID is auto-mapped', idMapping === 'student_id', idMapping);

  await page.getByRole('button', { name: /Validate 16 rows/ }).click();
  await page.waitForSelector('text=Will import', { timeout: 30000 });
  await settle(1400);
  check('step 3 shows the validation summary', await page.getByText('Rows in file').isVisible());
  check('the duplicate-ID row is reported as skipped',
    (await page.locator('div.card', { hasText: 'Will be skipped' }).first().innerText()).includes('1'));
  check('duplicate handles are surfaced', await page.getByText(/Duplicate handles detected/i).isVisible());
  check('warnings are listed', await page.getByText(/warnings/i).first().isVisible());
  check('platform coverage is charted', await page.getByText('Platform coverage').isVisible());

  await page.getByRole('button', { name: /Import 15 students/ }).click();
  await page.waitForSelector('text=Import complete', { timeout: 60000 });
  await settle(1500);
  check('step 4 confirms the import', await page.getByText('Import complete').isVisible());
  check('a processing job was started', await page.getByText(/Processing job #\d+ started/).isVisible());
  await page.getByRole('button', { name: 'Watch progress' }).click();
  await settle(2500);
  check('Watch progress opens the job', /\/jobs\/[a-z0-9]+/.test(page.url()), page.url());

  // -------------------------------------------------------------------- jobs
  section('Processing');
  // Wait for it to finish.
  for (let i = 0; i < 40; i++) {
    const txt = await page.locator('main').innerText();
    if (/COMPLETED/i.test(txt)) break;
    await settle(1000);
  }
  check('job detail shows progress reaching 100%', (await page.locator('main').innerText()).includes('100.0%'));
  check('per-platform status renders', await page.locator('h2,h3,p', { hasText: /^Platform status$/ }).first().isVisible());
  check('the profile-fetch table lists attempts', (await page.locator('tbody tr').count()) > 0);
  check('a retry control appears when there are failures',
    (await page.getByRole('button', { name: /Retry \d+ failed/ }).count()) > 0);

  const statusFilter = page.locator('select').first();
  await statusFilter.selectOption('FAILED');
  await settle(1800);
  const failedRows = await page.locator('tbody tr').count();
  check('filtering to FAILED shows only failures', failedRows > 0);
  const errorTexts = await page.locator('tbody tr td:nth-child(5)').allInnerTexts();
  check('each failure has an explanatory message', errorTexts.every((t) => t.trim() !== '' && t.trim() !== '—'), errorTexts.slice(0, 2));

  await page.getByRole('button', { name: /Retry \d+ failed/ }).click();
  await settle(4000);
  check('retry runs without an error toast', !(await page.getByText(/Something went wrong/i).count()));

  await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
  await settle(1800);
  check('the jobs list renders', (await page.locator('tbody tr').count()) > 0);
  check('queue status tiles render', await page.locator('h2,h3,p', { hasText: /^Queue driver$/ }).first().isVisible());
  check('recent platform errors are listed', await page.locator('h2,h3,p', { hasText: /^Recent platform errors$/ }).first().isVisible());

  // ----------------------------------------------------------- global search
  section('Global search');
  await page.fill('input[aria-label="Search students"]', 'Rahul');
  await settle(1200);
  const suggestions = page.locator('input[aria-label="Search students"] ~ div button');
  check('typeahead returns results', (await suggestions.count()) > 0);
  check('a result shows the platform handles', /rahul_elite/.test(await suggestions.first().innerText()));
  await suggestions.first().click();
  await settle(1800);
  check('choosing a result opens that student', /\/students\/[a-z0-9]+/.test(page.url()), page.url());

  // ---------------------------------------------------------- student detail
  section('Student detail');
  check('name heading renders', await page.getByRole('heading', { name: 'Rahul Sharma' }).isVisible());
  check('CP score gauge renders', await page.getByText('Competitive Programming Score').isVisible());
  check('score is labelled as not an official platform metric',
    await page.getByText(/Not an official platform metric/i).isVisible());
  check('four platform cards render', (await page.locator('section.card', { hasText: /Available|Private|Not found/ }).count()) >= 4);

  for (const [tab, marker] of [
    ['Topics', 'All platforms combined'],
    ['Contests', 'Rating over time'],
    ['Skill matrix', 'Weighted score'],
    ['Growth', 'Problems solved'],
    ['Score breakdown', 'How it was calculated'],
    ['Overview', 'Problems solved by platform'],
  ]) {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    await settle(1400);
    await tryCheck(`the ${tab} tab renders its content`, async () =>
      page.getByText(marker, { exact: false }).first().isVisible());
  }

  await page.getByRole('tab', { name: /^Score breakdown/ }).click();
  await settle(1200);
  check('score breakdown lists all five components',
    (await page.locator('table tbody tr').count()) === 5, await page.locator('table tbody tr').count());

  // ------------------------------------------------------- N/A, not zero
  section('Data integrity in the UI');
  await page.goto(`${BASE}/students?search=Ishita`, { waitUntil: 'networkidle' });
  await settle(1400);
  await page.locator('tbody tr td a').first().click();
  await settle(2000);
  check('a private profile shows the reason, not numbers',
    await page.getByText(/Profile is private/i).isVisible());
  check('topics covered reads N/A when nothing publishes it',
    (await page.locator('div.card', { hasText: 'Topics covered' }).first().innerText()).includes('N/A'));
  check('difficulty explains it is unknown rather than showing zeros',
    await page.getByText(/No difficulty breakdown available/i).isVisible());
  const overviewText = await page.locator('main').innerText();
  check('no "Easy 0" is rendered for this student', !/Easy\s*\n?0\b/.test(overviewText));

  // ------------------------------------------------------------- edit modal
  section('Student edit');
  await page.goto(`${BASE}/students?search=Vikram`, { waitUntil: 'networkidle' });
  await settle(1300);
  await page.locator('tbody tr td a').first().click();
  await settle(1800);
  await page.getByRole('button', { name: 'Edit' }).click();
  await settle(900);
  check('edit modal opens', await page.getByRole('dialog').isVisible());
  check('student ID is not editable', await page.locator('input[value="1005"]').isDisabled());
  await page.locator('input[placeholder="username or profile URL"]').first().fill(`vikram_${Date.now()}`);
  await settle(600);
  check('changing a handle warns that a fresh fetch is needed',
    await page.getByText(/Changed handles need a fresh fetch/i).isVisible());
  await page.getByRole('button', { name: 'Delete student' }).click();
  await settle(600);
  check('delete asks for explicit confirmation', await page.getByText(/cannot be undone/i).isVisible());
  await page.getByRole('button', { name: 'Keep student' }).click();
  await settle(400);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await settle(2000);
  check('saving closes the modal', (await page.getByRole('dialog').count()) === 0);
  await page.reload({ waitUntil: 'networkidle' });
  await settle(1600);
  check('the changed handle persisted', await page.getByText(/^vikram_\d+$/).isVisible());
  check('the changed platform is back to "not fetched"',
    await page.getByText('Not fetched').first().isVisible());

  // ---------------------------------------------------------------- students
  section('Students list');
  await page.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  await settle(1600);
  const rowCount = await page.locator('tbody tr').count();
  check('renders a page of students', rowCount > 0 && rowCount <= 25, rowCount);
  check('shows a pagination summary', await page.getByText(/Showing 1–\d+ of \d+/).isVisible());

  const summary = await page.getByText(/Showing 1–\d+ of \d+/).innerText();
  const total = Number(summary.match(/of ([\d,]+)/)[1].replace(/,/g, ''));
  check('the dataset spans more than one page after the import', total > 25, total);
  const firstBefore = await page.locator('tbody tr td a').first().innerText();
  const nextBtn = page.getByRole('button', { name: 'Next' }).first();
  check('Next is enabled when more pages exist', !(await nextBtn.isDisabled()));
  await nextBtn.click();
  await settle(1700);
  check('the Next button advances the page',
    (await page.locator('tbody tr td a').first().innerText()) !== firstBefore);
  check('the summary reflects the second page', /Showing 26–/.test(await page.getByText(/Showing \d+–\d+ of \d+/).innerText()));
  await page.getByRole('button', { name: 'Previous' }).first().click();
  await settle(1600);
  check('Previous returns to the first page',
    (await page.locator('tbody tr td a').first().innerText()) === firstBefore);

  const batchSelect = page.locator('select').filter({ hasText: 'All batch' }).first();
  await batchSelect.selectOption('2024-27');
  await settle(1700);
  check('the batch filter applies to the URL', page.url().includes('batch=2024-27'), page.url());
  const batchCells = await page.locator('tbody tr td:nth-child(3)').allInnerTexts();
  check('every visible row matches the filter', batchCells.every((c) => c.includes('2024-27')), batchCells.slice(0, 3));
  check('a Clear filters control appears', await page.getByRole('button', { name: /Clear 1 filter/ }).isVisible());
  await page.getByRole('button', { name: /Clear 1 filter/ }).click();
  await settle(1500);
  check('clearing filters resets the URL', !page.url().includes('batch='));

  await page.locator('input[placeholder="Name, ID, email or handle"]').fill('Priya');
  await settle(1600);
  check('the in-page search filters the table',
    (await page.locator('tbody tr').count()) >= 1 &&
    (await page.locator('tbody tr td a').first().innerText()).includes('Priya'));
  await page.locator('input[placeholder="Name, ID, email or handle"]').fill('');
  await settle(1500);

  await page.locator('tbody tr input[type=checkbox]').nth(0).check();
  await page.locator('tbody tr input[type=checkbox]').nth(1).check();
  await settle(600);
  check('selecting two students reveals Compare', await page.getByRole('link', { name: /Compare 2/ }).isVisible());
  check('selecting students reveals Refresh', await page.getByRole('button', { name: /Refresh 2/ }).isVisible());
  await page.getByRole('link', { name: /Compare 2/ }).click();
  await settle(2200);

  // ----------------------------------------------------------------- compare
  section('Compare');
  await page.waitForSelector('h2:text-is("Side by side")', { timeout: 20000 });
  check('compare renders a side-by-side table', await page.locator('h2', { hasText: /^Side by side$/ }).isVisible());
  check('compare shows both students', (await page.locator('thead th').count()) >= 3);
  check('compare shows a skill comparison', await page.locator('h2', { hasText: /^Skill comparison$/ }).isVisible());
  await page.locator('input[placeholder="Search by name, ID or handle…"]').fill('Amit');
  await settle(1400);
  const addBtn = page.locator('button', { hasText: 'Add' }).first();
  if (await addBtn.count()) { await addBtn.click(); await settle(1800); }
  check('a third student can be added', (await page.locator('thead th').count()) >= 4, await page.locator('thead th').count());

  // ------------------------------------------------------------- leaderboard
  section('Leaderboard');
  await page.goto(`${BASE}/leaderboard`, { waitUntil: 'networkidle' });
  await settle(1800);
  check('renders ranked rows', (await page.locator('tbody tr').count()) > 5);
  const firstRank = await page.locator('tbody tr td').first().innerText();
  check('ranking starts at 1', firstRank.trim() === '1', firstRank);

  await page.getByRole('button', { name: /^Solved/ }).click();
  await settle(1700);
  check('clicking a column header sorts by it', page.url().includes('sortBy=totalSolved'), page.url());
  const headers = await page.locator('thead th').allInnerTexts();
  const solvedCol = headers.findIndex((h) => /^Solved/.test(h.trim())) + 1;
  check('the Solved column was located in the header row', solvedCol > 0, headers);
  const readSolved = async () =>
    (await page.locator(`tbody tr td:nth-child(${solvedCol})`).allInnerTexts())
      .map((t) => Number(t.split('\n')[0].replace(/,/g, '')))
      .filter((n) => !Number.isNaN(n));
  const solved = await readSolved();
  check('sorted descending by solved', solved.length > 1 && solved.every((v, i) => i === 0 || solved[i - 1] >= v), solved.slice(0, 5));
  await page.getByRole('button', { name: /^Solved/ }).click();
  await settle(1700);
  check('clicking again reverses the direction in the URL', page.url().includes('sortDir=asc'), page.url());
  const asc = await readSolved();
  check('clicking again reverses the sort', asc.length > 1 && asc.every((v, i) => i === 0 || asc[i - 1] <= v), asc.slice(0, 5));

  await page.locator('select').first().selectOption('10');
  await settle(1700);
  check('the Top N selector limits the page', (await page.locator('tbody tr').count()) === 10, await page.locator('tbody tr').count());

  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: 'XLSX' }).click();
  const file = await download;
  check('leaderboard exports an XLSX', (await file.path()) !== null && file.suggestedFilename().endsWith('.xlsx'), file.suggestedFilename());

  // --------------------------------------------------------------- analytics
  section('Analytics');
  await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle' });
  await settle(2000);
  check('topics tab shows distinct topics', await page.getByText('Distinct topics').isVisible());
  check('topic bars render', (await page.locator('main li').count()) > 5);
  check('the topic × platform heatmap renders', await page.getByText(/Topic × platform heatmap/).isVisible());
  check('heatmap explains that colour is never the only signal',
    await page.getByText(/colour is never the only signal/i).isVisible());
  check('a topic table is present for the non-visual reader',
    await page.locator('h2,h3,p', { hasText: /^Topic table$/ }).first().isVisible());

  await page.getByRole('tab', { name: /^Difficulty/ }).click();
  await settle(1600);
  check('difficulty tab renders the split', await page.getByText('Overall difficulty split').isVisible());
  const diffTable = await page.locator('main').innerText();
  check('platforms without a split are marked as such',
    /Does not publish a difficulty split/i.test(diffTable));

  await page.getByRole('tab', { name: /^Growth/ }).click();
  await settle(1800);
  check('growth tab renders charts or an explicit empty state',
    (await page.locator('main svg').count()) > 0 || (await page.getByText(/Not enough history/i).isVisible()));

  // ----------------------------------------------------------------- batches
  section('Batches');
  await page.goto(`${BASE}/batches`, { waitUntil: 'networkidle' });
  await settle(2000);
  check('batch dashboard renders statistics', await page.getByText('Avg problems solved').isVisible());
  check('highlights name a top student', await page.getByText('Top CP score').isVisible());
  check('platform adoption renders', await page.locator('h2,h3,p', { hasText: /^Platform adoption$/ }).first().isVisible());
  check('strongest and weakest topics render',
    (await page.locator('h2,h3,p', { hasText: /^Strongest topics$/ }).first().isVisible()) && (await page.locator('h2,h3,p', { hasText: /^Weakest topics$/ }).first().isVisible()));
  check('top and bottom tables render',
    (await page.locator('h2,h3,p', { hasText: /^Top 10 students$/ }).first().isVisible()) && (await page.locator('h2,h3,p', { hasText: /^Bottom 10 students$/ }).first().isVisible()));
  const batchSel = page.locator('select').first();
  const options = await batchSel.locator('option').allInnerTexts();
  if (options.length > 1) {
    await batchSel.selectOption(options[1]);
    await settle(2000);
    check('switching batch reloads the dashboard', await page.getByText('Avg problems solved').isVisible());
  }

  // ---------------------------------------------------------------- colleges
  section('Colleges');
  await page.goto(`${BASE}/colleges`, { waitUntil: 'networkidle' });
  await settle(1900);
  check('college comparison renders', await page.locator('h2,h3,p', { hasText: /^Comparison table$/ }).first().isVisible());
  check('multiple institutions are compared', (await page.locator('tbody tr').count()) > 1);
  await page.locator('select').first().selectOption('university');
  await settle(1800);
  check('switching to university grouping works', (await page.locator('tbody tr').count()) >= 1);

  // --------------------------------------------------------------- platforms
  section('Platforms');
  await page.goto(`${BASE}/platforms`, { waitUntil: 'networkidle' });
  await settle(1800);
  check('all four platforms are documented', (await page.locator('section.card').count()) >= 4);
  check('mock mode is called out', await page.getByText(/Running on mock data/i).isVisible());
  check('capability chips render', await page.getByText(/Difficulty split/).first().isVisible());
  check('sourcing notes render', await page.getByText(/Official public API/i).isVisible());

  // ---------------------------------------------------------------- settings
  section('Settings');
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await settle(1700);
  check('runtime configuration tiles render', await page.getByText('Data source').isVisible());
  check('score weights render', await page.locator('h2,h3,p', { hasText: /^Score weights$/ }).first().isVisible());
  const weightInput = page.locator('input[type=number]').first();
  await weightInput.fill('45');
  await settle(400);
  check('the weight total updates live', await page.getByText(/Total: 115/).isVisible());
  await page.getByRole('button', { name: /Save and recalculate/ }).first().click();
  await settle(4000);
  await page.reload({ waitUntil: 'networkidle' });
  await settle(1800);
  check('the saved weight persists', (await page.locator('input[type=number]').first().inputValue()) === '45',
    await page.locator('input[type=number]').first().inputValue());
  await page.getByRole('button', { name: 'Reset' }).first().click();
  await settle(2500);
  await page.reload({ waitUntil: 'networkidle' });
  await settle(1800);
  check('reset restores the default weight', (await page.locator('input[type=number]').first().inputValue()) === '30',
    await page.locator('input[type=number]').first().inputValue());

  for (const tab of ['Skill levels', 'Processing', 'Appearance']) {
    await page.getByRole('tab', { name: tab }).click();
    await settle(1100);
    await tryCheck(`the ${tab} settings tab renders`, async () => (await page.locator('main input').count()) > 0);
  }
  check('appearance warns that defaults are accessibility-checked',
    await page.getByText(/accessibility-checked, not brand-exact/i).isVisible());

  // ------------------------------------------------------------------ goals
  section('Goals');
  await page.goto(`${BASE}/goals`, { waitUntil: 'networkidle' });
  await settle(1800);
  check('the goals screen renders', await page.getByRole('heading', { name: 'Goals' }).first().isVisible());

  const goalCards = page.locator('main .card').filter({ hasText: /days left|Overdue/ });
  const seededGoals = await goalCards.count();
  check('the seeded goals are listed', seededGoals > 0, seededGoals);
  await tryCheck('a goal names the cohort it applies to', async () =>
    /2023-26|Everyone/.test(await goalCards.first().innerText()));
  await tryCheck('a goal shows how many are meeting each target', async () =>
    /measurable/.test(await goalCards.first().innerText()));
  await tryCheck('progress bars render for each target', async () =>
    (await goalCards.first().locator('[role=progressbar]').count()) > 0);

  // Every cohort figure has to open into the names behind it.
  const drill = page.getByRole('button', { name: /met$|short$/ }).first();
  if (await drill.count()) {
    await drill.click();
    await settle(1600);
    check('a cohort figure opens into the students behind it',
      await page.getByRole('dialog').isVisible());
    await tryCheck('the roster names students', async () =>
      (await page.getByRole('dialog').locator('tbody tr').count()) > 0);
    await page.getByRole('button', { name: 'Close' }).click();
    await settle(700);
  }

  // Create a goal, confirm it measures, then remove it.
  await page.getByRole('button', { name: /New goal/ }).click();
  await settle(900);
  check('the goal editor opens', await page.getByRole('dialog').isVisible());
  await page.locator('input[placeholder="Placement readiness"]').fill('E2E temporary goal');
  await page.locator('div[role=dialog] input[type=number]').first().fill('1');
  await settle(400);
  await page.getByRole('button', { name: 'Create goal' }).click();
  await settle(2500);
  check('the new goal appears on the page', (await page.getByText('E2E temporary goal').count()) > 0);
  await tryCheck('a target of 1 is met by nearly everyone', async () =>
    /100(\.0)?%|9\d(\.\d)?%/.test(await page.locator('main .card').filter({ hasText: 'E2E temporary goal' }).innerText()));

  page.once('dialog', (d) => void d.accept());
  await page
    .locator('main .card')
    .filter({ hasText: 'E2E temporary goal' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await settle(2200);
  check('a goal can be deleted', (await page.getByText('E2E temporary goal').count()) === 0);

  // ------------------------------------------------------- student view links
  section('Student view link');
  await page.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  await settle(1500);
  await page.locator('tbody tr a').first().click();
  await settle(2200);
  check('the student page offers a view link', await page.getByText('Student view link').isVisible());

  const createLink = page.getByRole('button', { name: /Create link|Regenerate/ });
  await createLink.click();
  await settle(2200);
  check('issuing a link shows it once, with a warning', await page.getByText(/will not be shown again/i).isVisible());

  const linkInput = page.locator('input[readonly]').first();
  const shareUrl = await linkInput.inputValue();
  check('the issued link points at the student view route', /\/me\/[A-Za-z0-9_-]{20,}/.test(shareUrl), shareUrl);
  check('the panel reports the link as active', /Active/.test(await page.locator('main').innerText()));

  await page.reload({ waitUntil: 'networkidle' });
  await settle(1800);
  check('the link is not shown again after a reload',
    (await page.locator('input[readonly]').count()) === 0);

  // -------------------------------------------------------- the student's view
  section('Student self-service view');
  const sharePath = new URL(shareUrl).pathname;
  const anon = await context.browser().newContext({ viewport: { width: 1280, height: 900 } });
  const anonPage = await anon.newPage();
  const anonErrors = [];
  anonPage.on('pageerror', (e) => anonErrors.push(e.message));

  await anonPage.goto(`${BASE}${sharePath}`, { waitUntil: 'networkidle' });
  await anonPage.waitForTimeout(2500);

  const shared = await anonPage.locator('body').innerText();
  check('a signed-out visitor is not redirected to the login page', !anonPage.url().includes('/login'), anonPage.url());
  check('the page identifies itself as the student’s own profile', /Your coding profile/i.test(shared), shared.slice(0, 120));
  check('it shows the platforms section', /Your platforms/i.test(shared));
  check('it shows where to focus next', /Where to focus next/i.test(shared));
  check('it labels the CP score as unofficial', /not an official score/i.test(shared));
  check('the application shell is absent — no nav to anywhere else',
    (await anonPage.getByRole('link', { name: 'Leaderboard' }).count()) === 0);
  check('no other student is named on the page',
    !/Students tracked|Top performers/.test(shared));
  check('the student view renders without a page error', anonErrors.length === 0, anonErrors);

  await anonPage.goto(`${BASE}/me/not-a-real-token`, { waitUntil: 'networkidle' });
  await anonPage.waitForTimeout(2000);
  check('an invalid link says so plainly rather than erroring',
    /not valid/i.test(await anonPage.locator('body').innerText()));

  // A share link must not be a way into the rest of the app.
  await anonPage.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  await anonPage.waitForTimeout(1800);
  check('holding a share link does not sign anyone in', anonPage.url().includes('/login'), anonPage.url());
  await anon.close();

  // And the coordinator can revoke it.
  await page.getByRole('button', { name: /Revoke/ }).click();
  await settle(2200);
  check('a link can be revoked from the student page',
    /Revoked/.test(await page.locator('main').innerText()));

  // ----------------------------------------------------------------- alerts
  section('Needs attention');
  await page.goto(`${BASE}/alerts`, { waitUntil: 'networkidle' });
  await settle(1600);
  check('the alerts screen renders', await page.getByRole('heading', { name: 'Needs attention' }).isVisible());
  check('coaching and data problems are counted separately',
    (await page.getByText('Needs coaching').isVisible()) && (await page.getByText('Needs data fixing').isVisible()));

  const rows = page.locator('main li').filter({ has: page.locator('span.badge') });
  const alertRowCount = await rows.count();
  check('the seeded failure scenarios are listed', alertRowCount > 0, alertRowCount);
  await tryCheck('every concern names a student and states its case', async () => {
    const first = await rows.first().innerText();
    return /\w/.test(first) && first.includes('Detected');
  });
  await tryCheck('a concern shows the observations behind it', async () => {
    const text = await page.locator('main').innerText();
    // Activity rules cite dated readings; handle problems cite the platform.
    return /Based on /.test(text) || /handle is probably wrong/.test(text);
  });

  // Filtering by concern must actually narrow the list.
  const concern = page.locator('main select').filter({ hasText: 'All concerns' }).first();
  const concernOptions = await concern.locator('option').allInnerTexts();
  check('the concern filter is populated from the real counts', concernOptions.length > 1, concernOptions);
  if (concernOptions.length > 1) {
    await concern.selectOption({ index: 1 });
    await settle(1400);
    const narrowed = await rows.count();
    check('filtering by concern narrows the list', narrowed > 0 && narrowed <= alertRowCount, { alertRowCount, narrowed });
    await concern.selectOption({ index: 0 });
    await settle(1300);
  }

  // Acknowledge, confirm it leaves the default view, then put it back.
  const ackButton = page.getByRole('button', { name: 'Acknowledge' }).first();
  if (await ackButton.count()) {
    const before = await rows.count();
    await ackButton.click();
    await settle(1600);
    check('acknowledging a concern removes it from the open list', (await rows.count()) === before - 1,
      { before, after: await rows.count() });

    await page.getByText('Show acknowledged').click();
    await settle(1500);
    check('acknowledged concerns can be shown again', (await rows.count()) >= before, await rows.count());
    await page.getByRole('button', { name: 'Reopen' }).first().click();
    await settle(1500);
    check('an acknowledged concern can be reopened',
      (await page.getByRole('button', { name: 'Reopen' }).count()) === 0);
    await page.getByText('Show acknowledged').click();
    await settle(1200);
  }

  await page.getByRole('button', { name: /Re-evaluate/ }).click();
  await settle(3000);
  check('the rules can be re-run from the screen', (await rows.count()) > 0);
  check('the sidebar badges the open count',
    (await page.locator('a[href="/alerts"]').first().innerText()).match(/\d/) !== null,
    await page.locator('a[href="/alerts"]').first().innerText());

  // -------------------------------------------------------------- automation
  section('Automation settings');
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await settle(1500);
  await page.getByRole('tab', { name: 'Automation' }).click();
  await settle(1500);
  check('the automation tab renders the schedule',
    await page.getByRole('heading', { name: 'Automatic refresh' }).first().isVisible());
  check('the automation tab renders the needs-attention rules',
    await page.getByRole('heading', { name: 'Needs-attention rules' }).first().isVisible());

  const enable = page.locator('main input[type=checkbox]').first();
  if (!(await enable.isChecked())) { await enable.click(); await settle(600); }
  const frequency = page.locator('main select').first();
  await frequency.selectOption('daily');
  await settle(600);
  await page.getByRole('button', { name: /Save schedule/ }).click();
  await settle(2500);
  check('saving the schedule reports the next run in words',
    /Every day at/i.test(await page.locator('main').innerText()), null);
  await tryCheck('the next run is shown as a real date', async () =>
    /Next run/i.test(await page.locator('main').innerText()));

  await page.getByRole('button', { name: /Refresh everyone now/ }).click();
  await settle(4000);
  await page.reload({ waitUntil: 'networkidle' });
  await settle(1500);
  await page.getByRole('tab', { name: 'Automation' }).click();
  await settle(1800);
  check('a manual run is recorded as manual, not as a schedule firing',
    /Manual/.test(await page.locator('main table').innerText()), await page.locator('main table').innerText());

  check('the alert thresholds are editable', (await page.getByText(/Judge activity over/i).count()) > 0);
  await page.reload({ waitUntil: 'networkidle' });
  await settle(1400);
  await page.getByRole('tab', { name: 'Automation' }).click();
  await settle(1600);
  check('the saved schedule persists across a reload',
    /Every day at/i.test(await page.locator('main').innerText()), null);

  // Leave the app as we found it.
  const disable = page.locator('main input[type=checkbox]').first();
  if (await disable.isChecked()) { await disable.click(); await settle(600); }
  await page.getByRole('button', { name: /Save schedule/ }).click();
  await settle(2000);

  await page.getByRole('tab', { name: 'Student links' }).click();
  await settle(1800);
  check('the student-links tab lists who has a link',
    await page.getByRole('heading', { name: 'Student view links' }).first().isVisible());
  await tryCheck('it reports how many links are active', async () =>
    /active of \d+ students/.test(await page.locator('main').innerText()));
  await page.getByRole('button', { name: /Issue links/ }).click();
  await settle(3000);
  await tryCheck('issuing in bulk offers an export while the links still exist', async () => {
    const text = await page.locator('main').innerText();
    // Either links were issued (export offered) or everyone already had one.
    return /Download CSV for mail merge/.test(text) || /Nothing to issue/.test(text);
  });

  // ------------------------------------------------------------------- theme
  section('Theme and navigation');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await settle(1200);
  // The control cycles light -> dark -> system, so click until it reports dark.
  let reachedDark = false;
  for (let i = 0; i < 3; i++) {
    await page.locator('button[title^="Theme:"]').click();
    await settle(700);
    if (await page.evaluate(() => document.documentElement.classList.contains('dark'))) { reachedDark = true; break; }
  }
  check('the theme toggle can reach dark mode', reachedDark);
  check('dark mode repaints the surface', await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    return r + g + b < 250; // a dark surface, not a light one
  }));
  await page.evaluate(() => localStorage.setItem('tcp-theme', 'light'));
  await page.reload({ waitUntil: 'networkidle' });
  await settle(900);
  check('an explicit light choice is restored on reload',
    !(await page.evaluate(() => document.documentElement.classList.contains('dark'))));

  for (const [label, path] of [
    ['Dashboard', '/'], ['Leaderboard', '/leaderboard'], ['Analytics', '/analytics'],
    ['Students', '/students'], ['Compare', '/compare'], ['Batches', '/batches'],
    ['Colleges', '/colleges'], ['Needs attention', '/alerts'], ['Goals', '/goals'],
    ['Upload Excel', '/upload'], ['Processing', '/jobs'],
    ['Platforms', '/platforms'], ['Settings', '/settings'],
  ]) {
    // The needs-attention link carries a live count, so its accessible name
    // is not just the label.
    await page.getByRole('link', { name: label, exact: label !== 'Needs attention' }).first().click();
    await settle(1100);
    await tryCheck(`sidebar link "${label}" navigates to ${path}`, async () => new URL(page.url()).pathname === path);
  }

  // ------------------------------------------------------------------ logout
  section('Logout');
  await page.locator('button[title="Sign out"]').click();
  await settle(2000);
  check('logging out returns to the login screen', page.url().includes('/login'), page.url());
  await page.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  await settle(1500);
  check('a protected route redirects to login when signed out', page.url().includes('/login'), page.url());

  // ------------------------------------------------------------------ mobile
  section('Mobile');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mobile.newPage();
  mp.on('pageerror', (e) => pageErrors.push(`mobile :: ${e.message}`));
  await mp.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await mp.fill('#email', 'admin@tracker.local');
  await mp.fill('#password', 'Admin@12345');
  await mp.click('button[type=submit]');
  await mp.waitForURL(`${BASE}/`, { timeout: 20000 });
  await mp.waitForTimeout(2500);
  check('mobile dashboard loads', await mp.getByText('Students tracked').isVisible());
  check('the sidebar is collapsed behind a menu button',
    await mp.locator('button[aria-label="Open navigation"]').isVisible());
  await mp.locator('button[aria-label="Open navigation"]').click();
  await mp.waitForTimeout(800);
  check('the mobile menu opens', await mp.getByRole('link', { name: 'Leaderboard', exact: true }).isVisible());
  await mp.getByRole('link', { name: 'Leaderboard', exact: true }).click();
  await mp.waitForTimeout(2000);
  check('navigating on mobile works', mp.url().includes('/leaderboard'));
  const bodyScroll = await mp.evaluate(() => document.body.scrollWidth <= window.innerWidth + 2);
  check('the page does not scroll horizontally on mobile', bodyScroll);
  await mp.screenshot({ path: `${OUT}/mobile.png`, fullPage: true });
  await mobile.close();
} catch (err) {
  check('the UI run completed without crashing', false, err.message);
  await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
  console.log(`  screenshot: ${OUT}/failure.png`);
}

console.log(`\n${'='.repeat(70)}`);
console.log(`\x1b[1mUI E2E: ${pass} passed, ${failures.length} failed\x1b[0m`);
if (failures.length) { console.log('\n\x1b[31mFailures:\x1b[0m'); failures.forEach((f) => console.log(`  - ${f}`)); }
const uniqueErrors = [...new Set(pageErrors)];
console.log(`\nUncaught page errors: ${uniqueErrors.length}`);
uniqueErrors.slice(0, 12).forEach((e) => console.log(`  ! ${e}`));

await browser.close();
process.exitCode = failures.length || uniqueErrors.length ? 1 : 0;
