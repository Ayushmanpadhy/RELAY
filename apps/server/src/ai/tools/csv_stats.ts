import { z } from 'zod';
import Papa from 'papaparse';
import type { ToolDefinition } from './types.js';

export const CsvStatsInputSchema = z.object({
  csvText: z.string().optional(),
  rows: z.array(z.record(z.unknown())).optional(),
  columns: z.array(z.string()).optional(),
});

export type CsvStatsInput = z.infer<typeof CsvStatsInputSchema>;

export interface ColumnSummary {
  type: 'numeric' | 'string' | 'boolean' | 'mixed';
  count: number;
  missing: number;
  uniqueValues: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  sum?: number;
  sampleValues?: unknown[];
}

export const csvStatsTool: ToolDefinition<CsvStatsInput> = {
  name: 'csv_stats',
  description: 'Calculates summary statistics (mean, median, min, max, missing count, uniqueness) for tabular data columns.',
  inputSchema: CsvStatsInputSchema,
  async execute(input) {
    let rawRows: Record<string, any>[] = [];

    if (input.rows && Array.isArray(input.rows)) {
      rawRows = input.rows;
    } else if (input.csvText) {
      const parsed = Papa.parse(input.csvText, { header: true, dynamicTyping: true, skipEmptyLines: true });
      rawRows = parsed.data as Record<string, any>[];
    }

    if (rawRows.length === 0) {
      return { rowCount: 0, columnCount: 0, columnStats: {} };
    }

    const allKeys = Object.keys(rawRows[0] || {});
    const targetKeys = input.columns && input.columns.length > 0 ? input.columns.filter((c) => allKeys.includes(c)) : allKeys;

    const columnStats: Record<string, ColumnSummary> = {};

    for (const key of targetKeys) {
      const values = rawRows.map((r) => r[key]);
      const validValues = values.filter((v) => v !== null && v !== undefined && v !== '');
      const missingCount = values.length - validValues.length;
      const uniqueCount = new Set(validValues).size;

      const numericValues = validValues.filter((v) => typeof v === 'number' && !isNaN(v)) as number[];
      const isNumeric = numericValues.length > 0 && numericValues.length === validValues.length;

      if (isNumeric && numericValues.length > 0) {
        numericValues.sort((a, b) => a - b);
        const min = numericValues[0];
        const max = numericValues[numericValues.length - 1];
        const sum = numericValues.reduce((acc, v) => acc + v, 0);
        const mean = Number((sum / numericValues.length).toFixed(4));
        const mid = Math.floor(numericValues.length / 2);
        const median = numericValues.length % 2 !== 0 ? numericValues[mid] : (numericValues[mid - 1] + numericValues[mid]) / 2;

        columnStats[key] = {
          type: 'numeric',
          count: validValues.length,
          missing: missingCount,
          uniqueValues: uniqueCount,
          min,
          max,
          mean,
          median: Number(median.toFixed(4)),
          sum: Number(sum.toFixed(4)),
          sampleValues: numericValues.slice(0, 5),
        };
      } else {
        columnStats[key] = {
          type: 'string',
          count: validValues.length,
          missing: missingCount,
          uniqueValues: uniqueCount,
          sampleValues: Array.from(new Set(validValues)).slice(0, 5),
        };
      }
    }

    return {
      rowCount: rawRows.length,
      columnCount: targetKeys.length,
      columnStats,
    };
  },
};
