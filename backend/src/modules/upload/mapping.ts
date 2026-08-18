import { ALL_PLATFORMS, PLATFORMS } from '../../config/platforms.js';

export const STUDENT_FIELDS = [
  'student_id',
  'name',
  'email',
  'phone',
  'university',
  'college',
  'batch',
  'branch',
  'section',
  'leetcode_username',
  'codechef_username',
  'hackerrank_username',
  'codeforces_username',
] as const;

export type StudentField = (typeof STUDENT_FIELDS)[number];

export const REQUIRED_FIELDS: StudentField[] = ['student_id', 'name'];

export const PLATFORM_FIELDS: StudentField[] = ALL_PLATFORMS.map(
  (p) => PLATFORMS[p].usernameField as StudentField,
);

export interface FieldDefinition {
  field: StudentField;
  label: string;
  required: boolean;
  description: string;
  aliases: string[];
}

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    field: 'student_id',
    label: 'Student ID',
    required: true,
    description: 'Unique institution-issued identifier. Used to match students on re-upload.',
    aliases: ['student id', 'studentid', 'id', 'roll', 'roll no', 'roll number', 'rollno', 'reg no', 'registration number', 'enrollment', 'enrollment no', 'univ roll no'],
  },
  {
    field: 'name',
    label: 'Student Name',
    required: true,
    description: 'Full name of the student.',
    aliases: ['name', 'student name', 'full name', 'student', 'candidate name'],
  },
  { field: 'email', label: 'Email', required: false, description: 'Contact email address.', aliases: ['email', 'email id', 'e-mail', 'mail', 'email address', 'college email'] },
  { field: 'phone', label: 'Phone', required: false, description: 'Contact number.', aliases: ['phone', 'mobile', 'contact', 'phone number', 'mobile no', 'contact number'] },
  { field: 'university', label: 'University', required: false, description: 'Parent university, when different from the college.', aliases: ['university', 'univ'] },
  { field: 'college', label: 'College', required: false, description: 'College or institute name.', aliases: ['college', 'institute', 'institution', 'college name', 'campus', 'school'] },
  { field: 'batch', label: 'Batch', required: false, description: 'Graduating batch, e.g. 2023-26.', aliases: ['batch', 'year', 'passing year', 'graduation year', 'batch year', 'session'] },
  { field: 'branch', label: 'Branch', required: false, description: 'Branch or department, e.g. CSE.', aliases: ['branch', 'department', 'dept', 'stream', 'discipline', 'course'] },
  { field: 'section', label: 'Section', required: false, description: 'Class section.', aliases: ['section', 'sec', 'class', 'division', 'group'] },
  { field: 'leetcode_username', label: 'LeetCode', required: false, description: 'LeetCode username or profile URL.', aliases: ['leetcode', 'leet code', 'leetcode username', 'leetcode id', 'leetcode profile', 'leetcode url', 'lc'] },
  { field: 'codechef_username', label: 'CodeChef', required: false, description: 'CodeChef username or profile URL.', aliases: ['codechef', 'code chef', 'codechef username', 'codechef id', 'codechef profile', 'codechef url', 'cc'] },
  { field: 'hackerrank_username', label: 'HackerRank', required: false, description: 'HackerRank username or profile URL.', aliases: ['hackerrank', 'hacker rank', 'hackerrank username', 'hackerrank id', 'hackerrank profile', 'hackerrank url', 'hr'] },
  { field: 'codeforces_username', label: 'Codeforces', required: false, description: 'Codeforces handle or profile URL.', aliases: ['codeforces', 'code forces', 'codeforces handle', 'codeforces username', 'codeforces id', 'codeforces profile', 'codeforces url', 'cf'] },
];

/** header (as written in the sheet) -> canonical field, or null to ignore it. */
export type ColumnMapping = Record<string, StudentField | null>;

const canonicalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Suggests a mapping from spreadsheet headers to canonical fields.
 * Exact alias match wins; otherwise a header that contains an alias is used.
 * The administrator can always override the result in the UI.
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<StudentField>();

  const tryAssign = (header: string, field: StudentField) => {
    if (taken.has(field)) return false;
    mapping[header] = field;
    taken.add(field);
    return true;
  };

  // Pass 1 — exact alias matches.
  for (const header of headers) {
    const key = canonicalize(header);
    if (!key) {
      mapping[header] = null;
      continue;
    }
    const def = FIELD_DEFINITIONS.find((d) => d.aliases.some((a) => canonicalize(a) === key));
    if (def) tryAssign(header, def.field);
  }

  // Pass 2 — substring matches for anything still unassigned.
  for (const header of headers) {
    if (mapping[header] !== undefined) continue;
    const key = canonicalize(header);
    const def = FIELD_DEFINITIONS.find((d) =>
      d.aliases.some((a) => {
        const alias = canonicalize(a);
        return alias.length >= 3 && (key.includes(alias) || alias.includes(key));
      }),
    );
    if (!def || !tryAssign(header, def.field)) mapping[header] = null;
  }

  return mapping;
}

export interface MappingValidation {
  valid: boolean;
  missingRequired: StudentField[];
  duplicateTargets: StudentField[];
  mappedPlatforms: StudentField[];
  warnings: string[];
}

export function validateMapping(mapping: ColumnMapping): MappingValidation {
  const targets = Object.values(mapping).filter((v): v is StudentField => v !== null);
  const counts = new Map<StudentField, number>();
  for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + 1);

  const duplicateTargets = [...counts.entries()].filter(([, n]) => n > 1).map(([f]) => f);
  const missingRequired = REQUIRED_FIELDS.filter((f) => !counts.has(f));
  const mappedPlatforms = PLATFORM_FIELDS.filter((f) => counts.has(f));

  const warnings: string[] = [];
  if (mappedPlatforms.length === 0) {
    warnings.push('No platform column is mapped — students will be imported but there will be nothing to fetch.');
  }
  if (!counts.has('batch')) warnings.push('No batch column mapped — batch-level analytics will be unavailable.');
  if (!counts.has('college')) warnings.push('No college column mapped — college comparison will be unavailable.');

  return {
    valid: missingRequired.length === 0 && duplicateTargets.length === 0,
    missingRequired,
    duplicateTargets,
    mappedPlatforms,
    warnings,
  };
}

/** Applies a mapping to one spreadsheet row. */
export function applyMapping(headers: string[], row: string[], mapping: ColumnMapping): Partial<Record<StudentField, string>> {
  const record: Partial<Record<StudentField, string>> = {};
  headers.forEach((header, index) => {
    const field = mapping[header];
    if (!field) return;
    const value = (row[index] ?? '').trim();
    if (value) record[field] = value;
  });
  return record;
}
