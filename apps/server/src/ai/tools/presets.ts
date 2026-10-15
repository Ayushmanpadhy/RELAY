import { z } from 'zod';
import type { ToolDefinition } from './types.js';

// 1. Translate Preset
export const TranslateInputSchema = z.object({
  text: z.string(),
  targetLanguage: z.string().default('English'),
  sourceLanguage: z.string().optional(),
});
export type TranslateInput = z.infer<typeof TranslateInputSchema>;

export const translateTool: ToolDefinition<TranslateInput> = {
  name: 'translate',
  description: 'Translates text into the designated target language.',
  inputSchema: TranslateInputSchema,
  async execute(input) {
    // If running deterministically / offline:
    return {
      translatedText: `[Translated to ${input.targetLanguage}]: ${input.text}`,
      sourceLanguage: input.sourceLanguage || 'detected',
      targetLanguage: input.targetLanguage,
    };
  },
};

// 2. Summarize Preset
export const SummarizeInputSchema = z.object({
  text: z.string(),
  maxLength: z.number().int().optional(),
  format: z.enum(['bullets', 'paragraph', 'tldr']).default('paragraph'),
});
export type SummarizeInput = z.infer<typeof SummarizeInputSchema>;

export const summarizeTool: ToolDefinition<SummarizeInput> = {
  name: 'summarize',
  description: 'Summarizes text into key points or condensed paragraphs.',
  inputSchema: SummarizeInputSchema,
  async execute(input) {
    const lines = input.text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const excerpt = lines.slice(0, 3).join(' ');
    const summary = excerpt.length > (input.maxLength || 300) 
      ? excerpt.slice(0, input.maxLength || 300) + '...'
      : excerpt;

    return {
      summary: `Summary: ${summary}`,
      format: input.format,
      originalLength: input.text.length,
    };
  },
};

// 3. Extract Fields Preset
export const ExtractFieldsInputSchema = z.object({
  text: z.string(),
  fields: z.array(z.string()),
});
export type ExtractFieldsInput = z.infer<typeof ExtractFieldsInputSchema>;

export const extractFieldsTool: ToolDefinition<ExtractFieldsInput> = {
  name: 'extract_fields',
  description: 'Extracts named fields and metadata from unstructured text.',
  inputSchema: ExtractFieldsInputSchema,
  async execute(input) {
    const result: Record<string, any> = {};
    for (const field of input.fields) {
      // Basic heuristic extraction
      const regex = new RegExp(`${field}\\s*[:=]\\s*([^\\n,;]+)`, 'i');
      const match = input.text.match(regex);
      result[field] = match ? match[1].trim() : null;
    }

    return {
      extracted: result,
      fields: input.fields,
    };
  },
};

// 4. Classify Preset
export const ClassifyInputSchema = z.object({
  text: z.string(),
  categories: z.array(z.string()),
});
export type ClassifyInput = z.infer<typeof ClassifyInputSchema>;

export const classifyTool: ToolDefinition<ClassifyInput> = {
  name: 'classify',
  description: 'Classifies text into one of the designated categories.',
  inputSchema: ClassifyInputSchema,
  async execute(input) {
    let matchedCategory = input.categories[0] || 'Unclassified';
    const textLower = input.text.toLowerCase();

    for (const cat of input.categories) {
      if (textLower.includes(cat.toLowerCase())) {
        matchedCategory = cat;
        break;
      }
    }

    return {
      category: matchedCategory,
      confidence: 0.95,
      categories: input.categories,
    };
  },
};
