/**
 * Seeds users, a realistic cohort of students, and (in mock mode) a full set of
 * retrieved platform data plus backdated snapshots so every dashboard has
 * something to show immediately after `npm run db:seed`.
 *
 * Handles are chosen to exercise every data-availability branch — see
 * `src/platforms/mock/scenarios.ts` for the markers.
 */
import type { Platform } from '@prisma/client';
import { prisma } from '../src/db/prisma.js';
import { env } from '../src/config/env.js';
import { ALL_PLATFORMS } from '../src/config/platforms.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import { getAdapter } from '../src/platforms/registry.js';
import { ingestSnapshot } from '../src/services/ingest.service.js';
import { ensureAnalyticsRows, recomputeStudentAnalytics } from '../src/services/analytics.service.js';
import { logger } from '../src/lib/logger.js';

interface SeedStudent {
  studentId: string;
  name: string;
  email: string;
  college: string;
  university: string;
  batch: string;
  branch: string;
  section: string;
  handles: Partial<Record<Platform, string>>;
  note: string;
}

const COLLEGES = [
  { college: 'ABC Institute of Technology', university: 'ABC University' },
  { college: 'Northline Engineering College', university: 'Northline University' },
  { college: 'Riverside Institute of Science', university: 'Riverside University' },
];

const SEED_STUDENTS: SeedStudent[] = [
  // -- high performers, active everywhere ------------------------------------
  {
    studentId: '1001', name: 'Rahul Sharma', email: 'rahul.sharma@abc.edu', ...COLLEGES[0]!,
    batch: '2023-26', branch: 'CSE', section: 'A',
    handles: { LEETCODE: 'rahul_elite', CODECHEF: 'rahul_elite_cc', HACKERRANK: 'rahul_elite_hr', CODEFORCES: 'rahul_elite_cf' },
    note: 'Elite performer, active on all four platforms',
  },
  {
    studentId: '1002', name: 'Priya Singh', email: 'priya.singh@abc.edu', ...COLLEGES[0]!,
    batch: '2023-26', branch: 'CSE', section: 'A',
    handles: { LEETCODE: 'priya_elite', CODECHEF: 'priya_pro', HACKERRANK: 'priya_pro_hr', CODEFORCES: 'priya_elite_cf' },
    note: 'Elite performer, strong contest record',
  },
  {
    studentId: '1003', name: 'Amit Kumar', email: 'amit.kumar@abc.edu', ...COLLEGES[0]!,
    batch: '2023-26', branch: 'CSE', section: 'B',
    handles: { LEETCODE: 'amit_pro', CODECHEF: 'amit_pro_cc', CODEFORCES: 'amit_pro_cf' },
    note: 'High performer, no HackerRank account',
  },
  {
    studentId: '1004', name: 'Sneha Patel', email: 'sneha.patel@abc.edu', ...COLLEGES[0]!,
    batch: '2023-26', branch: 'IT', section: 'A',
    handles: { LEETCODE: 'sneha_pro', HACKERRANK: 'sneha_hr', CODEFORCES: 'sneha_ace_cf' },
    note: 'High performer across three platforms',
  },
  // -- average performers ----------------------------------------------------
  {
    studentId: '1005', name: 'Vikram Reddy', email: 'vikram.reddy@abc.edu', ...COLLEGES[0]!,
    batch: '2023-26', branch: 'CSE', section: 'B',
    handles: { LEETCODE: 'vikram_lc', CODECHEF: 'vikram_cc', HACKERRANK: 'vikram_hr', CODEFORCES: 'vikram_cf' },
    note: 'Average performer, all four platforms',
  },
  {
    studentId: '1006', name: 'Ananya Iyer', email: 'ananya.iyer@abc.edu', ...COLLEGES[0]!,
    batch: '2023-26', branch: 'ECE', section: 'A',
    handles: { LEETCODE: 'ananya_lc', CODEFORCES: 'ananya_cf' },
    note: 'Average performer, two platforms',
  },
  {
    studentId: '1007', name: 'Karan Mehta', email: 'karan.mehta@northline.edu', ...COLLEGES[1]!,
    batch: '2023-26', branch: 'CSE', section: 'A',
    handles: { LEETCODE: 'karan_lc', CODECHEF: 'karan_cc', CODEFORCES: 'karan_cf' },
    note: 'Average performer at a second college',
  },
  {
    studentId: '1008', name: 'Divya Nair', email: 'divya.nair@northline.edu', ...COLLEGES[1]!,
    batch: '2023-26', branch: 'CSE', section: 'B',
    handles: { LEETCODE: 'divya_lc', HACKERRANK: 'divya_hr' },
    note: 'Average performer, LeetCode + HackerRank only',
  },
  {
    studentId: '1009', name: 'Rohit Verma', email: 'rohit.verma@northline.edu', ...COLLEGES[1]!,
    batch: '2024-27', branch: 'IT', section: 'A',
    handles: { LEETCODE: 'rohit_lc', CODECHEF: 'rohit_cc', HACKERRANK: 'rohit_hr', CODEFORCES: 'rohit_cf' },
    note: 'Average performer, junior batch',
  },
  {
    studentId: '1010', name: 'Meera Joshi', email: 'meera.joshi@northline.edu', ...COLLEGES[1]!,
    batch: '2024-27', branch: 'CSE', section: 'A',
    handles: { LEETCODE: 'meera_lc', CODEFORCES: 'meera_cf' },
    note: 'Average performer, junior batch',
  },
  // -- beginners -------------------------------------------------------------
  {
    studentId: '1011', name: 'Arjun Das', email: 'arjun.das@riverside.edu', ...COLLEGES[2]!,
    batch: '2024-27', branch: 'CSE', section: 'B',
    handles: { LEETCODE: 'arjun_beginner', CODEFORCES: 'arjun_newbie_cf' },
    note: 'Beginner, just started practising',
  },
  {
    studentId: '1012', name: 'Nisha Gupta', email: 'nisha.gupta@riverside.edu', ...COLLEGES[2]!,
    batch: '2024-27', branch: 'IT', section: 'A',
    handles: { LEETCODE: 'nisha_fresher', HACKERRANK: 'nisha_beginner_hr' },
    note: 'Beginner on two platforms',
  },
  {
    studentId: '1013', name: 'Sanjay Rao', email: 'sanjay.rao@riverside.edu', ...COLLEGES[2]!,
    batch: '2025-28', branch: 'CSE', section: 'A',
    handles: { LEETCODE: 'sanjay_newbie', CODECHEF: 'sanjay_beginner_cc' },
    note: 'Beginner, first-year batch',
  },
  {
    studentId: '1014', name: 'Pooja Bhatt', email: 'pooja.bhatt@riverside.edu', ...COLLEGES[2]!,
    batch: '2025-28', branch: 'ECE', section: 'A',
    handles: { LEETCODE: 'pooja_inactive' },
    note: 'Registered but essentially inactive',
  },
  // -- data-availability edge cases -----------------------------------------
  {
    studentId: '1015', name: 'Harsh Malhotra', email: 'harsh.malhotra@abc.edu', ...COLLEGES[0]!,
    batch: '2023-26', branch: 'CSE', section: 'C',
    handles: { LEETCODE: 'harsh_notfound', CODEFORCES: 'harsh_cf' },
    note: 'LeetCode handle does not exist -> NOT_FOUND',
  },
  {
    studentId: '1016', name: 'Ishita Sen', email: 'ishita.sen@abc.edu', ...COLLEGES[0]!,
    batch: '2023-26', branch: 'CSE', section: 'C',
    handles: { LEETCODE: 'ishita_private', CODECHEF: 'ishita_cc' },
    note: 'Private LeetCode profile -> PRIVATE',
  },
  {
    studentId: '1017', name: 'Manish Tiwari', email: 'manish.tiwari@northline.edu', ...COLLEGES[1]!,
    batch: '2023-26', branch: 'IT', section: 'B',
    handles: { CODECHEF: 'manish_ratelimited', CODEFORCES: 'manish_cf' },
    note: 'CodeChef throttled us -> RATE_LIMITED, retryable',
  },
  {
    studentId: '1018', name: 'Farhan Ali', email: 'farhan.ali@northline.edu', ...COLLEGES[1]!,
    batch: '2023-26', branch: 'CSE', section: 'C',
    handles: { HACKERRANK: 'farhan_error', LEETCODE: 'farhan_lc' },
    note: 'HackerRank returned an unexpected response -> ERROR',
  },
  {
    studentId: '1019', name: 'Tanya Kapoor', email: 'tanya.kapoor@riverside.edu', ...COLLEGES[2]!,
    batch: '2024-27', branch: 'CSE', section: 'B',
    handles: { CODEFORCES: 'tanya_unavailable', LEETCODE: 'tanya_lc' },
    note: 'Codeforces temporarily unavailable -> UNAVAILABLE',
  },
  {
    studentId: '1020', name: 'Gaurav Chauhan', email: 'gaurav.chauhan@riverside.edu', ...COLLEGES[2]!,
    batch: '2024-27', branch: 'ECE', section: 'B',
    handles: {},
    note: 'No coding profile at all — imported but nothing to fetch',
  },
  // -- more coverage for batch/college dashboards ---------------------------
  {
    studentId: '1021', name: 'Simran Kaur', email: 'simran.kaur@abc.edu', ...COLLEGES[0]!,
    batch: '2024-27', branch: 'CSE', section: 'A',
    handles: { LEETCODE: 'simran_lc', CODECHEF: 'simran_cc', CODEFORCES: 'simran_cf' },
    note: 'Average performer',
  },
  {
    studentId: '1022', name: 'Aditya Bose', email: 'aditya.bose@abc.edu', ...COLLEGES[0]!,
    batch: '2024-27', branch: 'IT', section: 'B',
    handles: { LEETCODE: 'aditya_ace', CODEFORCES: 'aditya_ace_cf', HACKERRANK: 'aditya_hr' },
    note: 'High performer, junior batch',
  },
  {
    studentId: '1023', name: 'Ritu Sharma', email: 'ritu.sharma@northline.edu', ...COLLEGES[1]!,
    batch: '2025-28', branch: 'CSE', section: 'B',
    handles: { LEETCODE: 'ritu_beginner', HACKERRANK: 'ritu_hr' },
    note: 'Beginner, first-year batch',
  },
  {
    studentId: '1024', name: 'Nikhil Menon', email: 'nikhil.menon@riverside.edu', ...COLLEGES[2]!,
    batch: '2023-26', branch: 'CSE', section: 'A',
    handles: { LEETCODE: 'nikhil_topper', CODECHEF: 'nikhil_star_cc', CODEFORCES: 'nikhil_elite_cf', HACKERRANK: 'nikhil_hr' },
    note: 'Elite performer at a third college',
  },
];

