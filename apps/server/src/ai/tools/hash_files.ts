import crypto from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const HashFilesInputSchema = z.object({
  text: z.string().optional(),
  filePath: z.string().optional(),
  base64: z.string().optional(),
  algorithm: z.enum(['sha256', 'sha512', 'md5']).default('sha256'),
});

export type HashFilesInput = z.infer<typeof HashFilesInputSchema>;

export const hashFilesTool: ToolDefinition<HashFilesInput> = {
  name: 'hash_files',
  description: 'Computes cryptographic hash (SHA-256, SHA-512, MD5) of text, buffer, or file.',
  inputSchema: HashFilesInputSchema,
  async execute(input) {
    const hash = crypto.createHash(input.algorithm);
    let bytes = 0;

    if (input.filePath && fs.existsSync(input.filePath)) {
      const buffer = fs.readFileSync(input.filePath);
      hash.update(buffer);
      bytes = buffer.length;
    } else if (input.base64) {
      const buffer = Buffer.from(input.base64, 'base64');
      hash.update(buffer);
      bytes = buffer.length;
    } else if (input.text !== undefined) {
      const buffer = Buffer.from(input.text, 'utf-8');
      hash.update(buffer);
      bytes = buffer.length;
    } else {
      throw new Error('hash_files requires text, filePath, or base64 input');
    }

    const digest = hash.digest('hex');
    return {
      hash: digest,
      algorithm: input.algorithm,
      bytes,
    };
  },
};
