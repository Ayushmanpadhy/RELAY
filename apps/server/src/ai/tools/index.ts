import type { ToolName } from '@relay/shared';
import type { ToolDefinition } from './types.js';
import { csvCleanTool } from './csv_clean.js';
import { csvStatsTool } from './csv_stats.js';
import { regexExtractTool } from './regex_extract.js';
import { textExtractTool } from './text_extract.js';
import { hashFilesTool } from './hash_files.js';
import { jsonToCsvTool } from './json_to_csv.js';
import { imageResizeTool } from './image_resize.js';
import { imageConvertTool } from './image_convert.js';
import {
  translateTool,
  summarizeTool,
  extractFieldsTool,
  classifyTool,
} from './presets.js';

export * from './types.js';
export * from './csv_clean.js';
export * from './csv_stats.js';
export * from './regex_extract.js';
export * from './text_extract.js';
export * from './hash_files.js';
export * from './json_to_csv.js';
export * from './image_resize.js';
export * from './image_convert.js';
export * from './presets.js';

export const TOOLS_REGISTRY: Record<ToolName, ToolDefinition<any, any>> = {
  csv_clean: csvCleanTool,
  csv_stats: csvStatsTool,
  regex_extract: regexExtractTool,
  text_extract: textExtractTool,
  hash_files: hashFilesTool,
  json_to_csv: jsonToCsvTool,
  image_resize: imageResizeTool,
  image_convert: imageConvertTool,
  translate: translateTool,
  summarize: summarizeTool,
  extract_fields: extractFieldsTool,
  classify: classifyTool,
};

export function getTool(name: ToolName): ToolDefinition<any, any> | undefined {
  return TOOLS_REGISTRY[name];
}

export function listTools(): Array<{ name: ToolName; description: string }> {
  return Object.values(TOOLS_REGISTRY).map(t => ({
    name: t.name,
    description: t.description,
  }));
}