async function seedUsers() {
  const admin = await prisma.user.upsert({
    where: { email: env.SEED_ADMIN_EMAIL },
    update: {},
    create: {
      email: env.SEED_ADMIN_EMAIL,
      name: 'Platform Administrator',
      role: 'ADMIN',
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
    },
  });

  await prisma.user.upsert({
    where: { email: 'trainer@tracker.local' },
    update: {},
    create: {
      email: 'trainer@tracker.local',
      name: 'Training Coordinator',
      role: 'TRAINER',
      passwordHash: await hashPassword('Trainer@12345'),
    },
  });

  await prisma.user.upsert({
    where: { email: 'viewer@tracker.local' },
    update: {},
    create: {
      email: 'viewer@tracker.local',
      name: 'Faculty Viewer',
      role: 'VIEWER',
      passwordHash: await hashPassword('Viewer@12345'),
    },
  });

  logger.info(`Seeded users (admin: ${admin.email})`);
  return admin;
}

async function seedStudents() {
  const wanted = SEED_STUDENTS.slice(0, Math.max(1, env.SEED_STUDENT_COUNT));
  const ids: string[] = [];

  for (const seed of wanted) {
    const student = await prisma.student.upsert({
      where: { studentId: seed.studentId },
      update: {
        name: seed.name, email: seed.email, college: seed.college, university: seed.university,
        batch: seed.batch, branch: seed.branch, section: seed.section, notes: seed.note,
      },
      create: {
        studentId: seed.studentId, name: seed.name, email: seed.email, college: seed.college,
        university: seed.university, batch: seed.batch, branch: seed.branch, section: seed.section, notes: seed.note,
      },
      select: { id: true },
    });
    ids.push(student.id);

    for (const platform of ALL_PLATFORMS) {
      const username = seed.handles[platform];
      if (!username) {
        await prisma.platformProfile.deleteMany({ where: { studentId: student.id, platform } });
        continue;
      }
      await prisma.platformProfile.upsert({
        where: { studentId_platform: { studentId: student.id, platform } },
        create: { studentId: student.id, platform, username, status: 'PENDING' },
        update: { username },
      });
    }
  }

  logger.info(`Seeded ${wanted.length} students`);
  return ids;
}

