import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const RegexExtractInputSchema = z.object({
  text: z.string(),
  pattern: z.string().max(1000),
  flags: z.string().default('g'),
  limit: z.number().int().min(1).max(5000).default(1000),
});

export type RegexExtractInput = z.infer<typeof RegexExtractInputSchema>;

export const regexExtractTool: ToolDefinition<RegexExtractInput> = {
  name: 'regex_extract',
  description: 'Extracts matching strings or capture groups from text using a regular expression pattern.',
  inputSchema: RegexExtractInputSchema,
  async execute(input) {
    const flags = input.flags.includes('g') ? input.flags : input.flags + 'g';
    const regex = new RegExp(input.pattern, flags);
    const matches: Array<{ match: string; groups?: Record<string, string> | string[] }> = [];

    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = regex.exec(input.text)) !== null && count < input.limit) {
      if (m[0].length === 0) {
        regex.lastIndex++;
      }
      matches.push({
        match: m[0],
        groups: m.groups ? { ...m.groups } : m.slice(1),
      });
      count++;
    }

    return {
      matches,
      count: matches.length,
    };
  },
};
