import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { ALL_PLATFORMS } from '../../config/platforms.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, requireTrainer } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { spreadsheetUpload } from '../../middleware/upload.js';
import { badRequest } from '../../lib/errors.js';
import { FIELD_DEFINITIONS, STUDENT_FIELDS } from './mapping.js';
import * as uploads from './upload.service.js';

const fieldEnum = z.enum(STUDENT_FIELDS as unknown as [string, ...string[]]);
const mappingSchema = z.record(z.string(), fieldEnum.nullable());
const platformEnum = z.enum(ALL_PLATFORMS as [string, ...string[]]);

export const uploadRouter = Router();
uploadRouter.use(requireAuth, requireTrainer);

/** Field catalogue for the column-mapping UI. */
uploadRouter.get('/fields', (_req, res) => {
  res.json({ data: FIELD_DEFINITIONS });
});

uploadRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const batches = await prisma.uploadBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { uploadedBy: { select: { name: true, email: true } }, jobs: { select: { id: true, number: true, status: true } } },
    });
    res.json({ data: batches });
  }),
);

uploadRouter.post(
  '/',
  spreadsheetUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No file was uploaded. Attach a spreadsheet using the "file" field.');
    const sheetName = typeof req.body?.sheetName === 'string' ? req.body.sheetName : undefined;
    const headerRow = req.body?.headerRow ? Number(req.body.headerRow) : undefined;
    const preview = await uploads.createUpload(req.file, req.user!.sub, { sheetName, headerRow });
    res.status(201).json({ data: preview });
  }),
);

uploadRouter.post(
  '/:id/validate',
  validateBody(z.object({ mapping: mappingSchema, sheetName: z.string().optional(), headerRow: z.number().int().min(1).optional() })),
  asyncHandler(async (req, res) => {
    const preview = await uploads.revalidateUpload(req.params.id!, req.body.mapping as never, {
      sheetName: req.body.sheetName,
      headerRow: req.body.headerRow,
    });
    res.json({ data: preview });
  }),
);

uploadRouter.post(
  '/:id/commit',
  validateBody(
    z.object({
      mapping: mappingSchema,
      startProcessing: z.boolean().default(true),
      platforms: z.array(platformEnum).optional(),
      force: z.boolean().default(true),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await uploads.commitUpload(req.params.id!, {
      mapping: req.body.mapping as never,
      startProcessing: req.body.startProcessing,
      platforms: req.body.platforms as never,
      force: req.body.force,
      createdById: req.user!.sub,
    });
    res.status(201).json({ data: result });
  }),
);

uploadRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await uploads.deleteUpload(req.params.id!);
    res.status(204).end();
  }),
);
