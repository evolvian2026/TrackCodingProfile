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
