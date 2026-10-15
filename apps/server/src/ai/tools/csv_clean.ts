import { z } from 'zod';
import Papa from 'papaparse';
import type { ToolDefinition } from './types.js';

export const CsvCleanInputSchema = z.object({
  csvText: z.string().optional(),
  rows: z.array(z.record(z.unknown())).optional(),
  trimStrings: z.boolean().default(true),
  dedupe: z.boolean().default(true),
  dropEmpty: z.boolean().default(true),
  typeCast: z.boolean().default(true),
});

export type CsvCleanInput = z.infer<typeof CsvCleanInputSchema>;

export const csvCleanTool: ToolDefinition<CsvCleanInput> = {
  name: 'csv_clean',
  description: 'Cleans tabular CSV data by trimming strings, removing duplicate rows, dropping empty records, and type-casting numeric and boolean fields.',
  inputSchema: CsvCleanInputSchema,
  async execute(input) {
    let rawRows: Record<string, any>[] = [];

    if (input.rows && Array.isArray(input.rows)) {
      rawRows = input.rows;
    } else if (input.csvText) {
      const parsed = Papa.parse(input.csvText, { header: true, skipEmptyLines: true });
      rawRows = parsed.data as Record<string, any>[];
    }

    if (rawRows.length === 0) {
      return { cleanedRows: [], rowCount: 0, droppedDuplicates: 0, csv: '' };
    }

    const seenHashes = new Set<string>();
    const cleanedRows: Record<string, any>[] = [];
    let droppedDuplicates = 0;

    for (const row of rawRows) {
      const cleanedRow: Record<string, any> = {};
      let hasValue = false;

      for (const [key, val] of Object.entries(row)) {
        const cleanKey = key.trim();
        let cleanVal = val;

        if (typeof cleanVal === 'string') {
          if (input.trimStrings) {
            cleanVal = cleanVal.trim();
          }

          if (input.typeCast) {
            if (/^-?\d+$/.test(cleanVal)) {
              cleanVal = parseInt(cleanVal, 10);
            } else if (/^-?\d*\.\d+$/.test(cleanVal)) {
              cleanVal = parseFloat(cleanVal);
            } else if (cleanVal.toLowerCase() === 'true') {
              cleanVal = true;
            } else if (cleanVal.toLowerCase() === 'false') {
              cleanVal = false;
            } else if (cleanVal.toLowerCase() === 'null' || cleanVal === '') {
              cleanVal = null;
            }
          }
        }

        if (cleanVal !== null && cleanVal !== undefined && cleanVal !== '') {
          hasValue = true;
        }

        cleanedRow[cleanKey] = cleanVal;
      }

      if (input.dropEmpty && !hasValue) {
        continue;
      }

      if (input.dedupe) {
        const rowHash = JSON.stringify(cleanedRow);
        if (seenHashes.has(rowHash)) {
          droppedDuplicates++;
          continue;
        }
        seenHashes.add(rowHash);
      }

      cleanedRows.push(cleanedRow);
    }

    const outputCsv = Papa.unparse(cleanedRows);

    return {
      cleanedRows,
      rowCount: cleanedRows.length,
      droppedDuplicates,
      csv: outputCsv,
    };
  },
};
