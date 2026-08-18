import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSupportedExtension, detectHeaderRow, readSpreadsheet } from '../src/modules/upload/excel.js';
import { applyMapping, suggestMapping, validateMapping } from '../src/modules/upload/mapping.js';
import { validateRows } from '../src/modules/upload/validation.js';

let tmpDir: string;

async function writeWorkbook(name: string, rows: (string | number)[][], sheetName = 'Sheet1'): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  rows.forEach((row) => sheet.addRow(row));
  const target = path.join(tmpDir, name);
  await workbook.xlsx.writeFile(target);
  return target;
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tcp-excel-'));
});
afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('file type validation', () => {
  it('accepts modern spreadsheet formats', () => {
    expect(assertSupportedExtension('students.xlsx')).toBe('.xlsx');
    expect(assertSupportedExtension('students.CSV')).toBe('.csv');
  });

  it('explains what to do about legacy .xls instead of failing opaquely', () => {
    expect(() => assertSupportedExtension('students.xls')).toThrowError(/re-save it as \.xlsx/i);
  });

  it('rejects anything else', () => {
    expect(() => assertSupportedExtension('students.pdf')).toThrowError(/Unsupported file type/);
    expect(() => assertSupportedExtension('students')).toThrowError(/Unsupported file type/);
  });
});

describe('header detection', () => {
  it('skips a title row above the headers', () => {
    const rows = [
      ['Placement Cell Intake', '', '', ''],
      ['Student ID', 'Name', 'LeetCode', 'Codeforces'],
      ['1001', 'Rahul', 'rahul', 'rahul_cf'],
    ];
    expect(detectHeaderRow(rows)).toBe(1);
  });

  it('uses the first row when it is already the header', () => {
    expect(detectHeaderRow([['Student ID', 'Name'], ['1001', 'Rahul']])).toBe(0);
  });

  it('detects the header row when reading a real workbook', async () => {
    const file = await writeWorkbook('titled.xlsx', [
      ['Coding Profiles — 2026 intake'],
      ['Student ID', 'Student Name', 'LeetCode', 'Codeforces'],
      [1001, 'Rahul Sharma', 'rahul', 'rahul_cf'],
      [1002, 'Priya Singh', 'priya', 'priya_cf'],
    ]);
    const sheet = await readSpreadsheet(file);
    expect(sheet.headerRowNumber).toBe(2);
    expect(sheet.headers).toEqual(['Student ID', 'Student Name', 'LeetCode', 'Codeforces']);
    expect(sheet.totalRows).toBe(2);
  });

  it('gives blank and duplicate headers usable unique names', async () => {
    const file = await writeWorkbook('dupes.xlsx', [
      ['Student ID', 'Name', 'Name', ''],
      [1001, 'Rahul', 'Sharma', 'x'],
    ]);
    const sheet = await readSpreadsheet(file);
    expect(sheet.headers).toEqual(['Student ID', 'Name', 'Name (2)', 'Column 4']);
  });

  it('rejects an empty sheet with a clear message', async () => {
    const file = await writeWorkbook('empty.xlsx', []);
    await expect(readSpreadsheet(file)).rejects.toThrowError(/empty/i);
  });
});

