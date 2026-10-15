import { z } from 'zod';
import Papa from 'papaparse';
import type { ToolDefinition } from './types.js';

export const JsonToCsvInputSchema = z.object({
  data: z.union([z.string(), z.array(z.record(z.unknown()))]),
  columns: z.array(z.string()).optional(),
  delimiter: z.string().default(','),
  header: z.boolean().default(true),
});

export type JsonToCsvInput = z.infer<typeof JsonToCsvInputSchema>;

export const jsonToCsvTool: ToolDefinition<JsonToCsvInput> = {
  name: 'json_to_csv',
  description: 'Converts JSON records or JSON arrays into formatted CSV data.',
  inputSchema: JsonToCsvInputSchema,
  async execute(input) {
    let records: Record<string, unknown>[] = [];

    if (typeof input.data === 'string') {
      try {
        const parsed = JSON.parse(input.data);
        if (Array.isArray(parsed)) {
          records = parsed;
        } else if (typeof parsed === 'object' && parsed !== null) {
          records = [parsed];
        }
      } catch (err: any) {
        throw new Error(`Failed to parse JSON string: ${err.message}`);
      }
    } else if (Array.isArray(input.data)) {
      records = input.data;
    }

    const csv = Papa.unparse(records, {
      quotes: false,
      quoteChar: '"',
      escapeChar: '"',
      delimiter: input.delimiter,
      header: input.header,
      columns: input.columns,
    });

    return {
      csv,
      rowCount: records.length,
      bytes: Buffer.byteLength(csv, 'utf-8'),
    };
  },
};