/** Fetches every profile through the configured data source and stores it. */
async function fetchAllProfiles(studentIds: string[]) {
  const profiles = await prisma.platformProfile.findMany({
    where: { studentId: { in: studentIds } },
    select: { studentId: true, platform: true, username: true },
  });

  let ok = 0;
  let failed = 0;

  for (const profile of profiles) {
    const adapter = getAdapter(profile.platform);
    const snapshot = await adapter.fetchAll(profile.username, { force: true });
    const outcome = await ingestSnapshot(profile.studentId, snapshot);
    if (outcome.status === 'AVAILABLE') ok += 1;
    else failed += 1;
  }

  logger.info(`Fetched ${profiles.length} profiles: ${ok} available, ${failed} unavailable`);
}

/**
 * Backdates weekly snapshots so the growth charts are populated on a fresh
 * install. Historical points are scaled down from the current totals — they are
 * clearly synthetic seed data and only exist in the seeded database.
 */
async function seedHistory(studentIds: string[]) {
  const analytics = await prisma.studentAnalytics.findMany({ where: { studentId: { in: studentIds }, hasData: true } });
  const weeks = 12;
  let created = 0;

  for (const row of analytics) {
    for (let week = weeks; week >= 1; week--) {
      const capturedAt = new Date(Date.now() - week * 7 * 86_400_000);
      // Linear ramp from ~55% of today's numbers to today's numbers.
      const factor = 0.55 + ((weeks - week) / weeks) * 0.45;
      const scale = (value: number | null) => (value === null ? null : Math.round(value * factor));

      const exists = await prisma.dataSnapshot.findFirst({
        where: {
          studentId: row.studentId,
          platform: null,
          capturedAt: { gte: new Date(capturedAt.getTime() - 43_200_000), lt: new Date(capturedAt.getTime() + 43_200_000) },
        },
        select: { id: true },
      });
      if (exists) continue;

      await prisma.dataSnapshot.create({
        data: {
          studentId: row.studentId,
          platform: null,
          capturedAt,
          totalSolved: scale(row.totalSolved),
          easySolved: scale(row.easySolved),
          mediumSolved: scale(row.mediumSolved),
          hardSolved: scale(row.hardSolved),
          rating: row.currentRating === null ? null : Math.round(800 + (row.currentRating - 800) * factor),
          maxRating: row.bestRating === null ? null : Math.round(800 + (row.bestRating - 800) * factor),
          contestsAttended: scale(row.totalContests),
          topicCount: scale(row.topicCount),
          cpScore: Math.round(row.cpScore * factor * 100) / 100,
          metrics: { seeded: true },
        },
      });
      created += 1;
    }
  }

  logger.info(`Seeded ${created} historical snapshots`);
}

async function main() {
  logger.info(`Seeding database (DATA_SOURCE=${env.DATA_SOURCE})`);
  await seedUsers();
  const studentIds = await seedStudents();
  await ensureAnalyticsRows(studentIds);

  if (env.DATA_SOURCE === 'mock') {
    await fetchAllProfiles(studentIds);
    for (const id of studentIds) await recomputeStudentAnalytics(id);
    await seedHistory(studentIds);
  } else {
    logger.warn('DATA_SOURCE=live — students were created but no profiles were fetched. Start a refresh job from the admin panel.');
  }

  logger.info('Seed complete.');
  logger.info(`  Admin:   ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD}`);
  logger.info('  Trainer: trainer@tracker.local / Trainer@12345');
  logger.info('  Viewer:  viewer@tracker.local / Viewer@12345');
}

main()
  .catch((err) => {
    logger.error('Seed failed', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