describe('column mapping', () => {
  it('auto-maps common Indian-institution header spellings', () => {
    const mapping = suggestMapping(['Roll No', 'Student Name', 'Email ID', 'Dept', 'Passing Year', 'Sec', 'LeetCode', 'Code Chef', 'HackerRank', 'Codeforces']);
    expect(mapping['Roll No']).toBe('student_id');
    expect(mapping['Student Name']).toBe('name');
    expect(mapping['Email ID']).toBe('email');
    expect(mapping.Dept).toBe('branch');
    expect(mapping['Passing Year']).toBe('batch');
    expect(mapping.Sec).toBe('section');
    expect(mapping.LeetCode).toBe('leetcode_username');
    expect(mapping['Code Chef']).toBe('codechef_username');
  });

  it('never maps two columns onto the same field', () => {
    const mapping = suggestMapping(['Name', 'Student Name', 'Full Name']);
    const targets = Object.values(mapping).filter(Boolean);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('leaves unrecognized columns unmapped rather than guessing', () => {
    const mapping = suggestMapping(['Student ID', 'Name', 'Hostel Block', 'Fee Status']);
    expect(mapping['Hostel Block']).toBeNull();
    expect(mapping['Fee Status']).toBeNull();
  });

  it('reports missing required fields and duplicate targets', () => {
    expect(validateMapping({ Name: 'name' }).missingRequired).toEqual(['student_id']);
    const dup = validateMapping({ A: 'name', B: 'name', C: 'student_id' });
    expect(dup.valid).toBe(false);
    expect(dup.duplicateTargets).toEqual(['name']);
  });

  it('warns when nothing will be fetched', () => {
    const result = validateMapping({ A: 'student_id', B: 'name' });
    expect(result.valid).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/No platform column is mapped/);
  });

  it('applies a mapping to a row and drops empty cells', () => {
    const record = applyMapping(['ID', 'Name', 'LC'], ['1001', 'Rahul', '  '], { ID: 'student_id', Name: 'name', LC: 'leetcode_username' });
    expect(record).toEqual({ student_id: '1001', name: 'Rahul' });
  });
});

describe('row validation', () => {
  const headers = ['ID', 'Name', 'Email', 'LeetCode', 'CodeChef', 'Codeforces'];
  const mapping = {
    ID: 'student_id', Name: 'name', Email: 'email',
    LeetCode: 'leetcode_username', CodeChef: 'codechef_username', Codeforces: 'codeforces_username',
  } as const;

  it('accepts a clean row', () => {
    const report = validateRows(headers, [['1001', 'Rahul Sharma', 'r@x.edu', 'rahul', 'rahul_cc', 'rahul_cf']], mapping as never);
    expect(report.validRows).toBe(1);
    expect(report.rows[0]!.errors).toEqual([]);
    expect(report.rows[0]!.usernames).toEqual({ LEETCODE: 'rahul', CODECHEF: 'rahul_cc', CODEFORCES: 'rahul_cf' });
  });

  it('requires a student ID and a name', () => {
    const report = validateRows(headers, [['', '', '', 'x', '', '']], mapping as never);
    expect(report.invalidRows).toBe(1);
    expect(report.rows[0]!.errors.map((e) => e.field).sort()).toEqual(['name', 'student_id']);
  });

  it('extracts handles from full profile URLs', () => {
    const report = validateRows(headers, [['1001', 'Rahul', '', 'https://leetcode.com/u/rahul123/', '', 'https://codeforces.com/profile/rahul_cf']], mapping as never);
    expect(report.rows[0]!.usernames.LEETCODE).toBe('rahul123');
    expect(report.rows[0]!.usernames.CODEFORCES).toBe('rahul_cf');
  });

  it('treats placeholder cells as "no account", not as a handle', () => {
    for (const placeholder of ['-', 'N/A', 'na', 'none', 'nil', 'NULL']) {
      const report = validateRows(headers, [['1001', 'Rahul', '', placeholder, '', '']], mapping as never);
      expect(report.rows[0]!.usernames.LEETCODE, placeholder).toBeUndefined();
    }
  });

  it('flags a duplicate student ID as an error so the row is skipped', () => {
    const report = validateRows(headers, [
      ['1001', 'Rahul', '', 'rahul', '', ''],
      ['1001', 'Rahul Again', '', 'rahul2', '', ''],
    ], mapping as never);
    expect(report.duplicateStudentIds).toEqual(['1001']);
    expect(report.rows[1]!.valid).toBe(false);
    expect(report.validRows).toBe(1);
  });

  it('flags a shared handle as a warning on both rows without blocking import', () => {
    const report = validateRows(headers, [
      ['1001', 'Rahul', '', 'shared_handle', '', ''],
      ['1002', 'Priya', '', 'shared_handle', '', ''],
    ], mapping as never);
    expect(report.duplicateUsernames).toEqual([{ platform: 'LEETCODE', username: 'shared_handle', rows: [1, 2] }]);
    expect(report.validRows).toBe(2);
    expect(report.rows[0]!.warnings.some((w) => w.code === 'DUPLICATE_USERNAME')).toBe(true);
  });

  it('warns about a row with no usable platform handle', () => {
    const report = validateRows(headers, [['1001', 'Rahul', '', '', '', '']], mapping as never);
    expect(report.summary.rowsWithNoPlatform).toBe(1);
    expect(report.rows[0]!.valid).toBe(true);
  });

  it('warns about a malformed email without rejecting the student', () => {
    const report = validateRows(headers, [['1001', 'Rahul', 'not-an-email', 'rahul', '', '']], mapping as never);
    expect(report.rows[0]!.valid).toBe(true);
    expect(report.rows[0]!.warnings.some((w) => w.code === 'INVALID_EMAIL')).toBe(true);
  });

  it('skips a handle that cannot be valid on its platform', () => {
    // Codeforces requires 3+ characters.
    const report = validateRows(headers, [['1001', 'Rahul', '', '', '', 'ab']], mapping as never);
    expect(report.rows[0]!.usernames.CODEFORCES).toBeUndefined();
    expect(report.rows[0]!.warnings.some((w) => w.code === 'INVALID_USERNAME')).toBe(true);
  });

  it('marks students that already exist as updates', () => {
    const report = validateRows(headers, [['1001', 'Rahul', '', 'rahul', '', '']], mapping as never, {
      existingStudentIds: new Set(['1001']),
    });
    expect(report.rows[0]!.warnings.some((w) => w.code === 'EXISTING_STUDENT')).toBe(true);
    expect(report.rows[0]!.valid).toBe(true);
  });

  it('counts platform coverage across the file', () => {
    const report = validateRows(headers, [
      ['1001', 'A', '', 'a_lc', 'a_cc', 'a_cf'],
      ['1002', 'B', '', 'b_lc', '', ''],
    ], mapping as never);
    expect(report.summary.platformCounts.LEETCODE).toBe(2);
    expect(report.summary.platformCounts.CODECHEF).toBe(1);
    expect(report.summary.platformCounts.HACKERRANK).toBe(0);
  });
});
