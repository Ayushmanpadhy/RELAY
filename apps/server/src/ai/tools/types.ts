import type { ZodType } from 'zod';
import type { ToolName } from '@relay/shared';

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: ToolName;
  description: string;
  inputSchema: ZodType<any, any, any>;
  execute(input: TInput, context?: Record<string, unknown>): Promise<TOutput>;
}
