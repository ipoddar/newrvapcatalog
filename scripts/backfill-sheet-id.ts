import { google } from 'googleapis';
import * as path from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const SHEET_ID = '1F-Jklguj9URpCFhsYbqhFPCL5epI4NPy0wA53zWZU1w';
const SHEET_TAB = 'ALL';
const KEY_PATH = path.join(__dirname, 'secrets', 'google-sheets-key.json');
const CATALOG_TABLE = process.env.CATALOG_TABLE_NAME;
const COUNTER_ID = 'COUNTER#catalog';
const APPLY = process.argv.includes('--apply');

if (!CATALOG_TABLE) {
  console.error('Missing CATALOG_TABLE_NAME env var');
  process.exit(1);
}

interface SheetRow {
  acquisitionNum: number;
  title: string;
  sheetId: string;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function fetchSheetRows(): Promise<SheetRow[]> {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A2:H`, // AcquisitionNum (A) through ID (H)
  });
  const rows = result.data.values ?? [];

  return rows
    .map((row) => {
      const [acquisitionNumRaw, titleRaw, , , , , , idRaw] = row;
      const acquisitionNum = parseInt(acquisitionNumRaw, 10);
      const title = titleRaw?.trim();
      const sheetId = idRaw?.trim();
      if (Number.isNaN(acquisitionNum) || !title || !sheetId) return null;
      return { acquisitionNum, title, sheetId };
    })
    .filter((r): r is SheetRow => r !== null);
}

async function scanCatalog(ddb: DynamoDBDocumentClient) {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({ TableName: CATALOG_TABLE, ExclusiveStartKey })
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.filter((item) => item.id !== COUNTER_ID);
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will write sheetId to DynamoDB)' : 'DRY RUN (no writes)'}\n`);

  console.log('Fetching sheet rows...');
  const sheetRows = await fetchSheetRows();
  console.log(`Fetched ${sheetRows.length} sheet rows with a valid AcquisitionNum + ID.\n`);

  console.log('Scanning Catalog table...');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const catalogItems = await scanCatalog(ddb);
  console.log(`Scanned ${catalogItems.length} catalog items.\n`);

  // Detect ambiguous AcquisitionNum values in the sheet — these can't be
  // matched safely, since ddbByNumber below assumes uniqueness.
  const sheetByNumber = new Map<number, SheetRow[]>();
  for (const row of sheetRows) {
    const group = sheetByNumber.get(row.acquisitionNum) ?? [];
    group.push(row);
    sheetByNumber.set(row.acquisitionNum, group);
  }
  const ambiguousSheetNumbers = [...sheetByNumber.entries()].filter(([, rows]) => rows.length > 1);

  const ddbByNumber = new Map<number, Record<string, unknown>[]>();
  for (const item of catalogItems) {
    const number = Number(item.number ?? NaN);
    const group = ddbByNumber.get(number) ?? [];
    group.push(item);
    ddbByNumber.set(number, group);
  }
  const ambiguousDdbNumbers = [...ddbByNumber.entries()].filter(([, items]) => items.length > 1);

  const matched: { id: string; number: number; sheetId: string }[] = [];
  const noSheetMatch: Record<string, unknown>[] = [];
  const noDdbMatch: SheetRow[] = [];

  for (const [number, items] of ddbByNumber.entries()) {
    if (items.length > 1) continue; // ambiguous on the DynamoDB side, reported separately
    const sheetMatches = sheetByNumber.get(number);
    if (!sheetMatches || sheetMatches.length !== 1) {
      if (!sheetMatches) noSheetMatch.push(items[0]);
      continue; // no match or ambiguous on the sheet side
    }
    matched.push({ id: String(items[0].id), number, sheetId: sheetMatches[0].sheetId });
  }

  for (const [number, rows] of sheetByNumber.entries()) {
    if (rows.length > 1) continue;
    if (!ddbByNumber.has(number)) noDdbMatch.push(rows[0]);
  }

  // Second pass: for AcquisitionNum values that are ambiguous on BOTH sides
  // (same count of sheet rows and DynamoDB items sharing that number),
  // disambiguate by exact-matching normalized titles 1:1. Only accept the
  // resolution if every row on both sides pairs off uniquely — otherwise
  // leave the whole group unresolved rather than guess.
  const resolvedAmbiguous: { id: string; number: number; sheetId: string }[] = [];
  const stillAmbiguousNumbers = new Set(ambiguousSheetNumbers.map(([num]) => num));
  for (const [num, ddbItemsForNum] of ambiguousDdbNumbers) {
    const sheetRowsForNum = sheetByNumber.get(num);
    if (!sheetRowsForNum || sheetRowsForNum.length !== ddbItemsForNum.length) continue;

    const usedSheetIndices = new Set<number>();
    const pairs: { id: string; sheetId: string }[] = [];
    let allResolved = true;

    for (const ddbItem of ddbItemsForNum) {
      const ddbTitle = normalizeTitle(String(ddbItem.title ?? ''));
      const candidateIndices = sheetRowsForNum
        .map((row, i) => ({ row, i }))
        .filter(({ row, i }) => !usedSheetIndices.has(i) && normalizeTitle(row.title) === ddbTitle);

      if (candidateIndices.length !== 1) {
        allResolved = false;
        break;
      }
      usedSheetIndices.add(candidateIndices[0].i);
      pairs.push({ id: String(ddbItem.id), sheetId: candidateIndices[0].row.sheetId });
    }

    if (allResolved && pairs.length === ddbItemsForNum.length) {
      pairs.forEach((p) => resolvedAmbiguous.push({ ...p, number: num }));
      stillAmbiguousNumbers.delete(num);
    }
  }

  const unresolvedAmbiguous = ambiguousSheetNumbers.filter(([num]) => stillAmbiguousNumbers.has(num));

  console.log(`Clean matches (by number alone): ${matched.length}`);
  console.log(`Resolved via title match within ambiguous number groups: ${resolvedAmbiguous.length}`);
  resolvedAmbiguous.forEach((p) =>
    console.log(`  number ${p.number}: id=${p.id} -> sheetId="${p.sheetId}"`)
  );
  console.log(`Still ambiguous after title matching (skipped): ${unresolvedAmbiguous.length}`);
  unresolvedAmbiguous.forEach(([num, rows]) =>
    console.log(`  AcquisitionNum ${num}: ${rows.length} sheet rows — ${rows.map((r) => `${r.sheetId} ("${r.title}")`).join(', ')}`)
  );
  console.log(`DynamoDB items with no matching sheet row: ${noSheetMatch.length}`);
  noSheetMatch.slice(0, 20).forEach((item) =>
    console.log(`  id=${item.id} number=${item.number} title="${item.title}"`)
  );
  console.log(`Sheet rows with no matching DynamoDB item: ${noDdbMatch.length}`);
  noDdbMatch.slice(0, 20).forEach((row) =>
    console.log(`  AcquisitionNum=${row.acquisitionNum} sheetId=${row.sheetId}`)
  );

  const toApply = [...matched, ...resolvedAmbiguous];

  if (!APPLY) {
    console.log(`\nDry run complete. ${toApply.length} items total would be updated. Re-run with --apply to write sheetId to matched items.`);
    return;
  }

  console.log(`\nApplying sheetId to ${toApply.length} matched items...`);
  for (const { id, sheetId } of toApply) {
    await ddb.send(
      new UpdateCommand({
        TableName: CATALOG_TABLE,
        Key: { id },
        UpdateExpression: 'SET sheetId = :sheetId',
        ExpressionAttributeValues: { ':sheetId': sheetId },
      })
    );
  }
  console.log('Backfill complete.');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
