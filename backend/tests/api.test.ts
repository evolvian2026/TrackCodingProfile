import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { prisma } from '../src/db/prisma.js';
import { prepareTestDatabase, truncateAll } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { register } from '../src/modules/auth/auth.service.js';
import { recomputeStudentAnalytics } from '../src/services/analytics.service.js';
import { ingestSnapshot } from '../src/services/ingest.service.js';
import { getAdapter } from '../src/platforms/registry.js';

let app: Express;

const ADMIN = { email: 'admin@test.local', password: 'Admin@12345', name: 'Admin' };
const VIEWER = { email: 'viewer@test.local', password: 'Viewer@12345', name: 'Viewer' };

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.accessToken;
}

async function seedStudentWithData(studentId: string, name: string, handle: string) {
  const student = await prisma.student.create({
    data: { studentId, name, batch: '2023-26', college: 'Test College', branch: 'CSE' },
  });
  await prisma.platformProfile.create({ data: { studentId: student.id, platform: 'CODEFORCES', username: handle } });
  const snapshot = await getAdapter('CODEFORCES', 'mock').fetchAll(handle, { force: true });
  await ingestSnapshot(student.id, snapshot);
  await recomputeStudentAnalytics(student.id);
  return student;
}

beforeAll(async () => {
  await prepareTestDatabase();
  app = createApp();
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll();
  await register({ ...ADMIN, role: 'ADMIN' });
  await register({ ...VIEWER, role: 'VIEWER' });
});

describe('health', () => {
  it('reports database and runtime configuration', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up', dataSource: 'mock' });
  });
});

describe('authentication', () => {
  it('issues an access token and a http-only refresh cookie', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user).toMatchObject({ email: ADMIN.email, role: 'ADMIN' });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const cookie = res.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: ADMIN.email, password: 'WrongPass@123' }).expect(401);
    const noAccount = await request(app).post('/api/auth/login').send({ email: 'ghost@test.local', password: 'WrongPass@123' }).expect(401);
    expect(wrongPassword.body.error.message).toBe(noAccount.body.error.message);
  });

  it('refuses weak passwords when creating users', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).post('/api/auth/users').set('Authorization', `Bearer ${token}`).send({ email: 'weak@test.local', password: 'password', name: 'Weak' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rotates the refresh token and rejects the burned one', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    const original = login.headers['set-cookie']!;

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', original).expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    // Replaying the original cookie must fail.
    await request(app).post('/api/auth/refresh').set('Cookie', original).expect(401);
  });

  it('rejects a refresh token that has already been rotated', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    const cookie = login.headers['set-cookie']!;

    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(200);
    // Rotation is deliberate: a replayed token must not work. The web client
    // therefore has to funnel every refresh through a single in-flight request,
    // or two concurrent refreshes would sign a valid user out.
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('blocks unauthenticated access to protected routes', async () => {
    await request(app).get('/api/students').expect(401);
    await request(app).get('/api/leaderboard').expect(401);
    await request(app).get('/api/analytics/overview').expect(401);
  });

  it('rejects a tampered token', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    await request(app).get('/api/students').set('Authorization', `Bearer ${token}tampered`).expect(401);
  });

  it('enforces role-based access control', async () => {
    const viewerToken = await tokenFor(VIEWER.email, VIEWER.password);
    // A viewer can read.
    await request(app).get('/api/students').set('Authorization', `Bearer ${viewerToken}`).expect(200);
    // But cannot launch jobs or administer users.
    await request(app).post('/api/students/refresh').set('Authorization', `Bearer ${viewerToken}`).send({ scope: 'all' }).expect(403);
    await request(app).get('/api/auth/users').set('Authorization', `Bearer ${viewerToken}`).expect(403);
  });
});

