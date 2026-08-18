import fs from 'node:fs/promises';
import path from 'node:path';
import type { Platform, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { ALL_PLATFORMS } from '../../config/platforms.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { createProcessingJob } from '../../services/processing.service.js';
import { ensureAnalyticsRows } from '../../services/analytics.service.js';
import { readSpreadsheet, type SheetData } from './excel.js';
import { suggestMapping, validateMapping, type ColumnMapping } from './mapping.js';
import { validateRows, type ValidationReport } from './validation.js';

const PREVIEW_ROWS = 20;

export interface UploadPreview {
  uploadId: string;
  originalName: string;
  sheetName: string;
  availableSheets: string[];
  headerRowNumber: number;
  headers: string[];
  totalRows: number;
  previewRows: Record<string, string>[];
  suggestedMapping: ColumnMapping;
  mappingValidation: ReturnType<typeof validateMapping>;
  validation: ValidationReport;
}

/** Stores the uploaded workbook and returns a preview plus a suggested mapping. */
export async function createUpload(
  file: { originalname: string; path: string; size: number },
  uploadedById: string | null,
  options: { sheetName?: string; headerRow?: number } = {},
): Promise<UploadPreview> {
  const sheet = await readSpreadsheet(file.path, options);

  if (sheet.totalRows === 0) throw badRequest('The sheet has headers but no data rows.');
  if (sheet.totalRows > env.MAX_UPLOAD_ROWS) {
    throw badRequest(`The file contains ${sheet.totalRows} rows, which exceeds the ${env.MAX_UPLOAD_ROWS}-row limit.`);
  }

  const mapping = suggestMapping(sheet.headers);

  const batch = await prisma.uploadBatch.create({
    data: {
      originalName: file.originalname,
      storedPath: file.path,
      sizeBytes: file.size,
      sheetName: sheet.sheetName,
      totalRows: sheet.totalRows,
      headers: sheet.headers as unknown as Prisma.InputJsonValue,
      mapping: mapping as unknown as Prisma.InputJsonValue,
      status: 'PREVIEW',
      uploadedById,
    },
  });

  return buildPreview(batch.id, file.originalname, sheet, mapping);
}

/** Re-runs validation for a stored upload using an administrator-edited mapping. */
export async function revalidateUpload(
  uploadId: string,
  mapping: ColumnMapping,
  options: { sheetName?: string; headerRow?: number } = {},
): Promise<UploadPreview> {
  const batch = await prisma.uploadBatch.findUnique({ where: { id: uploadId } });
  if (!batch?.storedPath) throw notFound('Upload not found or its file has already been cleaned up');

  const sheet = await readSpreadsheet(batch.storedPath, {
    sheetName: options.sheetName ?? batch.sheetName ?? undefined,
    headerRow: options.headerRow,
  });

  await prisma.uploadBatch.update({
    where: { id: uploadId },
    data: { mapping: mapping as unknown as Prisma.InputJsonValue, sheetName: sheet.sheetName },
  });

  return buildPreview(uploadId, batch.originalName, sheet, mapping);
}

async function buildPreview(
  uploadId: string,
  originalName: string,
  sheet: SheetData,
  mapping: ColumnMapping,
): Promise<UploadPreview> {
  const existingIds = new Set(
    (await prisma.student.findMany({ select: { studentId: true } })).map((s) => s.studentId),
  );

  const validation = validateRows(sheet.headers, sheet.rows, mapping, { existingStudentIds: existingIds });

  const previewRows = sheet.rows.slice(0, PREVIEW_ROWS).map((row) => {
    const record: Record<string, string> = {};
    sheet.headers.forEach((header, i) => {
      record[header] = row[i] ?? '';
    });
    return record;
  });

  await prisma.uploadBatch.update({
    where: { id: uploadId },
    data: {
      validRows: validation.validRows,
      invalidRows: validation.invalidRows,
      duplicateRows: validation.duplicateStudentIds.length,
      issues: validation.issues.slice(0, 500) as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    uploadId,
    originalName,
    sheetName: sheet.sheetName,
    availableSheets: sheet.availableSheets,
    headerRowNumber: sheet.headerRowNumber,
    headers: sheet.headers,
    totalRows: sheet.totalRows,
    previewRows,
    suggestedMapping: mapping,
    mappingValidation: validateMapping(mapping),
    // Only the preview slice of rows travels to the client; the counts and the
    // issue list already describe the whole file.
    validation: { ...validation, rows: validation.rows.slice(0, PREVIEW_ROWS) },
  };
}

export interface CommitOptions {
  mapping: ColumnMapping;
  startProcessing?: boolean;
  platforms?: Platform[];
  force?: boolean;
  createdById?: string | null;
}

export interface CommitResult {
  uploadId: string;
  created: number;
  updated: number;
  skipped: number;
  profilesLinked: number;
  job?: { jobId: string; number: number; totalStudents: number; totalItems: number };
  jobError?: string;
}

/**
 * Writes the validated rows into `students` + `platform_profiles`, then
 * optionally starts a processing job. Rows carrying errors are always skipped
 * and reported back rather than silently dropped.
 */
export async function commitUpload(uploadId: string, options: CommitOptions): Promise<CommitResult> {
  const batch = await prisma.uploadBatch.findUnique({ where: { id: uploadId } });
  if (!batch?.storedPath) throw notFound('Upload not found or its file has already been cleaned up');
  if (batch.status === 'COMMITTED') throw badRequest('This upload has already been imported.');

  const sheet = await readSpreadsheet(batch.storedPath, { sheetName: batch.sheetName ?? undefined });
  const mappingCheck = validateMapping(options.mapping);
  if (!mappingCheck.valid) throw badRequest('The column mapping is incomplete.', mappingCheck);

  const report = validateRows(sheet.headers, sheet.rows, options.mapping);
  const importable = report.rows.filter((r) => r.valid);

  if (importable.length === 0) {
    throw badRequest('Every row failed validation, so nothing was imported.', { issues: report.issues.slice(0, 100) });
  }

  let created = 0;
  let updated = 0;
  let profilesLinked = 0;
  const studentIds: string[] = [];

  // Chunked so a 10k-row import never holds one giant transaction open.
  for (const rows of chunk(importable, 100)) {
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const data = row.data;
        const studentFields = {
          name: data.name!.trim(),
          email: data.email ?? null,
          phone: data.phone ?? null,
          university: data.university ?? null,
          college: data.college ?? null,
          batch: data.batch ?? null,
          branch: data.branch ?? null,
          section: data.section ?? null,
        };

        const existing = await tx.student.findUnique({ where: { studentId: data.student_id! }, select: { id: true } });
        const student = existing
          ? await tx.student.update({ where: { id: existing.id }, data: studentFields, select: { id: true } })
          : await tx.student.create({ data: { studentId: data.student_id!, ...studentFields }, select: { id: true } });

        if (existing) updated += 1;
        else created += 1;
        studentIds.push(student.id);

        for (const platform of ALL_PLATFORMS) {
          const username = row.usernames[platform];
          if (!username) continue;
          await tx.platformProfile.upsert({
            where: { studentId_platform: { studentId: student.id, platform } },
            create: { studentId: student.id, platform, username, status: 'PENDING' },
            update: { username, status: 'PENDING', statusMessage: null },
          });
          profilesLinked += 1;
        }
      }
    });
  }

  // Every imported student gets an analytics row up front, including those with
  // no handles at all, so ordering and filtering behave consistently.
  await ensureAnalyticsRows(studentIds);

  await prisma.uploadBatch.update({
    where: { id: uploadId },
    data: { status: 'COMMITTED', createdCount: created, updatedCount: updated },
  });

  const result: CommitResult = {
    uploadId,
    created,
    updated,
    skipped: report.rows.length - importable.length,
    profilesLinked,
  };

  if (options.startProcessing !== false && studentIds.length > 0) {
    try {
      const job = await createProcessingJob({
        type: 'UPLOAD_IMPORT',
        studentIds,
        platforms: options.platforms,
        force: options.force ?? true,
        createdById: options.createdById ?? null,
        uploadBatchId: uploadId,
      });
      result.job = { jobId: job.jobId, number: job.number, totalStudents: job.totalStudents, totalItems: job.totalItems };
    } catch (err) {
      // The import itself succeeded — report why no job started instead of failing.
      result.jobError = (err as Error).message;
      logger.warn('Import committed but no processing job was started', result.jobError);
    }
  }

  return result;
}

export async function deleteUpload(uploadId: string): Promise<void> {
  const batch = await prisma.uploadBatch.findUnique({ where: { id: uploadId } });
  if (!batch) throw notFound('Upload not found');
  if (batch.storedPath) await fs.unlink(batch.storedPath).catch(() => undefined);
  await prisma.uploadBatch.delete({ where: { id: uploadId } });
}

/** Removes stored workbooks older than `days` — they are only needed for mapping. */
export async function cleanupOldUploads(days = 7): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const stale = await prisma.uploadBatch.findMany({
    where: { createdAt: { lt: cutoff }, storedPath: { not: null } },
    select: { id: true, storedPath: true },
  });
  for (const batch of stale) {
    if (batch.storedPath) await fs.unlink(batch.storedPath).catch(() => undefined);
    await prisma.uploadBatch.update({ where: { id: batch.id }, data: { storedPath: null } });
  }
  return stale.length;
}

export async function ensureUploadDir(): Promise<string> {
  const dir = path.resolve(env.UPLOAD_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
