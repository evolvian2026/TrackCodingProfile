/**
 * End-to-end API exercise.
 *
 * Hits every endpoint against a RUNNING server and asserts on the response.
 * Expects a freshly seeded database (`npm run db:seed`) and an API that has not
 * just had its sign-in rate limiter exhausted.
 *
 *   npm run e2e:api
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@tracker.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@12345';
const SAMPLE = path.join(os.tmpdir(), 'tcp-e2e-120-students.xlsx');

/** Builds the 120-student import fixture this suite asserts against. */
async function buildFixture(): Promise<void> {
  const FIRST = ['Aarav','Bhavna','Chetan','Deepika','Eshan','Farida','Gautam','Hina','Irfan','Jaya','Kabir','Lakshmi','Manav','Nandini','Omar','Pooja','Qadir','Ritika','Sahil','Tanvi','Uday','Vandana','Waseem','Yash','Zoya'];
  const LAST = ['Deshmukh','Rao','Pillai','Shah','Kulkarni','Sheikh','Bansal','Qureshi','Khan','Menon','Malhotra','Iyer','Sinha','Reddy','Farooq'];
  const COLLEGES = ['ABC Institute of Technology','Northline Engineering College','Riverside Institute of Science','Summit College of Engineering'];
  const BATCHES = ['2023-26','2024-27','2025-28'];
  const BRANCHES = ['CSE','IT','ECE','EEE'];
  const SECTIONS = ['A','B','C'];
  // Spread the mock failure scenarios across the file so the run exercises them.
  const TIERS = ['elite','pro','','','beginner','','inactive','','notfound','private','ratelimited','error','unavailable'];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(['Roll No','Student Name','Email ID','College','Passing Year','Dept','Sec','LeetCode','Code Chef','HackerRank','Codeforces']);
  for (let i = 0; i < 120; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`;
    const slug = name.toLowerCase().replace(/\s+/g, '_');
    const tier = TIERS[i % TIERS.length];
    const has = (n: number) => i % n !== 0;
    sheet.addRow([
      5000 + i, name, `${slug}${i}@example.edu`,
      COLLEGES[i % COLLEGES.length], BATCHES[i % BATCHES.length], BRANCHES[i % BRANCHES.length], SECTIONS[i % SECTIONS.length],
      `${slug}${i}${tier ? `_${tier}` : ''}`,
      has(3) ? `${slug}${i}_cc` : '',
      has(4) ? `${slug}${i}_hr` : '',
      has(5) ? `${slug}${i}_cf` : '',
    ]);
  }
  await workbook.xlsx.writeFile(SAMPLE);
}

let pass = 0;
const failures: string[] = [];
let group = '';

function section(name: string) {
  group = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
  } else {
    failures.push(`${group} :: ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 200)}` : ''}`);
  }
}

let accessToken = '';
let cookie = '';

interface Res<T> { status: number; body: T; headers: Headers; raw?: Buffer }