describe('students API', () => {
  it('paginates, filters and searches', async () => {
    await seedStudentWithData('7001', 'Alpha Student', 'alpha_elite_cf');
    await seedStudentWithData('7002', 'Beta Student', 'beta_cf');
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const auth = { Authorization: `Bearer ${token}` };

    const page = await request(app).get('/api/students?pageSize=1').set(auth).expect(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });

    const filtered = await request(app).get('/api/students?batch=2023-26').set(auth).expect(200);
    expect(filtered.body.pagination.total).toBe(2);

    const empty = await request(app).get('/api/students?batch=1999-00').set(auth).expect(200);
    expect(empty.body.data).toEqual([]);

    const search = await request(app).get('/api/students/search?q=Alpha').set(auth).expect(200);
    expect(search.body.data[0].name).toBe('Alpha Student');
  });

  it('finds a student by their platform handle', async () => {
    await seedStudentWithData('7003', 'Gamma Student', 'gamma_unique_cf');
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).get('/api/students/search?q=gamma_unique').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data[0].studentId).toBe('7003');
  });

  it('returns a 404 for an unknown student', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).get('/api/students/does-not-exist').set('Authorization', `Bearer ${token}`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('exposes platform capabilities so the UI knows what can exist', async () => {
    const student = await seedStudentWithData('7004', 'Delta Student', 'delta_cf');
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).get(`/api/students/${student.id}/platforms`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data[0].capabilities).toEqual({ hasDifficultyBreakdown: true, hasContests: true, hasTopics: true });
  });

  it('shows the score calculation and previews alternative weights', async () => {
    const student = await seedStudentWithData('7005', 'Epsilon Student', 'epsilon_pro_cf');
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const auth = { Authorization: `Bearer ${token}` };

    const preview = await request(app).post(`/api/students/${student.id}/score-preview`).set(auth).send({}).expect(200);
    expect(preview.body.data.components).toHaveLength(5);
    expect(preview.body.data.components[0].detail).toBeTruthy();

    // Weighting everything onto problems solved changes the outcome.
    const reweighted = await request(app)
      .post(`/api/students/${student.id}/score-preview`)
      .set(auth)
      .send({ problemsSolved: 100, problemDifficulty: 0, contestParticipation: 0, contestRating: 0, topicCoverage: 0 })
      .expect(200);
    expect(reweighted.body.data.score).not.toBe(preview.body.data.score);
  });

  it('compares several students side by side', async () => {
    const a = await seedStudentWithData('7006', 'Compare A', 'compare_a_elite_cf');
    const b = await seedStudentWithData('7007', 'Compare B', 'compare_b_beginner_cf');
    const token = await tokenFor(ADMIN.email, ADMIN.password);

    const res = await request(app).post('/api/students/compare').set('Authorization', `Bearer ${token}`).send({ ids: [a.id, b.id] }).expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].analytics).toBeTruthy();
  });

  it('validates request payloads', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).post('/api/students/compare').set('Authorization', `Bearer ${token}`).send({ ids: ['only-one'] }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('leaderboard and analytics API', () => {
  it('ranks students and honours the sort parameter', async () => {
    await seedStudentWithData('8001', 'Top Student', 'top_elite_cf');
    await seedStudentWithData('8002', 'Low Student', 'low_beginner_cf');
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const auth = { Authorization: `Bearer ${token}` };

    const byScore = await request(app).get('/api/leaderboard').set(auth).expect(200);
    expect(byScore.body.data[0].name).toBe('Top Student');
    expect(byScore.body.data[0].rank).toBe(1);

    const ascending = await request(app).get('/api/leaderboard?sortBy=totalSolved&sortDir=asc').set(auth).expect(200);
    expect(ascending.body.data[0].name).toBe('Low Student');
  });

  it('rejects an unsupported sort column instead of silently ignoring it', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    await request(app).get('/api/leaderboard?sortBy=passwordHash').set('Authorization', `Bearer ${token}`).expect(400);
  });

  it('summarizes platform data availability in the overview', async () => {
    await seedStudentWithData('8003', 'Available Student', 'ok_cf');
    const missing = await prisma.student.create({ data: { studentId: '8004', name: 'Missing Student' } });
    await prisma.platformProfile.create({ data: { studentId: missing.id, platform: 'CODEFORCES', username: 'gone_notfound' } });
    const snapshot = await getAdapter('CODEFORCES', 'mock').fetchAll('gone_notfound', { force: true });
    await ingestSnapshot(missing.id, snapshot);
    await recomputeStudentAnalytics(missing.id);

    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).get('/api/analytics/overview').set('Authorization', `Bearer ${token}`).expect(200);

    const codeforces = res.body.data.platforms.find((p: { platform: string }) => p.platform === 'CODEFORCES');
    expect(codeforces.available).toBe(1);
    expect(codeforces.notFound).toBe(1);
    expect(res.body.data.studentsWithData).toBe(1);
  });
});

