export interface ResultFile {
  name: string;
  size: number;
  downloadUrl: string;
}

export interface JobResult {
  headline: string;
  explanation: string;
  files?: ResultFile[];
}

export interface TaskIteration {
  id: string;
  iteration: number;
  promptPreview?: string;
  fullPrompt?: string;
  status: "queued" | "analyzing" | "working" | "assembling" | "done" | "failed";
  progress?: number;
  stepLabel?: string;
  mode?: "exact" | "ai";
  partCount?: number;
  createdAt?: string;
  finishedAt?: string | null;
  result?: JobResult | null;
  stats?: Record<string, unknown>;
  job?: JobRecord;
  parts?: PartRecord[];
}

export interface JobRecord {
  id: string;
  userId?: string;
  promptPreview?: string;
  fullPrompt?: string;
  status: "queued" | "analyzing" | "working" | "assembling" | "done" | "failed";
  progress: number;
  stepLabel?: string;
  createdAt?: string;
  finishedAt?: string | null;
  result?: JobResult | null;
  clarifyingQuestions?: string[];
  fileCount?: number;
  mode?: "exact" | "ai";
  partCount?: number;
  reassignments?: number;
  crashedAttempts?: number;
  rootJobId?: string | null;
  parentJobId?: string | null;
  iteration?: number;
  iterationCount?: number;
  iterations?: TaskIteration[];
  latestJobId?: string;
  latestStatus?: string;
  latestPrompt?: string;
  plan?: {
    intent?: string;
    mode?: "exact" | "ai";
    partCount?: number;
    partCountReason?: string;
    reduce?: string;
    tool?: string | null;
    toolArgs?: Record<string, unknown>;
  };
}

export interface PartAttempt {
  nodeId: string;
  provider: string;
  model: string;
  durationMs: number;
  error?: string | null;
  timestamp: number;
}

export interface PartRecord {
  partId: string;
  idx: number;
  size: number;
  execution: "tool" | "ai";
  tool?: string | null;
  nodeId?: string | null;
  provider?: string | null;
  model?: string | null;
  attempts: PartAttempt[];
  status: "queued" | "running" | "done" | "failed" | "dead";
  output?: unknown;
  error?: string | null;
}

export interface NodeRecord {
  nodeId: string;
  state: "idle" | "working" | "crashed" | "recovering";
  provider: string;
  currentJobId?: string | null;
  currentPartId?: string | null;
  completed?: number;
  failed?: number;
  lastChange?: number;
}

export interface ProviderRecord {
  id: string;
  provider_id?: string;
  name: string;
  model: string;
  state: "healthy" | "degraded" | "crashed" | "recovering" | "unavailable";
  reason?: string;
  latencyMs: number;
  errorRate: number;
  circuit?: string;
}

export interface EventRecord {
  eventId: string;
  ts: number;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  jobId?: string | null;
  nodeId?: string | null;
}

export interface UserRecord {
  uid: string;
  email: string;
  displayName?: string | null;
  role: "admin" | "user";
  createdAt?: string;
  jobCount: number;
}
