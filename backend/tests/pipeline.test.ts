import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { prepareTestDatabase, truncateAll } from './helpers/db.js';
import { createUpload, commitUpload } from '../src/modules/upload/upload.service.js';
import { suggestMapping } from '../src/modules/upload/mapping.js';
import { getJobProgress, processJobItem, retryFailedItems } from '../src/services/processing.service.js';
import { recomputeStudentAnalytics } from '../src/services/analytics.service.js';
import { ingestSnapshot } from '../src/services/ingest.service.js';
import { getAdapter } from '../src/platforms/registry.js';
import { getLeaderboard, getBatchAnalytics, getDifficultyAnalytics } from '../src/modules/analytics/aggregate.service.js';
import { generateStudentReport } from '../src/modules/reports/report.service.js';

let tmpDir: string;

const HEADERS = ['Student ID', 'Student Name', 'Email', 'College', 'Batch', 'Branch', 'Section', 'LeetCode', 'CodeChef', 'HackerRank', 'Codeforces'];

const ROWS: (string | number)[][] = [
  [3001, 'Test Elite', 'elite@x.edu', 'Test College', '2023-26', 'CSE', 'A', 'tester_elite', 'tester_elite_cc', 'tester_hr', 'tester_elite_cf'],
  [3002, 'Test Average', 'avg@x.edu', 'Test College', '2023-26', 'CSE', 'A', 'tester_avg', '', '', 'tester_avg_cf'],
  [3003, 'Test Beginner', 'beg@x.edu', 'Test College', '2024-27', 'IT', 'B', 'tester_beginner', '', '', ''],
  [3004, 'Test Missing', 'missing@x.edu', 'Test College', '2024-27', 'IT', 'B', 'tester_notfound', '', '', 'tester_cf'],
  [3005, 'Test Private', 'priv@x.edu', 'Test College', '2023-26', 'CSE', 'B', 'tester_private', '', '', ''],
  [3006, 'Test Throttled', 'thr@x.edu', 'Test College', '2023-26', 'CSE', 'B', '', 'tester_ratelimited', '', ''],
  [3007, 'Test No Profile', 'none@x.edu', 'Test College', '2024-27', 'ECE', 'A', '', '', '', ''],
];