describe('settings API', () => {
  it('lets an administrator retune scoring weights', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const auth = { Authorization: `Bearer ${token}` };

    const updated = await request(app)
      .patch('/api/settings/scoring.weights')
      .set(auth)
      .send({ value: { problemsSolved: 50, contestRating: 10 } })
      .expect(200);
    expect(updated.body.data.value.problemsSolved).toBe(50);

    const all = await request(app).get('/api/settings').set(auth).expect(200);
    expect(all.body.data['scoring.weights'].problemsSolved).toBe(50);
    // Untouched keys keep their defaults.
    expect(all.body.data['scoring.weights'].topicCoverage).toBe(15);

    await request(app).post('/api/settings/scoring.weights/reset').set(auth).expect(200);
    const afterReset = await request(app).get('/api/settings').set(auth).expect(200);
    expect(afterReset.body.data['scoring.weights'].problemsSolved).toBe(30);
  });

  it('recomputes stored scores when a scoring setting is reset', async () => {
    const student = await seedStudentWithData('9100', 'Reset Subject', 'reset_pro_cf');
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const auth = { Authorization: `Bearer ${token}` };

    const before = await prisma.studentAnalytics.findUniqueOrThrow({ where: { studentId: student.id } });

    // Halve the target so the score jumps, then reset it back.
    await request(app)
      .patch('/api/settings/scoring.targets')
      .set(auth)
      .send({ value: { problemsSolvedTarget: 50 }, recompute: true })
      .expect(200);
    const shifted = await prisma.studentAnalytics.findUniqueOrThrow({ where: { studentId: student.id } });
    expect(shifted.cpScore).not.toBe(before.cpScore);

    const reset = await request(app).post('/api/settings/scoring.targets/reset').set(auth).send({}).expect(200);
    expect(reset.body.recomputed).toBeGreaterThan(0);

    // Without a recompute on reset the stored score would still reflect the
    // old target, and the leaderboard would disagree with the settings.
    const after = await prisma.studentAnalytics.findUniqueOrThrow({ where: { studentId: student.id } });
    expect(after.cpScore).toBe(before.cpScore);
  });

  it('does not recompute when resetting a setting that cannot affect scores', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).post('/api/settings/ui.platformColors/reset').set('Authorization', `Bearer ${token}`).send({}).expect(200);
    expect(res.body.recomputed).toBeUndefined();
  });

  it('rejects an invalid setting value and an unknown key', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).patch('/api/settings/scoring.weights').set(auth).send({ value: { problemsSolved: -5 } }).expect(400);
    await request(app).patch('/api/settings/not.a.real.key').set(auth).send({ value: {} }).expect(400);
  });

  it('does not let a viewer change settings', async () => {
    const token = await tokenFor(VIEWER.email, VIEWER.password);
    await request(app).patch('/api/settings/scoring.weights').set('Authorization', `Bearer ${token}`).send({ value: { problemsSolved: 99 } }).expect(403);
  });

  it('publishes platform metadata including how each one is sourced', async () => {
    const token = await tokenFor(VIEWER.email, VIEWER.password);
    const res = await request(app).get('/api/settings/platforms/meta').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.data.every((p: { dataSourceNote: string }) => p.dataSourceNote.length > 0)).toBe(true);
  });
});

describe('upload API', () => {
  it('rejects a non-spreadsheet upload', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('definitely not a spreadsheet'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);
    expect(res.body.error.message).toMatch(/Unsupported file type/i);
  });

  it('explains the .xls limitation rather than failing opaquely', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('old binary workbook'), { filename: 'legacy.xls', contentType: 'application/vnd.ms-excel' })
      .expect(400);
    expect(res.body.error.message).toMatch(/re-save it as \.xlsx/i);
  });

  it('lists the mappable fields for the column-mapping UI', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).get('/api/uploads/fields').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data.find((f: { field: string }) => f.field === 'student_id').required).toBe(true);
  });
});


