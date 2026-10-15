import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const TextExtractInputSchema = z.object({
  text: z.string(),
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  startDelimiter: z.string().optional(),
  endDelimiter: z.string().optional(),
});

export type TextExtractInput = z.infer<typeof TextExtractInputSchema>;

export const textExtractTool: ToolDefinition<TextExtractInput> = {
  name: 'text_extract',
  description: 'Extracts slices, lines, or delimited blocks from a body of text.',
  inputSchema: TextExtractInputSchema,
  async execute(input) {
    let result = input.text;

    // 1. Delimiter-based extraction
    if (input.startDelimiter) {
      const idx = result.indexOf(input.startDelimiter);
      if (idx !== -1) {
        result = result.substring(idx + input.startDelimiter.length);
      }
    }
    if (input.endDelimiter) {
      const idx = result.indexOf(input.endDelimiter);
      if (idx !== -1) {
        result = result.substring(0, idx);
      }
    }

    // 2. Line-based extraction
    if (input.startLine !== undefined || input.endLine !== undefined) {
      const lines = result.split(/\r?\n/);
      const start = input.startLine ? Math.max(0, input.startLine - 1) : 0;
      const end = input.endLine ? Math.min(lines.length, input.endLine) : lines.length;
      result = lines.slice(start, end).join('\n');
    }

    // 3. Offset-based extraction
    if (input.startOffset !== undefined || input.endOffset !== undefined) {
      const start = input.startOffset ?? 0;
      const end = input.endOffset ?? result.length;
      result = result.substring(start, end);
    }

    return {
      extracted: result,
      length: result.length,
      lines: result.split(/\r?\n/).length,
    };
  },
};
