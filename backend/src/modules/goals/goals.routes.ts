import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, requireTrainer } from '../../middleware/auth.js';
import { parsedQuery, validateBody, validateQuery } from '../../middleware/validate.js';
import { badRequest, notFound } from '../../lib/errors.js';
import {
  GOAL_METRICS,
  METRIC_DECIMALS,
  METRIC_LABELS,
  computeGoalProgress,
  daysUntil,
  describeScope,
  outcomeFor,
} from '../../services/goals.service.js';
import { buildStudentWhere, type StudentFilters } from '../students/students.service.js';

const metricEnum = z.enum([...GOAL_METRICS] as [string, ...string[]]);

const goalBody = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullish(),
  university: z.string().trim().max(200).nullish(),
  college: z.string().trim().max(200).nullish(),
  batch: z.string().trim().max(100).nullish(),
  branch: z.string().trim().max(100).nullish(),
  section: z.string().trim().max(50).nullish(),
  startsOn: z.coerce.date(),
  dueOn: z.coerce.date(),
  isActive: z.boolean().default(true),
  targets: z
    .array(z.object({ metric: metricEnum, target: z.number().min(0).max(1_000_000) }))
    .min(1, 'A goal needs at least one target')
    .max(GOAL_METRICS.length),
});

/** Empty strings from a form mean "no scope", not a cohort literally named "". */
const blankToNull = (v: string | null | undefined) => (v == null || v.trim() === '' ? null : v.trim());

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

goalsRouter.get('/metrics', (_req, res) => {
  res.json({
    data: GOAL_METRICS.map((metric) => ({
      metric,
      label: METRIC_LABELS[metric],
      decimals: METRIC_DECIMALS[metric],
    })),
  });
});

const listQuery = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  batch: z.string().optional(),
  college: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
});

goalsRouter.get(
  '/',
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const { includeInactive, ...filters } = parsedQuery<z.infer<typeof listQuery>>(req);

    const goals = await prisma.goal.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { targets: true, createdBy: { select: { name: true } } },
      orderBy: [{ isActive: 'desc' }, { dueOn: 'asc' }],
    });

    const withProgress = await Promise.all(
      goals.map(async (goal) => ({
        ...serializeGoal(goal),
        progress: await computeGoalProgress(goal, filters as StudentFilters),
      })),
    );

    res.json({ data: withProgress });
  }),
);

goalsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const goal = await prisma.goal.findUnique({
      where: { id: req.params.id! },
      include: { targets: true, createdBy: { select: { name: true } } },
    });
    if (!goal) throw notFound('Goal not found');

    res.json({ data: { ...serializeGoal(goal), progress: await computeGoalProgress(goal) } });
  }),
);

/**
 * The students behind the roll-up.
 *
 * A percentage nobody can drill into is a number to argue with rather than act
 * on, so every cohort figure has to be openable into the list of names it came
 * from — including the students the metric could not be measured for.
 */
const rosterQuery = z.object({
  outcome: z.enum(['MET', 'BEHIND', 'UNKNOWN', 'NO_DATA']).optional(),
  metric: metricEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

goalsRouter.get(
  '/:id/students',
  validateQuery(rosterQuery),
  asyncHandler(async (req, res) => {
    const goal = await prisma.goal.findUnique({ where: { id: req.params.id! }, include: { targets: true } });
    if (!goal) throw notFound('Goal not found');

    const q = parsedQuery<z.infer<typeof rosterQuery>>(req);
    const where = buildStudentWhere({
      ...(goal.university ? { university: goal.university } : {}),
      ...(goal.college ? { college: goal.college } : {}),
      ...(goal.batch ? { batch: goal.batch } : {}),
      ...(goal.branch ? { branch: goal.branch } : {}),
      ...(goal.section ? { section: goal.section } : {}),
    });

    const students = await prisma.student.findMany({
      where,
      select: {
        id: true,
        studentId: true,
        name: true,
        college: true,
        batch: true,
        branch: true,
        analytics: true,
      },
      orderBy: { name: 'asc' },
      take: 20_000,
    });

    const rows = students.map((student) => ({
      id: student.id,
      studentId: student.studentId,
      name: student.name,
      college: student.college,
      batch: student.batch,
      branch: student.branch,
      targets: goal.targets.map((t) => ({
        metric: t.metric,
        label: METRIC_LABELS[t.metric],
        target: t.target,
        ...outcomeFor(student.analytics, t.metric, t.target),
      })),
    }));

    const matching = rows.filter((row) => {
      const considered = q.metric ? row.targets.filter((t) => t.metric === q.metric) : row.targets;
      if (considered.length === 0) return false;
      if (!q.outcome) return true;
      // "MET" means every considered target is met; the others mean at least one.
      return q.outcome === 'MET'
        ? considered.every((t) => t.outcome === 'MET')
        : considered.some((t) => t.outcome === q.outcome);
    });

    const start = (q.page - 1) * q.pageSize;
    res.json({
      data: matching.slice(start, start + q.pageSize),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total: matching.length,
        totalPages: Math.ceil(matching.length / q.pageSize),
      },
    });
  }),
);

goalsRouter.post(
  '/',
  requireTrainer,
  validateBody(goalBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof goalBody>;
    if (body.dueOn <= body.startsOn) throw badRequest('The due date must be after the start date');

    const goal = await prisma.goal.create({
      data: {
        name: body.name,
        description: blankToNull(body.description),
        university: blankToNull(body.university),
        college: blankToNull(body.college),
        batch: blankToNull(body.batch),
        branch: blankToNull(body.branch),
        section: blankToNull(body.section),
        startsOn: body.startsOn,
        dueOn: body.dueOn,
        isActive: body.isActive,
        createdById: req.user!.sub,
        targets: { create: body.targets.map((t) => ({ metric: t.metric as never, target: t.target })) },
      },
      include: { targets: true, createdBy: { select: { name: true } } },
    });

    res.status(201).json({ data: { ...serializeGoal(goal), progress: await computeGoalProgress(goal) } });
  }),
);

