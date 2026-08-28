import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../src/db/prisma.js';

let prepared = false;

/**
 * Pushes the schema into the dedicated test database once per run.
 * Set TEST_DATABASE_URL to override the default (see tests/setup.ts).
 */
export async function prepareTestDatabase(): Promise<void> {
  if (prepared) return;
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env },
    stdio: 'pipe',
  });
  prepared = true;
}

/** Wipes every table so cases never leak into each other. */
export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      users, refresh_tokens, students, platform_profiles, problems, topics,
      problem_topics, student_problems, student_topics, contests, contest_results,
      rating_history, data_snapshots, upload_batches, processing_jobs,
      processing_job_items, platform_errors, student_analytics, student_skills,
      student_alerts, scheduled_runs, goal_targets, goals, student_share_links,
      app_settings, platform_cache
    RESTART IDENTITY CASCADE
  `);
}
