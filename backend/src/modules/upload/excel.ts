import ExcelJS from 'exceljs';
import path from 'node:path';
import { badRequest } from '../../lib/errors.js';

export interface SheetData {
  sheetName: string;
  headers: string[];
  /** Row values aligned to `headers`, already trimmed to strings. */
  rows: string[][];
  totalRows: number;
  /** 1-based index of the row the headers were taken from. */
  headerRowNumber: number;
  availableSheets: string[];
}

export interface ReadOptions {
  sheetName?: string;
  headerRow?: number;
  maxRows?: number;
}

const SUPPORTED = new Set(['.xlsx', '.csv', '.xlsm']);

export function assertSupportedExtension(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.xls') {
    throw badRequest(
      'Legacy .xls workbooks are not supported. Open the file and re-save it as .xlsx (Excel Workbook) or .csv, then upload again.',
    );
  }
  if (!SUPPORTED.has(ext)) {
    throw badRequest(`Unsupported file type "${ext || 'unknown'}". Upload an .xlsx, .xlsm or .csv file.`);
  }
  return ext;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const rich = value as { richText?: { text: string }[]; text?: string; result?: unknown; hyperlink?: string };
    if (Array.isArray(rich.richText)) return rich.richText.map((r) => r.text).join('').trim();
    if (typeof rich.text === 'string') return rich.text.trim();
    if (rich.result !== undefined && rich.result !== null) return String(rich.result).trim();
    if (typeof rich.hyperlink === 'string') return rich.hyperlink.trim();
    return '';
  }
  return String(value).trim();
}

/**
 * Reads a workbook into a plain header + rows structure.
 *
 * The header row is auto-detected rather than assumed to be row 1, because
 * institution spreadsheets routinely start with a title or a blank row.
 */
export async function readSpreadsheet(filePath: string, options: ReadOptions = {}): Promise<SheetData> {
  const ext = path.extname(filePath).toLowerCase();
  const workbook = new ExcelJS.Workbook();

  try {
    if (ext === '.csv') {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }
  } catch (err) {
    throw badRequest(`The file could not be read as a spreadsheet: ${(err as Error).message}`);
  }

  const availableSheets = workbook.worksheets.map((w) => w.name);
  if (availableSheets.length === 0) throw badRequest('The workbook contains no sheets');

  const worksheet = options.sheetName
    ? workbook.getWorksheet(options.sheetName)
    : workbook.worksheets.find((w) => w.actualRowCount > 0) ?? workbook.worksheets[0];

  if (!worksheet) throw badRequest(`Sheet "${options.sheetName}" was not found in the workbook`);

  const raw: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cellToString(cell.value);
    });
    raw.push(Array.from(values, (v) => v ?? ''));
  });

  if (raw.length === 0) throw badRequest('The selected sheet is empty');

  const headerIndex = options.headerRow ? options.headerRow - 1 : detectHeaderRow(raw);
  const headerRow = raw[headerIndex];
  if (!headerRow) throw badRequest(`Header row ${headerIndex + 1} does not exist in this sheet`);

  const headers = dedupeHeaders(headerRow.map((h) => h.trim()));
  const bodyRows = raw
    .slice(headerIndex + 1)
    .map((row) => headers.map((_, i) => (row[i] ?? '').trim()))
    .filter((row) => row.some((cell) => cell !== ''));

  const limited = options.maxRows ? bodyRows.slice(0, options.maxRows) : bodyRows;

  return {
    sheetName: worksheet.name,
    headers,
    rows: limited,
    totalRows: bodyRows.length,
    headerRowNumber: headerIndex + 1,
    availableSheets,
  };
}

/**
 * Picks the row most likely to be the header: the first row in the top 10 whose
 * cells are all short, non-numeric labels and which has the most filled cells.
 */
export function detectHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i]!;
    const filled = row.filter((c) => c !== '');
    if (filled.length < 2) continue;
    const nonNumeric = filled.filter((c) => Number.isNaN(Number(c))).length;
    const shortLabels = filled.filter((c) => c.length <= 40).length;
    const score = filled.length + nonNumeric * 2 + shortLabels - i * 2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Excel allows duplicate and blank headers; the mapper needs unique keys. */
function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header || `Column ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}
