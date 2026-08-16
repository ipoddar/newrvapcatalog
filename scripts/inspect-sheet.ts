import { google } from 'googleapis';
import * as path from 'path';

const SHEET_ID = '1F-Jklguj9URpCFhsYbqhFPCL5epI4NPy0wA53zWZU1w';
const KEY_PATH = path.join(__dirname, 'secrets', 'google-sheets-key.json');

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheetTitles = meta.data.sheets?.map((s) => s.properties?.title) ?? [];
  console.log('Sheet tabs:', sheetTitles);

  const firstTab = sheetTitles[0];
  const allRows = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${firstTab}!A1:Z`,
  });
  const rows = allRows.data.values ?? [];
  console.log(`\nTotal rows in "${firstTab}" (including header): ${rows.length}`);

  const header = rows[0];
  console.log('Header:', JSON.stringify(header));

  // Show rows where columns 11-15 (0-indexed) have any non-empty value,
  // to understand what the trailing columns actually contain.
  const interesting = rows
    .slice(1)
    .filter((row) => row.slice(11, 16).some((v) => v && v.trim()));
  console.log(`\nRows with data in columns L-P (11-15): ${interesting.length}`);
  interesting.slice(0, 15).forEach((row) => console.log(JSON.stringify(row)));

  // Distinct non-empty values seen in each of columns 11-15 across all rows.
  for (let col = 11; col <= 15; col++) {
    const values = new Set(rows.slice(1).map((r) => r[col]).filter((v) => v && v.trim()));
    console.log(`\nColumn index ${col} distinct values (${values.size}):`, [...values].slice(0, 20));
  }
}

main().catch((err) => {
  console.error('Failed to read sheet:', err.message || err);
  process.exit(1);
});