goalsRouter.patch(
  '/:id',
  requireTrainer,
  validateBody(goalBody.partial()),
  asyncHandler(async (req, res) => {
    const existing = await prisma.goal.findUnique({ where: { id: req.params.id! } });
    if (!existing) throw notFound('Goal not found');

    const body = req.body as Partial<z.infer<typeof goalBody>>;
    const startsOn = body.startsOn ?? existing.startsOn;
    const dueOn = body.dueOn ?? existing.dueOn;
    if (dueOn <= startsOn) throw badRequest('The due date must be after the start date');

    const goal = await prisma.goal.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: blankToNull(body.description) } : {}),
        ...(body.university !== undefined ? { university: blankToNull(body.university) } : {}),
        ...(body.college !== undefined ? { college: blankToNull(body.college) } : {}),
        ...(body.batch !== undefined ? { batch: blankToNull(body.batch) } : {}),
        ...(body.branch !== undefined ? { branch: blankToNull(body.branch) } : {}),
        ...(body.section !== undefined ? { section: blankToNull(body.section) } : {}),
        ...(body.startsOn !== undefined ? { startsOn: body.startsOn } : {}),
        ...(body.dueOn !== undefined ? { dueOn: body.dueOn } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        // Targets are replaced wholesale: editing a goal's targets piecemeal
        // would leave progress meaning different things before and after.
        ...(body.targets
          ? {
              targets: {
                deleteMany: {},
                create: body.targets.map((t) => ({ metric: t.metric as never, target: t.target })),
              },
            }
          : {}),
      },
      include: { targets: true, createdBy: { select: { name: true } } },
    });

    res.json({ data: { ...serializeGoal(goal), progress: await computeGoalProgress(goal) } });
  }),
);

goalsRouter.delete(
  '/:id',
  requireTrainer,
  asyncHandler(async (req, res) => {
    const existing = await prisma.goal.findUnique({ where: { id: req.params.id! } });
    if (!existing) throw notFound('Goal not found');
    await prisma.goal.delete({ where: { id: existing.id } });
    res.status(204).send();
  }),
);

function serializeGoal(goal: {
  id: string;
  name: string;
  description: string | null;
  university: string | null;
  college: string | null;
  batch: string | null;
  branch: string | null;
  section: string | null;
  startsOn: Date;
  dueOn: Date;
  isActive: boolean;
  createdAt: Date;
  createdBy?: { name: string } | null;
  targets: { metric: string; target: number }[];
}) {
  return {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    university: goal.university,
    college: goal.college,
    batch: goal.batch,
    branch: goal.branch,
    section: goal.section,
    scope: describeScope(goal),
    startsOn: goal.startsOn,
    dueOn: goal.dueOn,
    daysLeft: daysUntil(goal.dueOn),
    isActive: goal.isActive,
    createdAt: goal.createdAt,
    createdBy: goal.createdBy?.name ?? null,
    targets: goal.targets.map((t) => ({
      metric: t.metric,
      label: METRIC_LABELS[t.metric as keyof typeof METRIC_LABELS],
      target: t.target,
      decimals: METRIC_DECIMALS[t.metric as keyof typeof METRIC_DECIMALS],
    })),
  };
}
