import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { prepareTestDatabase, truncateAll } from './helpers/db.js';
import { computeGoalProgress, getGoalsForStudent } from '../src/services/goals.service.js';
import {
  getShareLinkStatus,
  issueShareLink,
  resolveSharedView,
  revokeShareLink,
} from '../src/services/share.service.js';

const DAY = 86_400_000;

beforeAll(async () => {
  await prepareTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Creates a student and their analytics row directly. Goals read from the
 * materialized analytics, so driving the whole fetch pipeline would test the
 * pipeline rather than the goal logic.
 */
async function makeStudent(
  studentId: string,
  name: string,
  analytics: Partial<{
    totalSolved: number;
    totalContests: number;
    cpScore: number;
    currentRating: number | null;
    topicCount: number;
    hasData: boolean;
    contestsKnown: boolean;
    topicsKnown: boolean;
  }> = {},
  cohort: { batch?: string; college?: string; branch?: string } = {},
) {
  const student = await prisma.student.create({
    data: { studentId, name, batch: cohort.batch ?? '2023-26', college: cohort.college ?? 'Test College', branch: cohort.branch ?? 'CSE' },
  });
  await prisma.studentAnalytics.create({
    data: {
      studentId: student.id,
      totalSolved: analytics.totalSolved ?? 0,
      totalContests: analytics.totalContests ?? 0,
      cpScore: analytics.cpScore ?? 0,
      currentRating: analytics.currentRating === undefined ? null : analytics.currentRating,
      topicCount: analytics.topicCount ?? 0,
      hasData: analytics.hasData ?? true,
      contestsKnown: analytics.contestsKnown ?? true,
      topicsKnown: analytics.topicsKnown ?? true,
    },
  });
  return student;
}

async function makeGoal(
  targets: { metric: 'PROBLEMS_SOLVED' | 'CONTESTS_ATTENDED' | 'CP_SCORE' | 'CONTEST_RATING' | 'TOPICS_COVERED'; target: number }[],
  scope: Partial<{ batch: string; college: string; branch: string }> = {},
  window: { startsOn?: Date; dueOn?: Date } = {},
) {
  return prisma.goal.create({
    data: {
      name: 'Placement readiness',
      batch: scope.batch ?? null,
      college: scope.college ?? null,
      branch: scope.branch ?? null,
      startsOn: window.startsOn ?? new Date(Date.now() - 30 * DAY),
      dueOn: window.dueOn ?? new Date(Date.now() + 30 * DAY),
      targets: { create: targets },
    },
    include: { targets: true },
  });
}

describe('goal progress across a cohort', () => {
  it('counts who is meeting the target and who is short', async () => {
    await makeStudent('1', 'Ahead', { totalSolved: 250 });
    await makeStudent('2', 'Ahead too', { totalSolved: 200 });
    await makeStudent('3', 'Short', { totalSolved: 40 });

    const goal = await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }]);
    const progress = await computeGoalProgress(goal);

    expect(progress.studentsInScope).toBe(3);
    expect(progress.onTrack).toBe(2);
    expect(progress.targets[0]).toMatchObject({ met: 2, behind: 1, unknown: 0, noData: 0, metRate: 66.7 });
  });

  it('reports the median shortfall so "how far off" has an answer', async () => {
    await makeStudent('1', 'A', { totalSolved: 150 }); // 50 short
    await makeStudent('2', 'B', { totalSolved: 100 }); // 100 short
    await makeStudent('3', 'C', { totalSolved: 50 }); //  150 short

    const goal = await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }]);
    expect((await computeGoalProgress(goal)).targets[0]!.medianRemaining).toBe(100);
  });

  it('never counts a student as behind on a metric their platforms do not publish', async () => {
    await makeStudent('1', 'Has contests', { totalContests: 5 });
    await makeStudent('2', 'HackerRank only', { totalContests: 0, contestsKnown: false });

    const goal = await makeGoal([{ metric: 'CONTESTS_ATTENDED', target: 3 }]);
    const progress = await computeGoalProgress(goal);

    expect(progress.targets[0]).toMatchObject({ met: 1, behind: 0, unknown: 1 });
    // The rate is over the students it is measurable for — one of one, not one
    // of two. Folding the unmeasurable student in would report a platform's
    // silence as a student missing a target.
    expect(progress.targets[0]!.metRate).toBe(100);
  });

  it('keeps students with no data at all out of the rate entirely', async () => {
    await makeStudent('1', 'Measured', { totalSolved: 300 });
    await makeStudent('2', 'Never fetched', { hasData: false });

    const goal = await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }]);
    const progress = await computeGoalProgress(goal);

    expect(progress.targets[0]).toMatchObject({ met: 1, behind: 0, unknown: 0, noData: 1, metRate: 100 });
    expect(progress.onTrack).toBe(1);
  });

  it('reports a rate of null rather than 0% when nobody can be measured', async () => {
    await makeStudent('1', 'Unmeasurable', { contestsKnown: false });

    const goal = await makeGoal([{ metric: 'CONTESTS_ATTENDED', target: 3 }]);
    const progress = await computeGoalProgress(goal);

    // 0% would read as "everybody failed". Null reads as "we cannot say".
    expect(progress.targets[0]!.metRate).toBeNull();
    expect(progress.targets[0]!.unknown).toBe(1);
  });

  it('counts a student on track only when every measurable target is met', async () => {
    await makeStudent('1', 'Both', { totalSolved: 300, totalContests: 5 });
    await makeStudent('2', 'Solved only', { totalSolved: 300, totalContests: 0 });

    const goal = await makeGoal([
      { metric: 'PROBLEMS_SOLVED', target: 200 },
      { metric: 'CONTESTS_ATTENDED', target: 3 },
    ]);
    expect((await computeGoalProgress(goal)).onTrack).toBe(1);
  });

  it('holds a goal to its cohort', async () => {
    await makeStudent('1', 'In scope', { totalSolved: 300 }, { batch: '2023-26' });
    await makeStudent('2', 'Other batch', { totalSolved: 300 }, { batch: '2024-27' });

    const goal = await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }], { batch: '2023-26' });
    expect((await computeGoalProgress(goal)).studentsInScope).toBe(1);
  });

  it('applies an unscoped goal to everyone', async () => {
    await makeStudent('1', 'A', {}, { batch: '2023-26' });
    await makeStudent('2', 'B', {}, { batch: '2024-27' });

    const goal = await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }]);
    expect((await computeGoalProgress(goal)).studentsInScope).toBe(2);
  });
});

