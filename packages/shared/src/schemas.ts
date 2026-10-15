import { z } from 'zod';

export const RegisterWorkerSchema = z.object({
  name: z.string().min(1).max(50),
});
export type RegisterWorkerInput = z.infer<typeof RegisterWorkerSchema>;

export const HeartbeatSchema = z.object({
  currentTaskId: z.string().optional(),
});
export type HeartbeatInput = z.infer<typeof HeartbeatSchema>;

export const CompleteTaskSchema = z.object({
  workerId: z.string(),
  attempt: z.number().int().positive(),
  result: z.unknown(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskSchema>;

export const FailTaskSchema = z.object({
  workerId: z.string(),
  attempt: z.number().int().positive(),
  error: z.string(),
});
export type FailTaskInput = z.infer<typeof FailTaskSchema>;

export const CreateJobSchema = z.object({
  type: z.string(),
  params: z.record(z.unknown()),
  priority: z.number().int().min(0).max(2).default(1),
  brief: z.string().optional(),
  budget_usd: z.number().positive().optional(),
});
export type CreateJobInput = z.infer<typeof CreateJobSchema>;

export const ScaleClusterSchema = z.object({
  count: z.number().int().min(0).max(8),
});
export type ScaleClusterInput = z.infer<typeof ScaleClusterSchema>;

export const SlowWorkerSchema = z.object({
  factor: z.number().positive(),
});
export type SlowWorkerInput = z.infer<typeof SlowWorkerSchema>;

export const ToolNameSchema = z.enum([
  'image_resize',
  'image_convert',
  'csv_clean',
  'csv_stats',
  'text_extract',
  'hash_files',
  'json_to_csv',
  'regex_extract',
  'translate',
  'summarize',
  'extract_fields',
  'classify',
]);

export const PlanSchema = z.object({
  userSummary: z.string().min(1),
  understanding: z.string().min(1),
  strategy: z.enum(['per_file', 'chunk_text', 'chunk_rows', 'page_groups', 'single']),
  chunking: z.object({
    unit: z.enum(['file', 'tokens', 'rows', 'pages']),
    target: z.number().int().positive(),
  }),
  map: z.object({
    op: z.enum(['llm', 'tool']),
    tool: ToolNameSchema.optional(),
    instruction: z.string().min(1),
    outputSchema: z.record(z.unknown()),
  }),
  reduce: z.object({
    op: z.enum(['concat', 'merge_json', 'table_union', 'llm_synthesis']),
    instruction: z.string().optional(),
    fanIn: z.number().int().positive().default(20),
  }),
  deliverable: z.object({
    format: z.enum(['md', 'docx', 'xlsx', 'csv', 'json', 'zip']),
    filename: z.string().min(1),
    description: z.string().min(1),
  }),
  assumptions: z.array(z.string()),
  questions: z.array(z.string()).max(3),
  risks: z.array(z.string()),
});
export type PlanInput = z.infer<typeof PlanSchema>;

export const ApprovePlanSchema = z.object({
  confirmCost: z.boolean().optional(),
});
export type ApprovePlanInput = z.infer<typeof ApprovePlanSchema>;

export const SubmitAnswersSchema = z.object({
  answers: z.array(z.string()),
});
export type SubmitAnswersInput = z.infer<typeof SubmitAnswersSchema>;

export const ReplanSchema = z.object({
  brief: z.string().min(1),
});
export type ReplanInput = z.infer<typeof ReplanSchema>;

export const LlmProxyRequestSchema = z.object({
  jobId: z.string(),
  taskId: z.string().optional(),
  system: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.union([
        z.string(),
        z.array(
          z.union([
            z.object({ type: z.literal('text'), text: z.string() }),
            z.object({
              type: z.literal('image'),
              source: z.object({
                type: z.literal('base64'),
                media_type: z.string(),
                data: z.string(),
              }),
            }),
          ])
        ),
      ]),
    })
  ),
  schema: z.record(z.unknown()).optional(),
  maxTokens: z.number().int().positive().optional(),
  model: z.string().optional(),
});
export type LlmProxyRequestInput = z.infer<typeof LlmProxyRequestSchema>;
