import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, requireTrainer } from '../../middleware/auth.js';
import { parsedQuery, validateBody, validateQuery } from '../../middleware/validate.js';
import { notFound } from '../../lib/errors.js';
import { ALERT_LABELS, ALERT_TYPES, evaluateAllAlerts, getAlertSummary } from '../../services/alerts.service.js';
import { getScheduleStatus, runNow } from '../../services/scheduler.js';
import { buildStudentWhere, type StudentFilters } from '../students/students.service.js';

const alertTypeEnum = z.enum([...ALERT_TYPES] as [string, ...string[]]);

const listSchema = z.object({
  type: alertTypeEnum.optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  /** Acknowledged alerts are hidden unless explicitly asked for. */
  includeAcknowledged: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  college: z.string().optional(),
  batch: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

/** The catalogue, so the UI can label and filter without hardcoding. */
alertsRouter.get('/types', (_req, res) => {
  res.json({ data: ALERT_TYPES.map((type) => ({ type, label: ALERT_LABELS[type] })) });
});

alertsRouter.get(
  '/',
  validateQuery(listSchema),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<z.infer<typeof listSchema>>(req);
    const { type, severity, includeAcknowledged, page, pageSize, ...filters } = q;

    const studentWhere = buildStudentWhere(filters as StudentFilters);
    const where = {
      ...(type ? { type: type as never } : {}),
      ...(severity ? { severity: severity as never } : {}),
      ...(includeAcknowledged ? {} : { acknowledgedAt: null }),
      student: studentWhere,
    };

    const [total, alerts, summary] = await Promise.all([
      prisma.studentAlert.count({ where }),
      prisma.studentAlert.findMany({
        where,
        // Most severe first, then longest-standing — the ones that have been
        // true for weeks matter more than the ones detected this morning.
        orderBy: [{ severity: 'desc' }, { detectedAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          student: {
            select: {
              id: true,
              studentId: true,
              name: true,
              email: true,
              college: true,
              batch: true,
              branch: true,
              section: true,
              analytics: { select: { totalSolved: true, currentRating: true, cpScore: true, hasData: true } },
            },
          },
          acknowledgedBy: { select: { name: true } },
        },
      }),
      getAlertSummary({ student: studentWhere, ...(includeAcknowledged ? {} : { acknowledgedAt: null }) }),
    ]);

    res.json({
      data: alerts.map((alert) => ({
        id: alert.id,
        type: alert.type,
        label: ALERT_LABELS[alert.type],
        severity: alert.severity,
        message: alert.message,
        evidence: alert.evidence,
        detectedAt: alert.detectedAt,
        acknowledgedAt: alert.acknowledgedAt,
        acknowledgedBy: alert.acknowledgedBy?.name ?? null,
        student: alert.student,
      })),
      summary,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  }),
);

alertsRouter.get(
  '/summary',
  validateQuery(listSchema.pick({ college: true, batch: true, branch: true, section: true })),
  asyncHandler(async (req, res) => {
    const filters = parsedQuery<StudentFilters>(req);
    res.json({ data: await getAlertSummary({ student: buildStudentWhere(filters), acknowledgedAt: null }) });
  }),
);

alertsRouter.post(
  '/:id/acknowledge',
  requireTrainer,
  validateBody(z.object({ acknowledged: z.boolean().default(true) })),
  asyncHandler(async (req, res) => {
    const alert = await prisma.studentAlert.findUnique({ where: { id: req.params.id! } });
    if (!alert) throw notFound('Alert not found');

    const updated = await prisma.studentAlert.update({
      where: { id: alert.id },
      data: req.body.acknowledged
        ? { acknowledgedAt: new Date(), acknowledgedById: req.user!.sub }
        : { acknowledgedAt: null, acknowledgedById: null },
    });
    res.json({ data: updated });
  }),
);

alertsRouter.post(
  '/recompute',
  requireTrainer,
  asyncHandler(async (_req, res) => {
    const evaluated = await evaluateAllAlerts();
    res.json({ message: `Re-evaluated ${evaluated} students`, evaluated });
  }),
);

// -- automation ---------------------------------------------------------------

export const scheduleRouter = Router();
scheduleRouter.use(requireAuth);

scheduleRouter.get(
  '/',
  asyncHandler(async (_req, res) => res.json({ data: await getScheduleStatus() })),
);

/** Starts a refresh immediately, independently of the schedule. */
scheduleRouter.post(
  '/run-now',
  requireTrainer,
  asyncHandler(async (_req, res) => {
    const result = await runNow();
    res.status(result.ran ? 202 : 200).json({ data: result });
  }),
);