describe('a student’s own goals', () => {
  it('picks up every goal whose scope covers them, and no others', async () => {
    const student = await makeStudent('1', 'Scoped', { totalSolved: 100 }, { batch: '2023-26', branch: 'CSE' });

    await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }]); // everyone
    await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 150 }], { batch: '2023-26' });
    await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 400 }], { batch: '2024-27' }); // not theirs

    const goals = await getGoalsForStudent(student.id);
    expect(goals).toHaveLength(2);
    expect(goals.flatMap((g) => g.targets.map((t) => t.target)).sort()).toEqual([150, 200]);
  });

  it('states what is left and the weekly pace that would close it', async () => {
    const student = await makeStudent('1', 'Behind', { totalSolved: 100 });
    await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 170 }], {}, { dueOn: new Date(Date.now() + 14 * DAY) });

    const [goal] = await getGoalsForStudent(student.id);
    expect(goal!.targets[0]).toMatchObject({ outcome: 'BEHIND', value: 100, remaining: 70 });
    expect(goal!.targets[0]!.requiredPerWeek).toBe(35);
  });

  it('reports the ground actually covered since the goal opened', async () => {
    const student = await makeStudent('1', 'Working', { totalSolved: 120 });
    const startsOn = new Date(Date.now() - 28 * DAY);
    await prisma.dataSnapshot.createMany({
      data: [
        { studentId: student.id, platform: null, capturedAt: new Date(Date.now() - 28 * DAY), totalSolved: 60 },
        { studentId: student.id, platform: null, capturedAt: new Date(Date.now() - 1 * DAY), totalSolved: 120 },
      ],
    });
    await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }], {}, { startsOn });

    const [goal] = await getGoalsForStudent(student.id);
    expect(goal!.targets[0]!.observedGain).toBe(60);
    expect(goal!.targets[0]!.observedOverDays).toBe(27);
  });

  it('says nothing about observed progress when there is only one reading', async () => {
    const student = await makeStudent('1', 'One reading', { totalSolved: 120 });
    await prisma.dataSnapshot.create({
      data: { studentId: student.id, platform: null, capturedAt: new Date(), totalSolved: 120 },
    });
    await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }]);

    const [goal] = await getGoalsForStudent(student.id);
    expect(goal!.targets[0]!.observedGain).toBeNull();
  });

  it('ignores inactive goals', async () => {
    const student = await makeStudent('1', 'Someone');
    const goal = await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }]);
    await prisma.goal.update({ where: { id: goal.id }, data: { isActive: false } });

    expect(await getGoalsForStudent(student.id)).toHaveLength(0);
  });
});

