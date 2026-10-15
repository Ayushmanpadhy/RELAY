import { z } from 'zod';

export interface WorkloadContext {
  slowFactor?: number;
}

export interface WorkloadDefinition<
  TParams extends Record<string, unknown> = Record<string, unknown>,
  TPayload extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
  TFinal = unknown,
> {
  type: string;
  label: string;
  description: string;
  paramsSchema: z.ZodType<TParams>;
  split(params: TParams, jobId: string): TPayload[];
  run(payload: TPayload, ctx?: WorkloadContext): TResult | Promise<TResult>;
  reduce(results: TResult[], params: TParams): TFinal;
  presets: {
    small: TParams;
    medium: TParams;
    large: TParams;
  };
}