describe('goals', () => {
  const goalBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Placement readiness',
    batch: '2023-26',
    startsOn: new Date(Date.now() - 86_400_000).toISOString(),
    dueOn: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    targets: [{ metric: 'PROBLEMS_SOLVED', target: 200 }],
    ...overrides,
  });

  it('creates a goal and reports cohort progress with it', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    await seedStudentWithData('7001', 'Goal Student', 'goal_cf');

    const created = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${token}`)
      .send(goalBody())
      .expect(201);

    expect(created.body.data.scope).toBe('2023-26');
    expect(created.body.data.progress.studentsInScope).toBe(1);
    expect(created.body.data.targets[0].label).toBe('Problems solved');
  });

  it('refuses a goal that is due before it starts', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${token}`)
      .send(goalBody({ dueOn: new Date(Date.now() - 30 * 86_400_000).toISOString() }))
      .expect(400);
    expect(res.body.error.message).toMatch(/after the start date/i);
  });

  it('refuses a goal with no targets, which would measure nothing', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${token}`)
      .send(goalBody({ targets: [] }))
      .expect(400);
  });

  it('lets a viewer read goals but not create them', async () => {
    const admin = await tokenFor(ADMIN.email, ADMIN.password);
    await request(app).post('/api/goals').set('Authorization', `Bearer ${admin}`).send(goalBody()).expect(201);

    const viewer = await tokenFor(VIEWER.email, VIEWER.password);
    await request(app).get('/api/goals').set('Authorization', `Bearer ${viewer}`).expect(200);
    await request(app).post('/api/goals').set('Authorization', `Bearer ${viewer}`).send(goalBody()).expect(403);
  });

  it('opens a cohort figure into the students behind it', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    await seedStudentWithData('7001', 'Goal Student', 'goal_cf');
    const goal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${token}`)
      .send(goalBody({ targets: [{ metric: 'PROBLEMS_SOLVED', target: 1_000_000 }] }))
      .expect(201);

    const roster = await request(app)
      .get(`/api/goals/${goal.body.data.id}/students?outcome=BEHIND`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(roster.body.data).toHaveLength(1);
    expect(roster.body.data[0].targets[0].outcome).toBe('BEHIND');
  });

  it('shows a student the goals that cover them', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const student = await seedStudentWithData('7001', 'Goal Student', 'goal_cf');
    await request(app).post('/api/goals').set('Authorization', `Bearer ${token}`).send(goalBody()).expect(201);

    const res = await request(app)
      .get(`/api/students/${student.id}/goals`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('replaces targets wholesale on edit rather than merging them', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const goal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${token}`)
      .send(goalBody({ targets: [{ metric: 'PROBLEMS_SOLVED', target: 200 }, { metric: 'CONTESTS_ATTENDED', target: 3 }] }))
      .expect(201);

    const updated = await request(app)
      .patch(`/api/goals/${goal.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ targets: [{ metric: 'CP_SCORE', target: 70 }] })
      .expect(200);

    expect(updated.body.data.targets).toHaveLength(1);
    expect(updated.body.data.targets[0].metric).toBe('CP_SCORE');
  });

  it('deletes a goal and its targets', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const goal = await request(app).post('/api/goals').set('Authorization', `Bearer ${token}`).send(goalBody()).expect(201);

    await request(app).delete(`/api/goals/${goal.body.data.id}`).set('Authorization', `Bearer ${token}`).expect(204);
    await request(app).get(`/api/goals/${goal.body.data.id}`).set('Authorization', `Bearer ${token}`).expect(404);
    expect(await prisma.goalTarget.count()).toBe(0);
  });
});

