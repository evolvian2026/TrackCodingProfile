/**
 * Generates `samples/students-sample.xlsx` — a realistic import file including
 * the messy cases the validator must handle (title row above the headers,
 * placeholder handles, a duplicate ID, a duplicate handle, a bad email).
 */
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADERS = [
  'Student ID', 'Student Name', 'Email', 'College', 'Batch', 'Branch', 'Section',
  'LeetCode', 'CodeChef', 'HackerRank', 'Codeforces',
];

const ROWS: (string | number)[][] = [
  [2001, 'Aarav Deshmukh', 'aarav.d@abc.edu', 'ABC Institute of Technology', '2023-26', 'CSE', 'A', 'aarav_pro', 'aarav_cc', 'aarav_hr', 'aarav_pro_cf'],
  [2002, 'Bhavna Rao', 'bhavna.rao@abc.edu', 'ABC Institute of Technology', '2023-26', 'CSE', 'A', 'bhavna_lc', 'bhavna_cc', '-', 'bhavna_cf'],
  [2003, 'Chetan Pillai', 'chetan.p@abc.edu', 'ABC Institute of Technology', '2023-26', 'IT', 'B', 'https://leetcode.com/u/chetan_elite/', 'N/A', 'chetan_hr', 'https://codeforces.com/profile/chetan_ace_cf'],
  [2004, 'Deepika Shah', 'deepika.shah@abc.edu', 'ABC Institute of Technology', '2024-27', 'CSE', 'B', 'deepika_beginner', '', '', 'deepika_newbie_cf'],
  [2005, 'Eshan Kulkarni', 'not-an-email', 'Northline Engineering College', '2024-27', 'ECE', 'A', 'eshan_lc', 'eshan_cc', '', ''],
  [2006, 'Farida Sheikh', 'farida.s@northline.edu', 'Northline Engineering College', '2024-27', 'CSE', 'A', 'farida_notfound', 'farida_cc', 'farida_hr', 'farida_cf'],
  [2007, 'Gautam Bansal', 'gautam.b@northline.edu', 'Northline Engineering College', '2023-26', 'CSE', 'C', 'gautam_private', '', 'gautam_hr', 'gautam_cf'],
  [2008, 'Hina Qureshi', 'hina.q@northline.edu', 'Northline Engineering College', '2023-26', 'IT', 'A', 'hina_lc', 'hina_ratelimited', '', 'hina_cf'],
  [2009, 'Irfan Khan', 'irfan.k@riverside.edu', 'Riverside Institute of Science', '2025-28', 'CSE', 'B', 'irfan_fresher', '', 'irfan_hr', ''],
  [2010, 'Jaya Menon', 'jaya.menon@riverside.edu', 'Riverside Institute of Science', '2025-28', 'CSE', 'B', 'jaya_lc', 'jaya_cc', 'jaya_hr', 'jaya_cf'],
  [2011, 'Kabir Malhotra', 'kabir.m@riverside.edu', 'Riverside Institute of Science', '2023-26', 'CSE', 'A', 'kabir_topper', 'kabir_star_cc', 'kabir_hr', 'kabir_elite_cf'],
  [2012, 'Lakshmi Iyer', 'lakshmi.i@riverside.edu', 'Riverside Institute of Science', '2023-26', 'ECE', 'B', 'lakshmi_lc', '', '', 'lakshmi_cf'],
  // Duplicate handle shared with row 1 -> warning, still importable.
  [2013, 'Manav Sinha', 'manav.s@abc.edu', 'ABC Institute of Technology', '2024-27', 'IT', 'A', 'aarav_pro', 'manav_cc', '', 'manav_cf'],
  // Duplicate student ID -> error, this row is skipped.
  [2013, 'Manav Sinha (duplicate)', 'manav.dup@abc.edu', 'ABC Institute of Technology', '2024-27', 'IT', 'A', 'manav_lc', '', '', ''],
  // No platform handles at all -> warning, imported with nothing to fetch.
  [2014, 'Nandini Reddy', 'nandini.r@abc.edu', 'ABC Institute of Technology', '2025-28', 'CSE', 'C', '', '', '', ''],
  [2015, 'Omar Farooq', 'omar.f@northline.edu', 'Northline Engineering College', '2024-27', 'CSE', 'B', 'omar_ace', 'omar_cc', 'omar_hr', 'omar_pro_cf'],
];

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');

  // A merged title row above the headers — the importer must detect row 2.
  sheet.addRow(['Placement Cell — Coding Profile Tracker Intake']);
  sheet.mergeCells('A1:K1');
  sheet.getRow(1).font = { bold: true, size: 14 };

  sheet.addRow(HEADERS);
  sheet.getRow(2).font = { bold: true };
  ROWS.forEach((row) => sheet.addRow(row));
  sheet.columns.forEach((c) => (c.width = 22));

  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples');
  const target = path.join(dir, 'students-sample.xlsx');
  await workbook.xlsx.writeFile(target);
  console.log(`Wrote ${target} (${ROWS.length} data rows)`);
}

main();
