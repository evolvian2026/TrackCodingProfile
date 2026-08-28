import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../db/prisma.js';
import { env, isTest } from '../../config/env.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, requireTrainer } from '../../middleware/auth.js';
import { parsedQuery, validateBody, validateQuery } from '../../middleware/validate.js';
import { badRequest, notFound } from '../../lib/errors.js';
import {
  getShareLinkStatus,
  issueShareLink,
  issueShareLinksFor,
  resolveSharedView,
  revokeShareLink,
  shareBaseUrl,
} from '../../services/share.service.js';
import { buildStudentWhere, type StudentFilters } from '../students/students.service.js';

// -- the public view ----------------------------------------------------------

export const publicShareRouter = Router();

/**
 * Tighter than the global limit and keyed on the token, not the account, since
 * there is no account here. A share link is a bearer credential: guessing one
 * means guessing 32 random bytes, and this makes even trying pointless.
 */
publicShareRouter.use(
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
  }),
);

publicShareRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const view = await resolveSharedView(req.params.token!);
    // One message for revoked, expired, unknown and deleted alike: telling an
    // anonymous caller which of those it was is free information about who
    // exists.
    if (!view) throw notFound('This link is not valid. Ask your coordinator for a new one.');
    res.json({ data: view });
  }),
);

// -- administering the links --------------------------------------------------
//
// Two routers rather than one mounted at /api: a blanket `requireAuth` on the
// whole API prefix would answer 401 for every unknown path, turning "no such
// route" into "you are not signed in".

/** Mounted under /api/students, so the paths read /students/:id/share-link. */
export const studentShareRouter = Router();
studentShareRouter.use(requireAuth);

/** Mounted at /api/share-links for the cohort-wide operations. */
export const shareAdminRouter = Router();
shareAdminRouter.use(requireAuth);

const issueBody = z.object({ expiresAt: z.coerce.date().nullish() });

studentShareRouter.get(
  '/:id/share-link',
  asyncHandler(async (req, res) => {
    const student = await prisma.student.findUnique({ where: { id: req.params.id! }, select: { id: true } });
    if (!student) throw notFound('Student not found');
    res.json({ data: await getShareLinkStatus(student.id) });
  }),
);

studentShareRouter.post(
  '/:id/share-link',
  requireTrainer,
  validateBody(issueBody),
  asyncHandler(async (req, res) => {
    const expiresAt = req.body.expiresAt ?? null;
    if (expiresAt && expiresAt <= new Date()) throw badRequest('The expiry date must be in the future');

    const link = await issueShareLink(req.params.id!, { createdById: req.user!.sub, expiresAt });
    // The only time this URL is ever returned. It is stored hashed.
    res.status(201).json({
      data: link,
      message: 'Copy this link now — it is stored hashed and cannot be shown again. Regenerate to issue a new one.',
    });
  }),
);

studentShareRouter.delete(
  '/:id/share-link',
  requireTrainer,
  asyncHandler(async (req, res) => {
    const revoked = await revokeShareLink(req.params.id!);
    if (!revoked) throw notFound('This student has no active link');
    res.status(204).send();
  }),
);

const bulkBody = z.object({
  scope: z.enum(['all', 'filtered', 'selected']).default('filtered'),
  studentIds: z.array(z.string()).max(5_000).optional(),
  college: z.string().optional(),
  batch: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
  expiresAt: z.coerce.date().nullish(),
  /** Guards against regenerating links that are already in circulation. */
  regenerateExisting: z.boolean().default(false),
});

shareAdminRouter.post(
  '/',
  requireTrainer,
  validateBody(bulkBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof bulkBody>;
    if (body.scope === 'selected' && !body.studentIds?.length) {
      throw badRequest('Select at least one student');
    }
    if (body.expiresAt && body.expiresAt <= new Date()) throw badRequest('The expiry date must be in the future');

    const filters: StudentFilters =
      body.scope === 'selected'
        ? { ids: body.studentIds }
        : body.scope === 'all'
          ? {}
          : {
              ...(body.college ? { college: body.college } : {}),
              ...(body.batch ? { batch: body.batch } : {}),
              ...(body.branch ? { branch: body.branch } : {}),
              ...(body.section ? { section: body.section } : {}),
            };

    const students = await prisma.student.findMany({
      where: buildStudentWhere(filters),
      select: { id: true, shareLink: { select: { revokedAt: true } } },
      take: 5_000,
    });

    // A student whose link is already out there keeps it unless asked twice:
    // silently regenerating would break links already sitting in inboxes.
    const targets = body.regenerateExisting
      ? students
      : students.filter((s) => !s.shareLink || s.shareLink.revokedAt);

    const links = await issueShareLinksFor(
      targets.map((s) => s.id),
      { createdById: req.user!.sub, expiresAt: body.expiresAt ?? null },
    );

    res.status(201).json({
      data: links,
      issued: links.length,
      skipped: students.length - targets.length,
      message:
        'These links are shown once and stored hashed. Export them now — skipped students already have a live link.',
    });
  }),
);

const exportQuery = z.object({
  college: z.string().optional(),
  batch: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
});

/**
 * Who has a link and whether it is being used — not the links themselves, which
 * cannot be recovered.
 */
shareAdminRouter.get(
  '/',
  validateQuery(exportQuery),
  asyncHandler(async (req, res) => {
    const filters = parsedQuery<StudentFilters>(req);
    const students = await prisma.student.findMany({
      where: buildStudentWhere(filters),
      select: {
        id: true,
        studentId: true,
        name: true,
        college: true,
        batch: true,
        branch: true,
        shareLink: {
          select: { createdAt: true, expiresAt: true, revokedAt: true, lastViewedAt: true, viewCount: true },
        },
      },
      orderBy: { name: 'asc' },
      take: 5_000,
    });

    const now = new Date();
    res.json({
      data: students.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        name: s.name,
        college: s.college,
        batch: s.batch,
        branch: s.branch,
        hasLink: Boolean(s.shareLink),
        active: Boolean(
          s.shareLink && !s.shareLink.revokedAt && (!s.shareLink.expiresAt || s.shareLink.expiresAt > now),
        ),
        createdAt: s.shareLink?.createdAt ?? null,
        expiresAt: s.shareLink?.expiresAt ?? null,
        revokedAt: s.shareLink?.revokedAt ?? null,
        lastViewedAt: s.shareLink?.lastViewedAt ?? null,
        viewCount: s.shareLink?.viewCount ?? 0,
      })),
      baseUrl: shareBaseUrl(),
      configuredBaseUrl: Boolean(env.APP_BASE_URL),
    });
  }),
);
