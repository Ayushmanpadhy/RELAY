import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Jimp } from 'jimp';
import type { ToolDefinition } from './types.js';

export const ImageResizeInputSchema = z.object({
  imagePath: z.string().optional(),
  base64: z.string().optional(),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000).optional(),
  outputPath: z.string().optional(),
});

export type ImageResizeInput = z.infer<typeof ImageResizeInputSchema>;

export const imageResizeTool: ToolDefinition<ImageResizeInput> = {
  name: 'image_resize',
  description: 'Resizes an image to specified width and height using Jimp.',
  inputSchema: ImageResizeInputSchema,
  async execute(input) {
    let img: any;
    if (input.imagePath && fs.existsSync(input.imagePath)) {
      img = await Jimp.read(input.imagePath);
    } else if (input.base64) {
      const buf = Buffer.from(input.base64, 'base64');
      img = await Jimp.read(buf);
    } else {
      throw new Error('image_resize requires valid imagePath or base64');
    }

    const targetWidth = input.width;
    const targetHeight = input.height ?? Math.round((img.height / img.width) * targetWidth);

    img.resize({ w: targetWidth, h: targetHeight });

    let outputPath = input.outputPath;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      await img.write(outputPath as any);
    }

    const outBuffer = await img.getBuffer('image/png');

    return {
      width: img.width,
      height: img.height,
      bytes: outBuffer.length,
      outputPath,
      base64: outBuffer.toString('base64'),
    };
  },
};
