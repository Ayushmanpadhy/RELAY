import type { Config } from './config.js';

export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
export type TaskStatus = 'PENDING' | 'LEASED' | 'DONE' | 'DEAD';
export type WorkerStatus = 'IDLE' | 'BUSY' | 'DEAD' | 'STOPPED';
export type AttemptOutcome = 'DONE' | 'FAILED' | 'LOST';
export type LogLevel = 'info' | 'warn' | 'error';

export type ToolName =
  | 'image_resize'
  | 'image_convert'
  | 'csv_clean'
  | 'csv_stats'
  | 'text_extract'
  | 'hash_files'
  | 'json_to_csv'
  | 'regex_extract'
  | 'translate'
  | 'summarize'
  | 'extract_fields'
  | 'classify';

export interface ManifestItem {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  pages?: number;
  rows?: number;
  textPreview: string;
  estTokens: number;
  extractedPath?: string;
  error?: string;
}

export interface Manifest {
  files: ManifestItem[];
  summary: string;
  totalFiles: number;
  totalBytes: number;
  totalEstTokens: number;
}

export type PlanStrategy = 'per_file' | 'chunk_text' | 'chunk_rows' | 'page_groups' | 'single';
export type ChunkUnit = 'file' | 'tokens' | 'rows' | 'pages';
export type DeliverableFormat = 'md' | 'docx' | 'xlsx' | 'csv' | 'json' | 'zip';

export interface PlanChunking {
  unit: ChunkUnit;
  target: number;
}

export interface PlanMap {
  op: 'llm' | 'tool';
  tool?: ToolName;
  instruction: string;
  outputSchema: Record<string, unknown>;
}

export interface PlanReduce {
  op: 'concat' | 'merge_json' | 'table_union' | 'llm_synthesis';
  instruction?: string;
  fanIn: number;
}

export interface PlanDeliverable {
  format: DeliverableFormat;
  filename: string;
  description: string;
}

export interface Plan {
  userSummary: string;
  understanding: string;
  strategy: PlanStrategy;
  chunking: PlanChunking;
  map: PlanMap;
  reduce: PlanReduce;
  deliverable: PlanDeliverable;
  assumptions: string[];
  questions: string[];
  risks: string[];
}

export type PlanStatus = 'DRAFT' | 'APPROVED' | 'REJECTED';

export interface PlanRecord {
  id: string;
  job_id: string;
  brief: string;
  manifest: Manifest;
  plan: Plan;
  status: PlanStatus;
  est_cost: number;
  est_tasks: number;
  created_at: number;
}

export type StageKind = 'map' | 'reduce' | 'verify';
export type StageStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export interface Stage {
  job_id: string;
  idx: number;
  kind: StageKind;
  status: StageStatus;
  started_at?: number | null;
  finished_at?: number | null;
}

export interface VerificationSample {
  task_id: string;
  sourceSlice: string;
  output: unknown;
  verified: boolean;
  issues: string[];
}

export interface VerificationResult {
  ok: boolean;
  issues: string[];
  sample_count: number;
  samples: VerificationSample[];
}

export interface Job {
  id: string;
  type: string;
  params: Record<string, unknown>;
  priority: number;
  status: JobStatus;
  total_tasks: number;
  done_tasks: number;
  result: unknown | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;

  // V3 additions
  brief?: string | null;
  plan_id?: string | null;
  current_stage?: number;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  budget_usd?: number;
  deliverable_path?: string | null;
  verification?: VerificationResult | null;
}

export interface Task {
  id: string;
  job_id: string;
  idx: number;
  payload: Record<string, unknown>;
  status: TaskStatus;
  priority: number;
  attempts: number;
  worker_id: string | null;
  lease_expires_at: number | null;
  available_at: number;
  result: unknown | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;

  // V3 additions
  stage_idx: number;
  op?: 'llm' | 'tool' | 'compute';
  tool?: ToolName | null;
  input_ref?: {
    fileId: string;
    filePath: string;
    start?: number;
    end?: number;
    slice?: string;
  } | null;
  tokens_in?: number;
  tokens_out?: number;
  needs_review?: boolean;
}

export interface TaskSummary {
  id: string;
  job_id: string;
  idx: number;
  status: TaskStatus;
  worker_id: string | null;
  attempts: number;
  stage_idx?: number;
  needs_review?: boolean;
}

export interface Attempt {
  id: number;
  task_id: string;
  attempt: number;
  worker_id: string;
  started_at: number;
  ended_at: number | null;
  outcome: AttemptOutcome | null;
}

export interface WorkerInfo {
  id: string;
  name: string;
  managed: boolean;
  pid: number | null;
  status: WorkerStatus;
  slow_factor: number;
  current_task_id: string | null;
  tasks_done: number;
  last_heartbeat: number;
  registered_at: number;
}

export interface EventLog {
  id: number;
  ts: number;
  level: LogLevel;
  message: string;
}

export interface TasksSummary {
  queued: number;
  running: number;
  done: number;
  dead: number;
}

export interface ClusterStateSnapshot {
  workers: WorkerInfo[];
  jobs: Job[];
  tasksSummary: TasksSummary;
  config: Config;
}

export interface WorkloadMetadata {
  type: string;
  label: string;
  description: string;
  presets: {
    small: Record<string, unknown>;
    medium: Record<string, unknown>;
    large: Record<string, unknown>;
  };
}

export interface JobDetailResponse {
  job: Job;
  tasks: Task[];
  attempts: Attempt[];
  stages?: Stage[];
  plan?: PlanRecord | null;
  samples?: Array<{ source: string; output: unknown }>;
}

export interface WorkerHeartbeatResponse {
  commands: {
    slowFactor: number;
    stop: boolean;
  };
}

export interface LlmCall {
  id: number;
  job_id: string;
  task_id?: string | null;
  model: string;
  tokens_in: number;
  tokens_out: number;
  ms: number;
  ok: boolean;
  error?: string | null;
  ts: number;
}

export type SSEEvent =
  | { type: 'snapshot'; data: ClusterStateSnapshot }
  | { type: 'worker'; data: WorkerInfo }
  | { type: 'job'; data: Job }
  | { type: 'task'; data: TaskSummary }
  | { type: 'attempt'; data: Attempt }
  | { type: 'stage'; data: Stage }
  | { type: 'plan'; data: PlanRecord }
  | { type: 'log'; data: { ts: number; level: LogLevel; message: string } };