async function buildWorkbook(rows = ROWS): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(HEADERS);
  rows.forEach((row) => sheet.addRow(row));
  const target = path.join(tmpDir, `students-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  await workbook.xlsx.writeFile(target);
  return target;
}

/** Runs a job to completion synchronously so assertions are deterministic. */
async function drainJob(jobId: string): Promise<void> {
  for (;;) {
    const pending = await prisma.processingJobItem.findMany({
      where: { jobId, status: 'PENDING' },
      include: { student: { select: { profiles: { select: { platform: true, username: true } } } } },
    });
    if (pending.length === 0) return;
    for (const item of pending) {
      await processJobItem({
        jobId,
        itemId: item.id,
        studentId: item.studentId,
        platform: item.platform,
        username: item.student.profiles.find((p) => p.platform === item.platform)?.username ?? '',
        force: true,
      });
    }
  }
}

beforeAll(async () => {
  await prepareTestDatabase();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tcp-pipeline-'));
  process.env.UPLOAD_DIR = tmpDir;
}, 120_000);

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll();
});

describe('upload -> process -> analytics pipeline', () => {
  it('imports students, links profiles and queues one item per handle', async () => {
    const file = await buildWorkbook();
    const preview = await createUpload({ originalname: 'students.xlsx', path: file, size: 1024 }, null);

    expect(preview.totalRows).toBe(7);
    expect(preview.validation.validRows).toBe(7);

    const result = await commitUpload(preview.uploadId, { mapping: preview.suggestedMapping, startProcessing: true });

    expect(result.created).toBe(7);
    // 4 + 2 + 1 + 2 + 1 + 1 + 0 handles.
    expect(result.profilesLinked).toBe(11);
    expect(result.job?.totalItems).toBe(11);
    // The student with no handles has nothing to fetch and is not queued.
    expect(result.job?.totalStudents).toBe(6);
  });

  it('records the real outcome for every profile without inventing numbers', async () => {
    const file = await buildWorkbook();
    const preview = await createUpload({ originalname: 'students.xlsx', path: file, size: 1024 }, null);
    const result = await commitUpload(preview.uploadId, { mapping: preview.suggestedMapping, startProcessing: true });
    await drainJob(result.job!.jobId);

    const progress = await getJobProgress(result.job!.jobId);
    expect(progress.status).toBe('COMPLETED_WITH_ERRORS');
    expect(progress.processed).toBe(progress.totalItems);
    expect(progress.failed).toBe(2); // NOT_FOUND + PRIVATE
    expect(progress.rateLimited).toBe(1);
    expect(progress.percentage).toBe(100);

    const missing = await prisma.platformProfile.findFirst({
      where: { platform: 'LEETCODE', username: 'tester_notfound' },
    });
    expect(missing?.status).toBe('NOT_FOUND');
    // Crucially: unknown stays NULL, it is never coerced to 0.
    expect(missing?.totalSolved).toBeNull();

    const priv = await prisma.platformProfile.findFirst({ where: { username: 'tester_private' } });
    expect(priv?.status).toBe('PRIVATE');
    expect(priv?.totalSolved).toBeNull();
    expect(priv?.statusMessage).toBeTruthy();
  });

  it('keeps the whole job running when individual profiles fail', async () => {
    const file = await buildWorkbook();
    const preview = await createUpload({ originalname: 'students.xlsx', path: file, size: 1024 }, null);
    const result = await commitUpload(preview.uploadId, { mapping: preview.suggestedMapping, startProcessing: true });
    await drainJob(result.job!.jobId);

    const progress = await getJobProgress(result.job!.jobId);
    expect(progress.successful).toBe(8);
    expect(progress.studentsRemaining).toBe(0);
  });

  it('retries only the failed and rate-limited items', async () => {
    const file = await buildWorkbook();
    const preview = await createUpload({ originalname: 'students.xlsx', path: file, size: 1024 }, null);
    const result = await commitUpload(preview.uploadId, { mapping: preview.suggestedMapping, startProcessing: true });
    await drainJob(result.job!.jobId);

    const { requeued } = await retryFailedItems(result.job!.jobId);
    expect(requeued).toBe(3);

    await drainJob(result.job!.jobId);
    const after = await getJobProgress(result.job!.jobId);
    // Deterministic mock scenarios fail again — counters must not double-count.
    expect(after.processed).toBe(after.totalItems);
    expect(after.successful).toBe(8);
  });

  it('never overwrites retrieved data with a later failure', async () => {
    const student = await prisma.student.create({ data: { studentId: '4001', name: 'Flaky Student' } });
    await prisma.platformProfile.create({ data: { studentId: student.id, platform: 'CODEFORCES', username: 'good_user' } });

    const good = await getAdapter('CODEFORCES', 'mock').fetchAll('good_user', { force: true });
    await ingestSnapshot(student.id, good);
    const before = await prisma.platformProfile.findFirstOrThrow({ where: { studentId: student.id } });
    expect(before.totalSolved).toBeGreaterThan(0);

    // The platform then goes down.
    const bad = await getAdapter('CODEFORCES', 'mock').fetchAll('unavailable_user', { force: true });
    await ingestSnapshot(student.id, { ...bad, username: 'good_user' });

    const after = await prisma.platformProfile.findFirstOrThrow({ where: { studentId: student.id } });
    expect(after.status).toBe('UNAVAILABLE');
    // Last known good numbers survive so the dashboard is not blanked out.
    expect(after.totalSolved).toBe(before.totalSolved);
    expect(after.lastSuccessAt).toEqual(before.lastSuccessAt);
    expect(after.lastFetchedAt!.getTime()).toBeGreaterThanOrEqual(before.lastFetchedAt!.getTime());
  });

  it('aggregates analytics across platforms and keeps unclassified solves visible', async () => {
    const file = await buildWorkbook();
    const preview = await createUpload({ originalname: 'students.xlsx', path: file, size: 1024 }, null);
    const result = await commitUpload(preview.uploadId, { mapping: preview.suggestedMapping, startProcessing: true });
    await drainJob(result.job!.jobId);

    const elite = await prisma.student.findFirstOrThrow({ where: { studentId: '3001' }, include: { analytics: true } });
    expect(elite.analytics!.hasData).toBe(true);
    expect(elite.analytics!.platformsActive).toBe(4);
    expect(elite.analytics!.cpScore).toBeGreaterThan(0);

    const difficulty = await getDifficultyAnalytics();
    // CodeChef and HackerRank publish totals without a difficulty split, so the
    // remainder must be reported as unclassified rather than folded into Easy.
    expect(difficulty.difficulty.unclassified).toBeGreaterThan(0);
    const codechef = difficulty.byPlatform.find((p) => p.platform === 'CODECHEF')!;
    expect(codechef.supportsDifficulty).toBe(false);
    expect(codechef.easySolved).toBeNull();
  });

  it('marks a metric as unknown when no platform with data publishes it', async () => {
    // CodeChef publishes a solved total but no difficulty split and no topics.
    const student = await prisma.student.create({ data: { studentId: '9001', name: 'CodeChef Only' } });
    await prisma.platformProfile.create({ data: { studentId: student.id, platform: 'CODECHEF', username: 'cc_user' } });
    const snapshot = await getAdapter('CODECHEF', 'mock').fetchAll('cc_user', { force: true });
    await ingestSnapshot(student.id, snapshot);
    await recomputeStudentAnalytics(student.id);

    const analytics = await prisma.studentAnalytics.findUniqueOrThrow({ where: { studentId: student.id } });
    expect(analytics.hasData).toBe(true);
    expect(analytics.totalSolved).toBeGreaterThan(0);
    // The split and the topic count are NOT zero — they are unknown.
    expect(analytics.difficultyKnown).toBe(false);
    expect(analytics.topicsKnown).toBe(false);
    // CodeChef does publish contests.
    expect(analytics.contestsKnown).toBe(true);

    // The report must print N/A for the unknown metrics rather than 0.
    const csv = (await generateStudentReport(student.id, 'csv')).buffer.toString();
    expect(csv).toMatch(/Easy Solved,N\/A/);
    expect(csv).toMatch(/Distinct Topics,N\/A/);
    expect(csv).not.toMatch(/Easy Solved,0/);
  });

  it('marks every metric known for a student on a fully-featured platform', async () => {
    const student = await prisma.student.create({ data: { studentId: '9002', name: 'Codeforces Only' } });
    await prisma.platformProfile.create({ data: { studentId: student.id, platform: 'CODEFORCES', username: 'cf_user' } });
    const snapshot = await getAdapter('CODEFORCES', 'mock').fetchAll('cf_user', { force: true });
    await ingestSnapshot(student.id, snapshot);
    await recomputeStudentAnalytics(student.id);

    const analytics = await prisma.studentAnalytics.findUniqueOrThrow({ where: { studentId: student.id } });
    expect(analytics.difficultyKnown).toBe(true);
    expect(analytics.topicsKnown).toBe(true);
    expect(analytics.contestsKnown).toBe(true);
  });

  it('excludes students with no retrieved data from the leaderboard', async () => {
    const file = await buildWorkbook();
    const preview = await createUpload({ originalname: 'students.xlsx', path: file, size: 1024 }, null);
    const result = await commitUpload(preview.uploadId, { mapping: preview.suggestedMapping, startProcessing: true });
    await drainJob(result.job!.jobId);

    const board = await getLeaderboard({});
    const names = board.data.map((r) => r.name);
    expect(names).not.toContain('Test No Profile');
    // Ranking is dense and ordered best-first.
    expect(board.data[0]!.rank).toBe(1);
    expect(board.data[0]!.cpScore).toBeGreaterThanOrEqual(board.data.at(-1)!.cpScore);
  });

  it('builds batch analytics with averages, medians and highlights', async () => {
    const file = await buildWorkbook();
    const preview = await createUpload({ originalname: 'students.xlsx', path: file, size: 1024 }, null);
    const result = await commitUpload(preview.uploadId, { mapping: preview.suggestedMapping, startProcessing: true });
    await drainJob(result.job!.jobId);

    const batch = await getBatchAnalytics('2023-26');
    expect(batch.studentCount).toBe(4);
    expect(batch.averages.problemsSolved.average).toBeGreaterThan(0);
    expect(batch.averages.problemsSolved.median).toBeGreaterThan(0);
    expect(batch.highlights.topStudent?.name).toBe('Test Elite');
    expect(batch.platformAdoption.length).toBeGreaterThan(0);
  });

  it('writes a dated snapshot so growth can be charted', async () => {
    const student = await prisma.student.create({ data: { studentId: '5001', name: 'Snapshot Student' } });
    await prisma.platformProfile.create({ data: { studentId: student.id, platform: 'LEETCODE', username: 'snap_user' } });

    const snapshot = await getAdapter('LEETCODE', 'mock').fetchAll('snap_user', { force: true });
    await ingestSnapshot(student.id, snapshot);
    await recomputeStudentAnalytics(student.id);

    // Re-running on the same day updates rather than duplicating.
    await ingestSnapshot(student.id, snapshot);
    await recomputeStudentAnalytics(student.id);

    const perPlatform = await prisma.dataSnapshot.count({ where: { studentId: student.id, platform: 'LEETCODE' } });
    const aggregate = await prisma.dataSnapshot.count({ where: { studentId: student.id, platform: null } });
    expect(perPlatform).toBe(1);
    expect(aggregate).toBe(1);
  });

  it('generates reports in every supported format', async () => {
    const file = await buildWorkbook();
    const preview = await createUpload({ originalname: 'students.xlsx', path: file, size: 1024 }, null);
    const result = await commitUpload(preview.uploadId, { mapping: preview.suggestedMapping, startProcessing: true });
    await drainJob(result.job!.jobId);

    const student = await prisma.student.findFirstOrThrow({ where: { studentId: '3001' } });

    const pdf = await generateStudentReport(student.id, 'pdf');
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.buffer.length).toBeGreaterThan(1000);

    const xlsx = await generateStudentReport(student.id, 'xlsx');
    expect(xlsx.buffer.subarray(0, 2).toString()).toBe('PK');

    const csv = await generateStudentReport(student.id, 'csv');
    expect(csv.buffer.toString()).toContain('Student ID');
  });

  it('reports N/A rather than 0 in a report for a student with no data', async () => {
    const student = await prisma.student.create({ data: { studentId: '6001', name: 'Empty Student' } });
    await recomputeStudentAnalytics(student.id);

    const csv = (await generateStudentReport(student.id, 'csv')).buffer.toString();
    expect(csv).toContain('N/A');
    expect(csv).not.toMatch(/Total Problems Solved,0/);
  });

  it('skips profiles that are still inside the cache window unless forced', async () => {
    const file = await buildWorkbook();
    const preview = await createUpload({ originalname: 'students.xlsx', path: file, size: 1024 }, null);
    const first = await commitUpload(preview.uploadId, { mapping: preview.suggestedMapping, startProcessing: true });
    await drainJob(first.job!.jobId);

    const { createProcessingJob } = await import('../src/services/processing.service.js');

    // A non-forced refresh straight afterwards skips everything that succeeded,
    // but still picks up the profiles that never returned data — those have no
    // `lastSuccessAt` and are therefore not "fresh".
    const unforced = await createProcessingJob({ type: 'REFRESH_ALL', force: false });
    expect(unforced.skippedFresh).toBe(8);
    expect(unforced.totalItems).toBe(3);

    const forced = await createProcessingJob({ type: 'REFRESH_ALL', force: true });
    expect(forced.skippedFresh).toBe(0);
    expect(forced.totalItems).toBe(11);
  });
});
