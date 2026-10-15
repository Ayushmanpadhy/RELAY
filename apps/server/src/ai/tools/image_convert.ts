import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Jimp } from 'jimp';
import type { ToolDefinition } from './types.js';

export const ImageConvertInputSchema = z.object({
  imagePath: z.string().optional(),
  base64: z.string().optional(),
  format: z.enum(['png', 'jpeg', 'jpg', 'bmp']).default('png'),
  outputPath: z.string().optional(),
});

export type ImageConvertInput = z.infer<typeof ImageConvertInputSchema>;

export const imageConvertTool: ToolDefinition<ImageConvertInput> = {
  name: 'image_convert',
  description: 'Converts an image between formats (PNG, JPEG, BMP).',
  inputSchema: ImageConvertInputSchema,
  async execute(input) {
    let img: any;
    if (input.imagePath && fs.existsSync(input.imagePath)) {
      img = await Jimp.read(input.imagePath);
    } else if (input.base64) {
      const buf = Buffer.from(input.base64, 'base64');
      img = await Jimp.read(buf);
    } else {
      throw new Error('image_convert requires valid imagePath or base64');
    }

    const fmt = input.format === 'jpg' ? 'jpeg' : input.format;
    const mime = `image/${fmt}`;

    let outputPath = input.outputPath;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      await img.write(outputPath as any);
    }

    const outBuffer = await img.getBuffer(mime as any);

    return {
      format: fmt,
      mime,
      width: img.width,
      height: img.height,
      bytes: outBuffer.length,
      outputPath,
      base64: outBuffer.toString('base64'),
    };
  },
};
