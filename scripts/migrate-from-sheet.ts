import { google } from 'googleapis';
import * as path from 'path';
import { ulid } from 'ulid';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const SHEET_ID = '1F-Jklguj9URpCFhsYbqhFPCL5epI4NPy0wA53zWZU1w';
const SHEET_TAB = 'ALL';
const KEY_PATH = path.join(__dirname, 'secrets', 'google-sheets-key.json');
const CATALOG_TABLE = process.env.CATALOG_TABLE_NAME;
const COUNTER_ID = 'COUNTER#catalog';
const BATCH_SIZE = 25;

if (!CATALOG_TABLE) {
  console.error('Missing CATALOG_TABLE_NAME env var');
  process.exit(1);
}

interface CatalogItem {
  id: string;
  number: number;
  title: string;
  category: string;
  language: string[];
  pubyear: number | null;
  firstname: string;
  lastname: string;
  editedTranslated: string[] | null;
}

function parseEditedTranslated(raw: string | undefined): string[] | null {
  if (!raw || !raw.trim()) return null;
  const parts = raw
    .split(/[,/]/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : null;
}

async function fetchRows(): Promise<string[][]> {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A2:Z`, // skip header row
  });
  return result.data.values ?? [];
}

function mapRow(row: string[]): CatalogItem | null {
  const [
    acquisitionNum,
    title,
    category,
    language,
    _categoryIndex,
    _titleCount,
    _categoryCount,
    _legacyId,
    pubyear,
    firstname,
    lastname,
    editedTranslated,
  ] = row;

  if (!title?.trim() || !category?.trim()) {
    return null; // skip blank/malformed rows
  }

  const number = parseInt(acquisitionNum, 10);

  return {
    id: ulid(),
    number: Number.isNaN(number) ? 0 : number,
    title: title.trim(),
    category: category.trim(),
    language: language?.trim() ? [language.trim()] : [],
    pubyear: pubyear?.trim() ? parseInt(pubyear, 10) || null : null,
    firstname: firstname?.trim() ?? '',
    lastname: lastname?.trim() ?? '',
    editedTranslated: parseEditedTranslated(editedTranslated),
  };
}

async function writeBatch(
  ddb: DynamoDBDocumentClient,
  items: CatalogItem[]
): Promise<void> {
  let unprocessed = items.map((item) => ({
    PutRequest: { Item: item },
  }));

  let attempt = 0;
  while (unprocessed.length > 0) {
    const result = await ddb.send(
      new BatchWriteCommand({
        RequestItems: { [CATALOG_TABLE!]: unprocessed },
      })
    );
    unprocessed = (result.UnprocessedItems?.[CATALOG_TABLE!] ?? []) as typeof unprocessed;

    if (unprocessed.length > 0) {
      attempt += 1;
      const delayMs = Math.min(2000, 100 * 2 ** attempt);
      console.warn(`  ${unprocessed.length} unprocessed items, retrying in ${delayMs}ms (attempt ${attempt})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  console.log('Fetching rows from Google Sheet...');
  const rawRows = await fetchRows();
  console.log(`Fetched ${rawRows.length} data rows.`);

  const items = rawRows.map(mapRow).filter((i): i is CatalogItem => i !== null);
  const skipped = rawRows.length - items.length;
  console.log(`Mapped ${items.length} catalog items (${skipped} rows skipped as blank/malformed).`);

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  console.log(`Writing ${items.length} items in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await writeBatch(ddb, batch);
    console.log(`  wrote ${Math.min(i + BATCH_SIZE, items.length)}/${items.length}`);
  }

  console.log(`Seeding number counter to ${items.length}...`);
  await ddb.send(
    new PutCommand({
      TableName: CATALOG_TABLE,
      Item: { id: COUNTER_ID, number: items.length },
    })
  );

  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
