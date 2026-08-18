import { Router } from 'express';
import { z } from 'zod';
import { ALL_PLATFORMS } from '../../config/platforms.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth } from '../../middleware/auth.js';
import { parsedQuery, validateQuery } from '../../middleware/validate.js';
import type { StudentFilters } from '../students/students.service.js';
import * as reports from './report.service.js';

const formatSchema = z.enum(['xlsx', 'csv', 'pdf']);
const tabularFormat = z.enum(['xlsx', 'csv']);

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

function send(res: import('express').Response, report: reports.GeneratedReport) {
  res.setHeader('Content-Type', report.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
  res.setHeader('Content-Length', String(report.buffer.length));
  res.end(report.buffer);
}

reportsRouter.get(
  '/student/:id',
  validateQuery(z.object({ format: formatSchema.default('pdf') })),
  asyncHandler(async (req, res) => {
    const { format } = parsedQuery<{ format: reports.ReportFormat }>(req);
    send(res, await reports.generateStudentReport(req.params.id!, format));
  }),
);

reportsRouter.get(
  '/batch/:batch',
  validateQuery(z.object({ format: formatSchema.default('pdf') })),
  asyncHandler(async (req, res) => {
    const { format } = parsedQuery<{ format: reports.ReportFormat }>(req);
    send(res, await reports.generateBatchReport(decodeURIComponent(req.params.batch!), format));
  }),
);

reportsRouter.get(
  '/leaderboard',
  validateQuery(
    z.object({
      format: tabularFormat.default('xlsx'),
      limit: z.coerce.number().int().min(1).max(10_000).default(1000),
      university: z.string().optional(),
      college: z.string().optional(),
      batch: z.string().optional(),
      branch: z.string().optional(),
      section: z.string().optional(),
      platform: z.enum(ALL_PLATFORMS as [string, ...string[]]).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { format, limit, ...filters } = parsedQuery<{ format: 'xlsx' | 'csv'; limit: number } & StudentFilters>(req);
    send(res, await reports.generateLeaderboardExport(filters, format, limit));
  }),
);

reportsRouter.get(
  '/failures',
  validateQuery(z.object({ format: tabularFormat.default('xlsx'), jobId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { format, jobId } = parsedQuery<{ format: 'xlsx' | 'csv'; jobId?: string }>(req);
    send(res, await reports.generateFailureReport(format, jobId));
  }),
);
