import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { proxyRequest } from './composio.js';

const spreadsheetId = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
export const sheetExportBody = z
  .object({
    accountId: z.guid(),
    spreadsheetId: spreadsheetId.optional(),
    view: z.enum(['Prompts', 'Citations', 'Content Opportunities']),
    values: z
      .array(
        z
          .array(z.union([z.string().max(50000), z.number(), z.boolean()]))
          .min(1)
          .max(100),
      )
      .min(1),
  })
  .refine(({ values }) => values.every((row) => row.length === values[0].length));

const api = 'https://sheets.googleapis.com/v4/spreadsheets';

function cell(value) {
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: value } };
}

export async function exportSheet(accountId, { view, values, spreadsheetId: existing }) {
  const sheetId = randomInt(1, 2147483647);
  const properties = {
    sheetId,
    gridProperties: { rowCount: values.length, columnCount: values[0].length },
  };
  const rows = values.map((row) => ({ values: row.map(cell) }));
  // Both forms write the entire snapshot atomically. Google names the new tab
  // in an existing file, so repeated exports cannot overwrite someone's work.
  const body = existing
    ? {
        requests: [
          { addSheet: { properties } },
          {
            updateCells: {
              start: { sheetId, rowIndex: 0, columnIndex: 0 },
              rows,
              fields: 'userEnteredValue',
            },
          },
        ],
      }
    : {
        properties: { title: 'Ansvisor - ' + view },
        sheets: [{ properties: { ...properties, title: view }, data: [{ rowData: rows }] }],
      };
  const result = await proxyRequest(accountId, {
    method: 'POST',
    endpoint: existing ? api + '/' + existing + ':batchUpdate' : api,
    query: { fields: 'spreadsheetId' },
    body,
  });
  if (
    result.status < 200 ||
    result.status >= 300 ||
    !spreadsheetId.safeParse(result.data?.spreadsheetId).success
  ) {
    throw new Error('Google Sheets write failed.');
  }
  return (
    'https://docs.google.com/spreadsheets/d/' + result.data.spreadsheetId + '/edit#gid=' + sheetId
  );
}