describe('shareable student links', () => {
  it('issues a working link and resolves it to that student', async () => {
    const student = await makeStudent('1', 'Priya Singh', { totalSolved: 180, cpScore: 55 });
    const issued = await issueShareLink(student.id);

    const token = issued.url.split('/me/')[1]!;
    const view = await resolveSharedView(token);

    expect(view?.student.name).toBe('Priya Singh');
    expect(view?.analytics?.totalSolved).toBe(180);
  });

  it('stores the token hashed, so the database never holds a working link', async () => {
    const student = await makeStudent('1', 'Someone');
    const issued = await issueShareLink(student.id);
    const token = issued.url.split('/me/')[1]!;

    const stored = await prisma.studentShareLink.findUniqueOrThrow({ where: { studentId: student.id } });
    expect(stored.tokenHash).not.toContain(token);
    expect(stored.tokenHash).toHaveLength(64);
    // And the status view cannot hand the link back either.
    expect((await getShareLinkStatus(student.id))?.url).toBeNull();
  });

  it('never exposes contact details or internal notes', async () => {
    const student = await prisma.student.create({
      data: { studentId: '1', name: 'Private Person', email: 'private@x.edu', phone: '555', notes: 'Internal note' },
    });
    await prisma.studentAnalytics.create({ data: { studentId: student.id, hasData: true } });

    const issued = await issueShareLink(student.id);
    const view = await resolveSharedView(issued.url.split('/me/')[1]!);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('private@x.edu');
    expect(serialized).not.toContain('Internal note');
    expect(serialized).not.toContain('555');
  });

  it('regenerating replaces the old link rather than adding a second', async () => {
    const student = await makeStudent('1', 'Someone');
    const first = await issueShareLink(student.id);
    const second = await issueShareLink(student.id);

    expect(await resolveSharedView(first.url.split('/me/')[1]!)).toBeNull();
    expect(await resolveSharedView(second.url.split('/me/')[1]!)).not.toBeNull();
    expect(await prisma.studentShareLink.count()).toBe(1);
  });

  it('stops working once revoked', async () => {
    const student = await makeStudent('1', 'Someone');
    const issued = await issueShareLink(student.id);
    const token = issued.url.split('/me/')[1]!;

    expect(await resolveSharedView(token)).not.toBeNull();
    expect(await revokeShareLink(student.id)).toBe(true);
    expect(await resolveSharedView(token)).toBeNull();
  });

  it('stops working once expired', async () => {
    const student = await makeStudent('1', 'Someone');
    const issued = await issueShareLink(student.id, { expiresAt: new Date(Date.now() + 50) });
    const token = issued.url.split('/me/')[1]!;

    expect(await resolveSharedView(token)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 80));
    expect(await resolveSharedView(token)).toBeNull();
  });

  it('rejects an unknown token without telling the caller anything', async () => {
    expect(await resolveSharedView('not-a-real-token')).toBeNull();
  });

  it('stops working when the student is deactivated', async () => {
    const student = await makeStudent('1', 'Someone');
    const issued = await issueShareLink(student.id);
    await prisma.student.update({ where: { id: student.id }, data: { isActive: false } });

    expect(await resolveSharedView(issued.url.split('/me/')[1]!)).toBeNull();
  });

  it('shows the student their own goals', async () => {
    const student = await makeStudent('1', 'Goal haver', { totalSolved: 100 });
    await makeGoal([{ metric: 'PROBLEMS_SOLVED', target: 200 }]);

    const issued = await issueShareLink(student.id);
    const view = await resolveSharedView(issued.url.split('/me/')[1]!);

    expect(view?.goals).toHaveLength(1);
    expect(view?.goals[0]!.targets[0]).toMatchObject({ outcome: 'BEHIND', remaining: 100 });
  });

  it('shows a student their own position without naming anyone else', async () => {
    const student = await makeStudent('1', 'Middle', { cpScore: 50 });
    await makeStudent('2', 'Better', { cpScore: 90 });
    await makeStudent('3', 'Worse', { cpScore: 10 });

    const issued = await issueShareLink(student.id);
    const view = await resolveSharedView(issued.url.split('/me/')[1]!);

    expect(view?.rank).toMatchObject({ position: 2, of: 3 });
    expect(JSON.stringify(view)).not.toContain('Better');
  });

  it('does not rank a student we have no data for', async () => {
    const student = await makeStudent('1', 'Unfetched', { hasData: false });
    const issued = await issueShareLink(student.id);

    // An unranked student is not last.
    expect((await resolveSharedView(issued.url.split('/me/')[1]!))?.rank).toBeNull();
  });

  it('hides our own collection failures from the student', async () => {
    const student = await makeStudent('1', 'Someone');
    await prisma.studentAlert.createMany({
      data: [
        { studentId: student.id, type: 'STALE_DATA', severity: 'WARNING', message: 'We stopped fetching' },
        { studentId: student.id, type: 'NO_PROGRESS', severity: 'WARNING', message: 'Nothing solved in 21 days' },
      ],
    });

    const issued = await issueShareLink(student.id);
    const view = await resolveSharedView(issued.url.split('/me/')[1]!);

    // "We have not refreshed you" is not news the student can act on.
    expect(view?.concerns.map((c) => c.type)).toEqual(['NO_PROGRESS']);
  });

  it('counts views so a coordinator can see whether links are opened', async () => {
    const student = await makeStudent('1', 'Someone');
    const issued = await issueShareLink(student.id);
    const token = issued.url.split('/me/')[1]!;

    await resolveSharedView(token);
    await resolveSharedView(token);
    // The counter is incremented off the response path, so give it a tick.
    await new Promise((r) => setTimeout(r, 120));

    const status = await getShareLinkStatus(student.id);
    expect(status?.viewCount).toBe(2);
    expect(status?.lastViewedAt).not.toBeNull();
  });
});