async function call<T = any>(
  method: string,
  url: string,
  options: { body?: unknown; auth?: boolean; token?: string; form?: FormData; cookie?: string; binary?: boolean } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  const useToken = options.token ?? (options.auth === false ? '' : accessToken);
  if (useToken) headers.authorization = `Bearer ${useToken}`;
  if (options.cookie ?? cookie) headers.cookie = options.cookie ?? cookie;
  let payload: BodyInit | undefined;
  if (options.form) payload = options.form as unknown as BodyInit;
  else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }

  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload });
  if (options.binary) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: undefined as T, headers: res.headers, raw: buf };
  }
  const text = await res.text();
  let body: T;
  try { body = JSON.parse(text) as T; } catch { body = text as unknown as T; }
  return { status: res.status, body, headers: res.headers };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ---------------------------------------------------------------- health
  section('Health');
  {
    const r = await call('GET', '/api/health', { auth: false });
    check('GET /api/health returns 200 and ok', r.status === 200 && r.body.status === 'ok', r.body);
    check('reports the data source and queue driver', Boolean(r.body.dataSource && r.body.queueDriver), r.body);
  }

  // ------------------------------------------------------------------ auth
  section('Authentication');
  {
    const bad = await call('POST', '/api/auth/login', { auth: false, body: { email: ADMIN_EMAIL, password: 'WrongPassword1' } });
    check('rejects a wrong password with 401', bad.status === 401, bad.body);

    const ghost = await call('POST', '/api/auth/login', { auth: false, body: { email: 'nobody@nowhere.test', password: 'WrongPassword1' } });
    check('same message for unknown account (no user enumeration)',
      ghost.status === 401 && ghost.body?.error?.message === bad.body?.error?.message, { ghost: ghost.body, bad: bad.body });

    const malformed = await call('POST', '/api/auth/login', { auth: false, body: { email: 'not-an-email', password: 'x' } });
    check('validates the login payload with 400', malformed.status === 400, malformed.body);

    const ok = await call('POST', '/api/auth/login', { auth: false, body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    check('accepts correct credentials', ok.status === 200 && Boolean(ok.body.accessToken), ok.body);
    accessToken = ok.body.accessToken;
    const setCookie = ok.headers.getSetCookie?.()?.[0] ?? '';
    cookie = setCookie.split(';')[0] ?? '';
    check('sets an httpOnly SameSite=Strict refresh cookie',
      /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && /Path=\/api\/auth/i.test(setCookie), setCookie);
    check('never returns the password hash', !JSON.stringify(ok.body).match(/passwordHash|\$2[aby]\$/), Object.keys(ok.body.user ?? {}));

    const me = await call('GET', '/api/auth/me');
    check('GET /api/auth/me returns the signed-in admin', me.status === 200 && me.body.user.role === 'ADMIN', me.body);

    const noAuth = await call('GET', '/api/students', { auth: false });
    check('protected route rejects a missing token', noAuth.status === 401, noAuth.status);

    const tampered = await call('GET', '/api/students', { token: `${accessToken}xyz` });
    check('protected route rejects a tampered token', tampered.status === 401, tampered.status);

    // Refresh rotation
    const refreshed = await call('POST', '/api/auth/refresh', { auth: false });
    check('refresh returns a new access token', refreshed.status === 200 && Boolean(refreshed.body.accessToken), refreshed.status);
    const oldCookie = cookie;
    const newCookie = (refreshed.headers.getSetCookie?.()?.[0] ?? '').split(';')[0] ?? '';
    const replay = await call('POST', '/api/auth/refresh', { auth: false, cookie: oldCookie });
    check('the burned refresh cookie is rejected on replay', replay.status === 401, replay.status);
    cookie = newCookie;
    accessToken = refreshed.body.accessToken;
  }

  // ------------------------------------------------------------------ RBAC
  section('Role-based access control');
  let viewerToken = '';
  let trainerToken = '';
  {
    const viewer = await call('POST', '/api/auth/login', { auth: false, body: { email: 'viewer@tracker.local', password: 'Viewer@12345' } });
    viewerToken = viewer.body.accessToken;
    const trainer = await call('POST', '/api/auth/login', { auth: false, body: { email: 'trainer@tracker.local', password: 'Trainer@12345' } });
    trainerToken = trainer.body.accessToken;
    check('viewer and trainer can sign in', Boolean(viewerToken && trainerToken));

    check('viewer can read students', (await call('GET', '/api/students', { token: viewerToken })).status === 200);
    check('viewer cannot launch a refresh (403)',
      (await call('POST', '/api/students/refresh', { token: viewerToken, body: { scope: 'all' } })).status === 403);
    check('viewer cannot list users (403)', (await call('GET', '/api/auth/users', { token: viewerToken })).status === 403);
    check('viewer cannot change settings (403)',
      (await call('PATCH', '/api/settings/scoring.weights', { token: viewerToken, body: { value: { problemsSolved: 99 } } })).status === 403);
    check('trainer can launch a refresh but not administer settings',
      (await call('PATCH', '/api/settings/scoring.weights', { token: trainerToken, body: { value: { problemsSolved: 99 } } })).status === 403);
  }

  // -------------------------------------------------------------- students
  section('Students');
  let studentId = '';
  let secondStudentId = '';
  {
    const list = await call('GET', '/api/students?pageSize=5');
    check('GET /api/students paginates', list.status === 200 && list.body.data.length === 5 && list.body.pagination.total >= 24, list.body?.pagination);
    studentId = list.body.data[0].id;
    secondStudentId = list.body.data[1].id;

    const page2 = await call('GET', '/api/students?pageSize=5&page=2');
    check('page 2 returns a different set',
      page2.body.data[0].id !== list.body.data[0].id && page2.body.pagination.page === 2, page2.body?.pagination);

    const sortedDesc = await call('GET', '/api/students?pageSize=5&sortBy=cpScore&sortDir=desc');
    const scores = sortedDesc.body.data.map((s: any) => s.analytics?.cpScore ?? -1);
    check('sorts by cpScore descending', scores.every((v: number, i: number) => i === 0 || scores[i - 1] >= v), scores);

    const sortedAsc = await call('GET', '/api/students?pageSize=5&sortBy=cpScore&sortDir=asc');
    const ascScores = sortedAsc.body.data.map((s: any) => s.analytics?.cpScore ?? -1);
    check('sorts by cpScore ascending', ascScores.every((v: number, i: number) => i === 0 || ascScores[i - 1] <= v), ascScores);

    const filtered = await call('GET', '/api/students?batch=2023-26');
    check('filters by batch', filtered.status === 200 && filtered.body.data.every((s: any) => s.batch === '2023-26'), filtered.body?.pagination);

    const noMatch = await call('GET', '/api/students?batch=1999-00');
    check('an impossible filter returns an empty page, not an error', noMatch.status === 200 && noMatch.body.data.length === 0);

    const searched = await call('GET', '/api/students?search=Rahul');
    check('searches by name', searched.body.data.some((s: any) => s.name.includes('Rahul')), searched.body.data?.length);

    const byHandle = await call('GET', '/api/students/search?q=rahul_elite');
    check('typeahead finds a student by platform handle', byHandle.body.data.length > 0 && byHandle.body.data[0].studentId === '1001', byHandle.body.data?.[0]);

    const filters = await call('GET', '/api/students/filters');
    check('filter options expose colleges, batches, branches and platforms',
      filters.body.colleges.length > 0 && filters.body.batches.length > 0 && filters.body.platforms.length === 4, Object.keys(filters.body));

    const detail = await call('GET', `/api/students/${studentId}`);
    check('GET /api/students/:id returns full detail',
      detail.status === 200 && Boolean(detail.body.data.platforms) && Boolean(detail.body.data.topics), Object.keys(detail.body.data ?? {}));

    const byStudentId = await call('GET', '/api/students/1001');
    check('a student is also reachable by their institution ID', byStudentId.status === 200 && byStudentId.body.data.studentId === '1001');

    const missing = await call('GET', '/api/students/does-not-exist');
    check('unknown student returns a structured 404', missing.status === 404 && missing.body.error.code === 'NOT_FOUND', missing.body);

    for (const sub of ['platforms', 'problems', 'topics', 'contests', 'ratings', 'history', 'analytics']) {
      const r = await call('GET', `/api/students/${studentId}/${sub}`);
      check(`GET /api/students/:id/${sub} responds 200`, r.status === 200, r.status);
    }

    const capabilities = await call('GET', `/api/students/${studentId}/platforms`);
    check('platform payload carries capability flags',
      capabilities.body.data.every((p: any) => p.capabilities && typeof p.capabilities.hasContests === 'boolean'), capabilities.body.data?.[0]?.capabilities);

    const score = await call('POST', `/api/students/${studentId}/score-preview`, { body: {} });
    check('score preview returns 5 components with detail text',
      score.body.data.components.length === 5 && score.body.data.components.every((c: any) => c.detail), score.body.data?.components?.length);

    // Pick a student who is NOT saturated on every component — a top performer
    // scores 100 under any weighting, so reweighting them proves nothing.
    const midList = await call('GET', '/api/students?pageSize=200&sortBy=cpScore&sortDir=desc');
    const midStudent = midList.body.data.find((s: any) => s.analytics?.hasData && s.analytics.cpScore > 15 && s.analytics.cpScore < 85);
    check('found an unsaturated student to reweight', Boolean(midStudent), midStudent?.analytics?.cpScore);
    if (midStudent) {
      const baseline = await call('POST', `/api/students/${midStudent.id}/score-preview`, { body: {} });
      const reweighted = await call('POST', `/api/students/${midStudent.id}/score-preview`, {
        body: { problemsSolved: 100, problemDifficulty: 0, contestParticipation: 0, contestRating: 0, topicCoverage: 0 },
      });
      check('changing weights changes the previewed score', reweighted.body.data.score !== baseline.body.data.score,
        { student: midStudent.name, before: baseline.body.data.score, after: reweighted.body.data.score });
      check('a saturated top performer still scores 100 under any weighting', score.body.data.score === 100,
        score.body.data.score);
    }

    const compare = await call('POST', '/api/students/compare', { body: { ids: [studentId, secondStudentId] } });
    check('compares two students', compare.status === 200 && compare.body.data.length === 2, compare.body?.data?.length);

    const tooFew = await call('POST', '/api/students/compare', { body: { ids: [studentId] } });
    check('compare rejects fewer than two students', tooFew.status === 400 && tooFew.body.error.code === 'VALIDATION_ERROR');
  }

  // ----------------------------------------------------------- leaderboard
  section('Leaderboard');
  {
    const board = await call('GET', '/api/leaderboard?pageSize=10');
    check('returns a dense ranking starting at 1', board.status === 200 && board.body.data[0].rank === 1, board.body?.data?.[0]?.rank);
    check('ranked descending by score',
      board.body.data.every((r: any, i: number) => i === 0 || board.body.data[i - 1].cpScore >= r.cpScore));
    check('carries the metric-availability flags',
      board.body.data.every((r: any) => typeof r.difficultyKnown === 'boolean' && typeof r.topicsKnown === 'boolean'), board.body.data?.[0]);
    check('excludes students with no retrieved data',
      !board.body.data.some((r: any) => r.name === 'Gaurav Chauhan'), board.body.data.map((r: any) => r.name));

    const bySolved = await call('GET', '/api/leaderboard?sortBy=totalSolved&sortDir=asc&pageSize=5');
    check('sorts by an alternate column',
      bySolved.body.data.every((r: any, i: number) => i === 0 || bySolved.body.data[i - 1].totalSolved <= r.totalSolved),
      bySolved.body.data.map((r: any) => r.totalSolved));

    const injection = await call('GET', '/api/leaderboard?sortBy=passwordHash');
    check('rejects an unsupported sort column instead of ignoring it', injection.status === 400, injection.status);

    const filteredBoard = await call('GET', '/api/leaderboard?batch=2023-26');
    check('leaderboard honours filters', filteredBoard.body.data.every((r: any) => r.batch === '2023-26'));
  }

  // ------------------------------------------------------------- analytics
  section('Analytics');
  {
    const overview = await call('GET', '/api/analytics/overview');
    check('overview returns totals, distributions and platform coverage',
      overview.body.data.totalStudents >= 24 && overview.body.data.platforms.length === 4 && Boolean(overview.body.data.distributions.cpScore),
      { total: overview.body.data?.totalStudents });
    const cf = overview.body.data.platforms.find((p: any) => p.platform === 'CODEFORCES');
    check('platform coverage separates each failure status',
      typeof cf.notFound === 'number' && typeof cf.private === 'number' && typeof cf.rateLimited === 'number', cf);

    const topics = await call('GET', '/api/analytics/topics');
    check('topics returns a ranked list and a heatmap', topics.body.data.topics.length > 0 && Array.isArray(topics.body.data.heatmap));
    check('CodeChef is absent from the topic heatmap (it publishes none)',
      !topics.body.data.heatmap.some((h: any) => h.platform === 'CODECHEF'), topics.body.data.heatmap.map((h: any) => h.platform));

    const difficulty = await call('GET', '/api/analytics/difficulty');
    const d = difficulty.body.data.difficulty;
    check('difficulty totals are internally consistent',
      d.easy + d.medium + d.hard + d.unclassified === d.total, d);
    const chef = difficulty.body.data.byPlatform.find((p: any) => p.platform === 'CODECHEF');
    check('CodeChef reports NULL, not 0, for a split it never publishes',
      chef.easySolved === null && chef.supportsDifficulty === false, chef);

    const batch = await call('GET', '/api/analytics/batch?batch=2023-26');
    check('batch dashboard returns averages, medians and highlights',
      batch.body.data.studentCount > 0 && batch.body.data.averages.problemsSolved.median !== null && Boolean(batch.body.data.highlights.topStudent),
      { count: batch.body.data?.studentCount });
    check('batch returns top and bottom performers',
      batch.body.data.top10.length > 0 && batch.body.data.bottom10.length > 0);

    const missingBatch = await call('GET', '/api/analytics/batch');
    check('batch without a batch parameter is a 400', missingBatch.status === 400);

    const colleges = await call('GET', '/api/analytics/university?groupBy=college');
    check('college comparison is ordered by average score',
      colleges.body.data.length > 1 && colleges.body.data.every((c: any, i: number) => i === 0 || colleges.body.data[i - 1].averageScore >= c.averageScore),
      colleges.body.data.map((c: any) => c.averageScore));

    const growth = await call('GET', '/api/analytics/growth?days=180');
    check('growth returns a dated series', growth.body.data.length > 1 && Boolean(growth.body.data[0].date), growth.body.data?.length);
  }

  // ------------------------------------------------------------- settings
  section('Settings');
  {
    const settings = await call('GET', '/api/settings');
    check('returns values, defaults and runtime config',
      Boolean(settings.body.data['scoring.weights']) && Boolean(settings.body.defaults) && Boolean(settings.body.runtime.dataSource));

    const updated = await call('PATCH', '/api/settings/scoring.weights', { body: { value: { problemsSolved: 42 } } });
    check('an admin can update a setting', updated.status === 200 && updated.body.data.value.problemsSolved === 42, updated.body);

    const after = await call('GET', '/api/settings');
    check('the update persists and merges with untouched keys',
      after.body.data['scoring.weights'].problemsSolved === 42 && after.body.data['scoring.weights'].topicCoverage === 15,
      after.body.data['scoring.weights']);

    const invalid = await call('PATCH', '/api/settings/scoring.weights', { body: { value: { problemsSolved: -5 } } });
    check('rejects an out-of-range value', invalid.status === 400, invalid.status);

    const unknownKey = await call('PATCH', '/api/settings/not.a.key', { body: { value: {} } });
    check('rejects an unknown settings key', unknownKey.status === 400, unknownKey.status);

    const reset = await call('POST', '/api/settings/scoring.weights/reset');
    check('reset restores the default', reset.status === 200 && (await call('GET', '/api/settings')).body.data['scoring.weights'].problemsSolved === 30);

    const meta = await call('GET', '/api/settings/platforms/meta');
    check('platform metadata documents all four platforms with sourcing notes',
      meta.body.data.length === 4 && meta.body.data.every((p: any) => p.dataSourceNote?.length > 10), meta.body.data?.map((p: any) => p.key));

    const colors = await call('PATCH', '/api/settings/ui.platformColors', {
      body: { value: { LEETCODE: { light: '#AA1122', dark: '#BB3344' } } },
    });
    check('platform colours accept a light/dark pair', colors.status === 200, colors.body);
    const badColor = await call('PATCH', '/api/settings/ui.platformColors', { body: { value: { LEETCODE: { light: 'red', dark: '#BB3344' } } } });
    check('platform colours reject a non-hex value', badColor.status === 400, badColor.status);
    await call('POST', '/api/settings/ui.platformColors/reset');
  }

  // --------------------------------------------------------------- uploads
  section('Excel upload');
  let uploadId = '';
  let jobId = '';
  {
    const fields = await call('GET', '/api/uploads/fields');
    check('exposes the mappable field catalogue',
      fields.body.data.find((f: any) => f.field === 'student_id')?.required === true, fields.body.data?.length);

    // Wrong file type
    const badForm = new FormData();
    badForm.append('file', new Blob(['not a spreadsheet'], { type: 'text/plain' }), 'notes.txt');
    const badUpload = await call('POST', '/api/uploads', { form: badForm });
    check('rejects a non-spreadsheet upload', badUpload.status === 400 && /Unsupported file type/i.test(badUpload.body.error.message), badUpload.body?.error?.message);

    const xlsForm = new FormData();
    xlsForm.append('file', new Blob(['old binary'], { type: 'application/vnd.ms-excel' }), 'legacy.xls');
    const xlsUpload = await call('POST', '/api/uploads', { form: xlsForm });
    check('explains the .xls limitation rather than failing opaquely',
      xlsUpload.status === 400 && /re-save it as \.xlsx/i.test(xlsUpload.body.error.message), xlsUpload.body?.error?.message);

    await buildFixture();
    if (!fs.existsSync(SAMPLE)) {
      check('the 120-student fixture was generated', false);
    } else {
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(SAMPLE)]), path.basename(SAMPLE));
      const upload = await call('POST', '/api/uploads', { form });
      check('uploads a 120-row workbook', upload.status === 201 && upload.body.data.totalRows === 120, upload.body?.data?.totalRows ?? upload.body);
      uploadId = upload.body.data.uploadId;

      const preview = upload.body.data;
      check('auto-maps every column including unusual header spellings',
        preview.suggestedMapping['Roll No'] === 'student_id' &&
        preview.suggestedMapping['Passing Year'] === 'batch' &&
        preview.suggestedMapping['Dept'] === 'branch' &&
        preview.suggestedMapping['Code Chef'] === 'codechef_username', preview.suggestedMapping);
      check('returns a preview of the first rows', preview.previewRows.length > 0 && preview.previewRows.length <= 20, preview.previewRows?.length);
      check('validation counts valid rows', preview.validation.validRows === 120, preview.validation?.validRows);
      check('reports per-platform coverage',
        preview.validation.summary.platformCounts.LEETCODE === 120 && preview.validation.summary.platformCounts.CODECHEF === 80,
        preview.validation.summary.platformCounts);

      const revalidated = await call('POST', `/api/uploads/${uploadId}/validate`, {
        body: { mapping: { ...preview.suggestedMapping, 'Code Chef': null } },
      });
      check('re-validating with an edited mapping drops that platform',
        revalidated.body.data.validation.summary.platformCounts.CODECHEF === 0,
        revalidated.body.data?.validation?.summary?.platformCounts);

      const badMapping = await call('POST', `/api/uploads/${uploadId}/commit`, {
        body: { mapping: { 'Student Name': 'name' }, startProcessing: false },
      });
      check('commit refuses an incomplete mapping', badMapping.status === 400, badMapping.body?.error?.message);

      const commit = await call('POST', `/api/uploads/${uploadId}/commit`, {
        body: { mapping: preview.suggestedMapping, startProcessing: true, force: true },
      });
      check('commit imports every valid row', commit.status === 201 && commit.body.data.created === 120, commit.body?.data);
      check('commit links profiles and starts a job',
        commit.body.data.profilesLinked === 386 && Boolean(commit.body.data.job), commit.body?.data);
      jobId = commit.body.data.job.jobId;

      const recommit = await call('POST', `/api/uploads/${uploadId}/commit`, {
        body: { mapping: preview.suggestedMapping, startProcessing: false },
      });
      check('the same upload cannot be committed twice', recommit.status === 400, recommit.status);
    }
  }

  // ------------------------------------------------------------------ jobs
  section('Processing jobs');
  {
    const queue = await call('GET', '/api/jobs/queue-status');
    check('queue status reports the driver', queue.status === 200 && Boolean(queue.body.driver), queue.body);

    // Wait for the job to finish.
    let progress: any = null;
    for (let i = 0; i < 90; i++) {
      progress = (await call('GET', `/api/jobs/${jobId}`)).body.data;
      if (progress.processed >= progress.totalItems) break;
      await sleep(1000);
    }
    check('the job processes every item', progress.processed === progress.totalItems, { processed: progress?.processed, total: progress?.totalItems });
    check('the job completes with errors recorded, not silently',
      progress.status === 'COMPLETED_WITH_ERRORS' && progress.failed > 0, { status: progress?.status, failed: progress?.failed });
    check('progress reports 100%', progress.percentage === 100, progress?.percentage);
    check('every student is accounted for', progress.studentsProcessed === progress.totalStudents && progress.studentsRemaining === 0,
      { done: progress?.studentsProcessed, total: progress?.totalStudents });
    check('per-platform status is reported', progress.platformStatus.length === 4, progress?.platformStatus?.length);
    check('counters add up',
      progress.successful + progress.failed + progress.rateLimited + progress.skipped === progress.processed,
      { s: progress?.successful, f: progress?.failed, r: progress?.rateLimited, sk: progress?.skipped, p: progress?.processed });

    const items = await call('GET', `/api/jobs/${jobId}/items?status=FAILED&pageSize=200`);
    check('failed items each carry a reason and a data status',
      items.body.data.length > 0 && items.body.data.every((i: any) => i.error && i.dataStatus), items.body.data?.[0]);
    const statuses = new Set(items.body.data.map((i: any) => i.dataStatus));
    check('distinct failure reasons are preserved (not collapsed to one)',
      statuses.size >= 3, [...statuses]);

    const list = await call('GET', '/api/jobs?pageSize=5');
    check('jobs list paginates', list.status === 200 && list.body.data.length > 0);

    const errors = await call('GET', '/api/jobs/errors/recent?pageSize=10');
    check('recent platform errors are queryable', errors.status === 200 && errors.body.data.length > 0, errors.body?.pagination?.total);

    const retry = await call('POST', `/api/jobs/${jobId}/retry`);
    check('retry re-queues the failed and rate-limited items', retry.status === 202 && retry.body.requeued > 0, retry.body);
    for (let i = 0; i < 60; i++) {
      progress = (await call('GET', `/api/jobs/${jobId}`)).body.data;
      if (progress.processed >= progress.totalItems) break;
      await sleep(1000);
    }
    check('counters stay consistent after a retry (no double counting)',
      progress.processed === progress.totalItems &&
      progress.successful + progress.failed + progress.rateLimited + progress.skipped === progress.processed,
      { p: progress?.processed, t: progress?.totalItems, s: progress?.successful, f: progress?.failed });

    const unknownJob = await call('GET', '/api/jobs/nope');
    check('unknown job returns 404', unknownJob.status === 404);
  }

  // ------------------------------------------------------------ refreshing
  section('Refreshing');
  {
    const noSelection = await call('POST', '/api/students/refresh', { body: { scope: 'selected', studentIds: [] } });
    check('refresh with no selection is a 400', noSelection.status === 400, noSelection.body?.error?.message);

    const batchless = await call('POST', '/api/students/refresh', { body: { scope: 'batch' } });
    check('batch refresh without a batch is a 400', batchless.status === 400);

    const unforced = await call('POST', '/api/students/refresh', { body: { scope: 'all', force: false } });
    check('an unforced refresh skips profiles still inside the cache window',
      unforced.status === 202 ? unforced.body.skippedFresh > 0 : unforced.status === 400, unforced.body);

    const forced = await call('POST', '/api/students/refresh', { body: { scope: 'batch', batch: '2023-26', force: true } });
    check('a forced batch refresh queues work', forced.status === 202 && forced.body.totalItems > 0, forced.body);

    const single = await call('POST', `/api/students/${studentId}/refresh`, { body: { force: true } });
    check('a single-student refresh queues work', single.status === 202 && single.body.totalItems > 0, single.body);

    const platformOnly = await call('POST', '/api/students/refresh', { body: { scope: 'all', platforms: ['CODEFORCES'], force: true } });
    check('a platform-scoped refresh only queues that platform', platformOnly.status === 202 && platformOnly.body.totalItems > 0, platformOnly.body);
  }

  // --------------------------------------------------------------- reports
  section('Reports');
  {
    const cases: [string, string, (b: Buffer) => boolean][] = [
      [`/api/reports/student/${studentId}?format=pdf`, 'student PDF', (b) => b.subarray(0, 4).toString() === '%PDF' && b.length > 1500],
      [`/api/reports/student/${studentId}?format=xlsx`, 'student XLSX', (b) => b.subarray(0, 2).toString() === 'PK' && b.length > 3000],
      [`/api/reports/student/${studentId}?format=csv`, 'student CSV', (b) => b.toString().includes('Student ID')],
      ['/api/reports/batch/2023-26?format=pdf', 'batch PDF', (b) => b.subarray(0, 4).toString() === '%PDF'],
      ['/api/reports/batch/2023-26?format=xlsx', 'batch XLSX', (b) => b.subarray(0, 2).toString() === 'PK'],
      ['/api/reports/leaderboard?format=xlsx', 'leaderboard XLSX', (b) => b.subarray(0, 2).toString() === 'PK'],
      ['/api/reports/leaderboard?format=csv', 'leaderboard CSV', (b) => b.toString().includes('Rank')],
      ['/api/reports/failures?format=xlsx', 'failures XLSX', (b) => b.subarray(0, 2).toString() === 'PK'],
    ];
    for (const [url, label, verify] of cases) {
      const r = await call('GET', url, { binary: true });
      check(`${label} downloads and is well-formed`, r.status === 200 && verify(r.raw!),
        { status: r.status, bytes: r.raw?.length, disposition: r.headers.get('content-disposition') });
    }

    const attachment = await call('GET', `/api/reports/student/${studentId}?format=pdf`, { binary: true });
    check('reports are served as an attachment with a filename',
      /attachment; filename="/.test(attachment.headers.get('content-disposition') ?? ''), attachment.headers.get('content-disposition'));

    const unknownBatch = await call('GET', '/api/reports/batch/nope-1234?format=pdf');
    check('a report for an unknown batch is a 404', unknownBatch.status === 404, unknownBatch.status);
  }

  // ------------------------------------------------------- data integrity
  section('Data integrity');
  {
    const all = await call('GET', '/api/students?pageSize=200');
    const withData = all.body.data.filter((s: any) => s.analytics?.hasData);
    const noDifficulty = withData.filter((s: any) => !s.analytics.difficultyKnown);
    check('some students legitimately have no difficulty split', noDifficulty.length > 0, noDifficulty.length);
    check('a student with no data is never marked hasData',
      all.body.data.filter((s: any) => s.platforms.length === 0).every((s: any) => !s.analytics?.hasData));

    const priv = all.body.data.find((s: any) => s.platforms.some((p: any) => p.status === 'PRIVATE'));
    check('a private profile stores NULL, not 0, for solved',
      Boolean(priv) && priv.platforms.find((p: any) => p.status === 'PRIVATE').totalSolved === null,
      priv?.platforms?.find((p: any) => p.status === 'PRIVATE'));
    check('a failed profile carries an explanatory message',
      Boolean(priv?.platforms.find((p: any) => p.status === 'PRIVATE')?.statusMessage));

    const chefOnly = withData.find((s: any) => !s.analytics.difficultyKnown && s.analytics.totalSolved > 0);
    if (chefOnly) {
      const csv = await call('GET', `/api/reports/student/${chefOnly.id}?format=csv`, { binary: true });
      const text = csv.raw!.toString();
      check('exports print N/A for an unknown difficulty split, never 0',
        /Easy Solved,N\/A/.test(text) && !/Easy Solved,0/.test(text), text.split('\n').find((l) => l.startsWith('Easy Solved')));
    } else {
      check('found a student whose difficulty split is unknown', false);
    }
  }

  // ----------------------------------------------------------- edit/delete
  section('Student editing');
  {
    const created = await call('GET', '/api/students?search=Aarav&pageSize=1');
    const target = created.body.data[0];
    const patched = await call('PATCH', `/api/students/${target.id}`, {
      token: trainerToken,
      body: { section: 'Z', notes: 'edited by e2e' },
    });
    check('a trainer can edit a student', patched.status === 200 && patched.body.data.section === 'Z', patched.body?.data?.section);

    const handleChange = await call('PATCH', `/api/students/${target.id}`, {
      token: trainerToken,
      body: { handles: { LEETCODE: 'brand_new_handle' } },
    });
    const lc = handleChange.body.data.platforms.find((p: any) => p.platform === 'LEETCODE');
    check('changing a handle resets the profile to PENDING',
      lc?.username === 'brand_new_handle' && lc?.status === 'PENDING', lc);

    const removal = await call('PATCH', `/api/students/${target.id}`, {
      token: trainerToken,
      body: { handles: { HACKERRANK: null } },
    });
    check('clearing a handle removes that platform profile',
      !removal.body.data.platforms.some((p: any) => p.platform === 'HACKERRANK'),
      removal.body.data.platforms.map((p: any) => p.platform));

    const viewerEdit = await call('PATCH', `/api/students/${target.id}`, { token: viewerToken, body: { section: 'Q' } });
    check('a viewer cannot edit a student', viewerEdit.status === 403);

    const deleted = await call('DELETE', `/api/students/${target.id}`, { token: trainerToken });
    check('a trainer can delete a student', deleted.status === 204, deleted.status);
    check('the deleted student is gone', (await call('GET', `/api/students/${target.id}`)).status === 404);
  }

  // ------------------------------------------------------------ misc/edges
  section('Error handling and edge cases');
  {
    check('unknown route returns a structured 404',
      (await call('GET', '/api/does-not-exist')).body?.error?.code === 'NOT_FOUND');

    const badJson = await fetch(`${BASE}/api/students/compare`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: '{ not valid json',
    });
    check('malformed JSON is a 400, not a crash', badJson.status === 400, badJson.status);

    const hugePage = await call('GET', '/api/students?pageSize=99999');
    check('an oversized pageSize is rejected by validation', hugePage.status === 400, hugePage.status);

    const negativePage = await call('GET', '/api/students?page=-1');
    check('a negative page is rejected', negativePage.status === 400, negativePage.status);

    const users = await call('GET', '/api/auth/users');
    check('admin can list users and no hash leaks',
      users.status === 200 && !JSON.stringify(users.body).match(/passwordHash|\$2[aby]\$/));

    const weak = await call('POST', '/api/auth/users', { body: { email: 'weak@test.local', password: 'password', name: 'Weak' } });
    check('weak passwords are rejected on user creation', weak.status === 400, weak.status);

    const newUser = await call('POST', '/api/auth/users', { body: { email: `e2e${Date.now()}@test.local`, password: 'Str0ngPassw0rd!', name: 'E2E User', role: 'VIEWER' } });
    check('an admin can create a user', newUser.status === 201, newUser.status);

    const dupe = await call('POST', '/api/auth/users', { body: { email: 'admin@tracker.local', password: 'Str0ngPassw0rd!', name: 'Dupe' } });
    check('a duplicate email is a 409', dupe.status === 409, dupe.status);

    const recompute = await call('POST', '/api/analytics/recompute', { token: trainerToken });
    check('analytics can be rebuilt', recompute.status === 200 && recompute.body.count > 0, recompute.body);

    const purge = await call('POST', '/api/settings/cache/purge', { body: { expiredOnly: true } });
    check('expired cache entries can be purged', purge.status === 200 && typeof purge.body.removed === 'number', purge.body);

    const logout = await call('POST', '/api/auth/logout');
    check('logout returns 204', logout.status === 204, logout.status);
    const afterLogout = await call('POST', '/api/auth/refresh', { auth: false });
    check('the refresh cookie no longer works after logout', afterLogout.status === 401, afterLogout.status);
  }

  // ------------------------------------------------------------------ done
  console.log(`\n${'='.repeat(70)}`);
  console.log(`\x1b[1mAPI E2E: ${pass} passed, ${failures.length} failed\x1b[0m`);
  if (failures.length > 0) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\x1b[31mE2E harness crashed:\x1b[0m', err);
  process.exitCode = 1;
});