describe('shareable student links', () => {
  it('serves a student their own record without a token', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const student = await seedStudentWithData('8001', 'Shared Student', 'share_cf');

    const issued = await request(app)
      .post(`/api/students/${student.id}/share-link`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const shareToken = issued.body.data.url.split('/me/')[1];
    // No Authorization header: this is the whole point of the feature.
    const view = await request(app).get(`/api/shared/${shareToken}`).expect(200);
    expect(view.body.data.student.name).toBe('Shared Student');
  });

  it('gives the same answer for revoked, expired and never-existed links', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const student = await seedStudentWithData('8001', 'Shared Student', 'share_cf');
    const issued = await request(app)
      .post(`/api/students/${student.id}/share-link`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const shareToken = issued.body.data.url.split('/me/')[1];

    await request(app).delete(`/api/students/${student.id}/share-link`).set('Authorization', `Bearer ${token}`).expect(204);

    const revoked = await request(app).get(`/api/shared/${shareToken}`).expect(404);
    const unknown = await request(app).get('/api/shared/never-issued').expect(404);
    // Telling an anonymous caller which case it was is free information about
    // who exists.
    expect(revoked.body.error.message).toBe(unknown.body.error.message);
  });

  it('never returns the link again after issuing it', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const student = await seedStudentWithData('8001', 'Shared Student', 'share_cf');
    await request(app)
      .post(`/api/students/${student.id}/share-link`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const status = await request(app)
      .get(`/api/students/${student.id}/share-link`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(status.body.data.active).toBe(true);
    expect(status.body.data.url).toBeNull();
  });

  it('does not let a viewer issue or revoke links', async () => {
    const admin = await tokenFor(ADMIN.email, ADMIN.password);
    const student = await seedStudentWithData('8001', 'Shared Student', 'share_cf');
    await request(app).post(`/api/students/${student.id}/share-link`).set('Authorization', `Bearer ${admin}`).send({}).expect(201);

    const viewer = await tokenFor(VIEWER.email, VIEWER.password);
    await request(app).post(`/api/students/${student.id}/share-link`).set('Authorization', `Bearer ${viewer}`).send({}).expect(403);
    await request(app).delete(`/api/students/${student.id}/share-link`).set('Authorization', `Bearer ${viewer}`).expect(403);
    // Reading the status is fine; it carries no credential.
    await request(app).get(`/api/students/${student.id}/share-link`).set('Authorization', `Bearer ${viewer}`).expect(200);
  });

  it('issues links for a cohort without disturbing the ones already sent out', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const first = await seedStudentWithData('8001', 'First', 'first_cf');
    await seedStudentWithData('8002', 'Second', 'second_cf');

    const existing = await request(app)
      .post(`/api/students/${first.id}/share-link`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const bulk = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: 'filtered', batch: '2023-26' })
      .expect(201);

    expect(bulk.body.issued).toBe(1);
    expect(bulk.body.skipped).toBe(1);
    // The link already in somebody's inbox still works.
    await request(app).get(`/api/shared/${existing.body.data.url.split('/me/')[1]}`).expect(200);
  });

  it('regenerates in bulk only when explicitly asked, and the old link dies', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const student = await seedStudentWithData('8001', 'First', 'first_cf');
    const existing = await request(app)
      .post(`/api/students/${student.id}/share-link`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const bulk = await request(app)
      .post('/api/share-links')
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: 'all', regenerateExisting: true })
      .expect(201);

    expect(bulk.body.issued).toBe(1);
    await request(app).get(`/api/shared/${existing.body.data.url.split('/me/')[1]}`).expect(404);
  });

  it('reports who has a link and whether it has been opened', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const student = await seedStudentWithData('8001', 'First', 'first_cf');
    await seedStudentWithData('8002', 'Second', 'second_cf');
    await request(app).post(`/api/students/${student.id}/share-link`).set('Authorization', `Bearer ${token}`).send({}).expect(201);

    const res = await request(app).get('/api/share-links').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data.filter((r: { hasLink: boolean }) => r.hasLink)).toHaveLength(1);
    expect(res.body.data.filter((r: { hasLink: boolean }) => !r.hasLink)).toHaveLength(1);
  });

  it('refuses an expiry date that has already passed', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const student = await seedStudentWithData('8001', 'First', 'first_cf');
    await request(app)
      .post(`/api/students/${student.id}/share-link`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .expect(400);
  });
});

describe('error handling', () => {
  it('reports a malformed JSON body as 400, not 500', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app)
      .post('/api/students/compare')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{ not valid json')
      .expect(400);
    // body-parser throws before any route runs; without explicit handling a
    // client's typo surfaces as a server fault.
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toMatch(/not valid JSON/i);
  });

  it('reports an oversized JSON body as 413', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app)
      .post('/api/students/compare')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ids: ['x'.repeat(2_000_000)] }))
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns a structured 404 for an unknown route', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('never leaks a password hash through the users endpoint', async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).get('/api/auth/users').set('Authorization', `Bearer ${token}`).expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});
