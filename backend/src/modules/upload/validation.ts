import type { Platform } from '@prisma/client';
import { ALL_PLATFORMS, PLATFORMS } from '../../config/platforms.js';
import { getAdapter } from '../../platforms/registry.js';
import { applyMapping, type ColumnMapping, type StudentField } from './mapping.js';

export type IssueSeverity = 'error' | 'warning';

export interface RowIssue {
  /** 1-based row number as it appears in the spreadsheet body. */
  row: number;
  field?: StudentField | 'row';
  severity: IssueSeverity;
  code: string;
  message: string;
}

export interface ValidatedRow {
  row: number;
  data: Partial<Record<StudentField, string>>;
  /** Platform handles that passed validation, keyed by platform. */
  usernames: Partial<Record<Platform, string>>;
  errors: RowIssue[];
  warnings: RowIssue[];
  valid: boolean;
}

export interface ValidationReport {
  rows: ValidatedRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateStudentIds: string[];
  duplicateUsernames: { platform: Platform; username: string; rows: number[] }[];
  issues: RowIssue[];
  summary: {
    errorCount: number;
    warningCount: number;
    platformCounts: Record<Platform, number>;
    rowsWithNoPlatform: number;
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validates every row of a mapped spreadsheet before anything is written.
 *
 * Errors block a row from being imported; warnings do not. Duplicates are
 * reported both within the file and (via `existingStudentIds`) against what is
 * already in the database.
 */
export function validateRows(
  headers: string[],
  rows: string[][],
  mapping: ColumnMapping,
  options: { existingStudentIds?: Set<string> } = {},
): ValidationReport {
  const validated: ValidatedRow[] = [];
  const seenStudentIds = new Map<string, number[]>();
  const seenUsernames = new Map<string, number[]>();
  const platformCounts = Object.fromEntries(ALL_PLATFORMS.map((p) => [p, 0])) as Record<Platform, number>;
  let rowsWithNoPlatform = 0;

  rows.forEach((raw, index) => {
    const rowNumber = index + 1;
    const data = applyMapping(headers, raw, mapping);
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];

    // -- required fields ----------------------------------------------------
    const studentId = data.student_id?.trim();
    if (!studentId) {
      errors.push({ row: rowNumber, field: 'student_id', severity: 'error', code: 'REQUIRED', message: 'Student ID is required' });
    } else if (studentId.length > 64) {
      errors.push({ row: rowNumber, field: 'student_id', severity: 'error', code: 'TOO_LONG', message: 'Student ID must be 64 characters or fewer' });
    }

    const name = data.name?.trim();
    if (!name) {
      errors.push({ row: rowNumber, field: 'name', severity: 'error', code: 'REQUIRED', message: 'Student name is required' });
    } else if (name.length > 200) {
      errors.push({ row: rowNumber, field: 'name', severity: 'error', code: 'TOO_LONG', message: 'Name must be 200 characters or fewer' });
    }

    // -- optional field sanity ---------------------------------------------
    if (data.email && !EMAIL_RE.test(data.email)) {
      warnings.push({ row: rowNumber, field: 'email', severity: 'warning', code: 'INVALID_EMAIL', message: `"${data.email}" does not look like a valid email address` });
    }

    // -- platform handles ---------------------------------------------------
    const usernames: Partial<Record<Platform, string>> = {};
    for (const platform of ALL_PLATFORMS) {
      const field = PLATFORMS[platform].usernameField as StudentField;
      const rawValue = data[field]?.trim();
      if (!rawValue || isBlankMarker(rawValue)) continue;

      const adapter = getAdapter(platform);
      const normalized = adapter.normalizeUsername(rawValue);
      const check = adapter.validateUsername(normalized);
      if (!check.valid) {
        warnings.push({
          row: rowNumber,
          field,
          severity: 'warning',
          code: 'INVALID_USERNAME',
          message: `${PLATFORMS[platform].label}: ${check.reason}. This handle will be skipped.`,
        });
        continue;
      }
      usernames[platform] = normalized;
      platformCounts[platform] += 1;

      const key = `${platform}:${normalized.toLowerCase()}`;
      seenUsernames.set(key, [...(seenUsernames.get(key) ?? []), rowNumber]);
    }

    if (Object.keys(usernames).length === 0) {
      rowsWithNoPlatform += 1;
      warnings.push({
        row: rowNumber,
        field: 'row',
        severity: 'warning',
        code: 'NO_PLATFORM',
        message: 'No usable platform handle on this row — the student will be imported with nothing to fetch',
      });
    }

    // -- duplicates within the file ----------------------------------------
    if (studentId) {
      const previous = seenStudentIds.get(studentId) ?? [];
      if (previous.length > 0) {
        errors.push({
          row: rowNumber,
          field: 'student_id',
          severity: 'error',
          code: 'DUPLICATE_IN_FILE',
          message: `Student ID "${studentId}" also appears on row ${previous.join(', ')}`,
        });
      }
      seenStudentIds.set(studentId, [...previous, rowNumber]);

      if (options.existingStudentIds?.has(studentId)) {
        warnings.push({
          row: rowNumber,
          field: 'student_id',
          severity: 'warning',
          code: 'EXISTING_STUDENT',
          message: `Student ID "${studentId}" already exists and will be updated`,
        });
      }
    }

    validated.push({ row: rowNumber, data, usernames, errors, warnings, valid: errors.length === 0 });
  });

  // -- duplicate handles shared by different students -----------------------
  const duplicateUsernames: ValidationReport['duplicateUsernames'] = [];
  for (const [key, rowNumbers] of seenUsernames) {
    if (rowNumbers.length < 2) continue;
    const [platform, username] = splitKey(key);
    duplicateUsernames.push({ platform, username, rows: rowNumbers });
    for (const rowNumber of rowNumbers) {
      const target = validated[rowNumber - 1];
      target?.warnings.push({
        row: rowNumber,
        field: (PLATFORMS[platform].usernameField as StudentField),
        severity: 'warning',
        code: 'DUPLICATE_USERNAME',
        message: `${PLATFORMS[platform].label} handle "${username}" is shared with row ${rowNumbers.filter((r) => r !== rowNumber).join(', ')}`,
      });
    }
  }

  const issues = validated.flatMap((r) => [...r.errors, ...r.warnings]);

  return {
    rows: validated,
    totalRows: validated.length,
    validRows: validated.filter((r) => r.valid).length,
    invalidRows: validated.filter((r) => !r.valid).length,
    duplicateStudentIds: [...seenStudentIds.entries()].filter(([, rowsFor]) => rowsFor.length > 1).map(([id]) => id),
    duplicateUsernames,
    issues,
    summary: {
      errorCount: issues.filter((i) => i.severity === 'error').length,
      warningCount: issues.filter((i) => i.severity === 'warning').length,
      platformCounts,
      rowsWithNoPlatform,
    },
  };
}

/** Spreadsheets use all sorts of placeholders for "no account". */
function isBlankMarker(value: string): boolean {
  return ['-', '--', 'n/a', 'na', 'nil', 'none', 'null', 'not available', 'nan', 'x'].includes(value.toLowerCase());
}

function splitKey(key: string): [Platform, string] {
  const separator = key.indexOf(':');
  return [key.slice(0, separator) as Platform, key.slice(separator + 1)];
}
