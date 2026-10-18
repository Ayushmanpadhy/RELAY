import type {
  ClusterStateSnapshot,
  WorkloadMetadata,
  JobDetailResponse,
  Job,
  EventLog,
  Plan,
  Manifest,
  PlanRecord,
  Stage,
  VerificationResult,
} from '@relay/shared';

const BASE_URL = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(!isFormData && { 'Content-Type': 'application/json' }),
    ...(options?.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || errorBody?.error || `HTTP ${res.status}`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }

  return res.json();
}

export interface RequestDraftResponse {
  jobId: string;
  planId: string;
  manifest: Manifest;
  plan: Plan;
  estCost: number;
  estTasks: number;
  planRecord?: PlanRecord;
}

export interface SamplePair {
  taskId: string;
  taskIdx: number;
  status: string;
  inputPreview: string;
  outputResult: any;
  needsReview: boolean;
  attempts: number;
  workerId?: string | null;
}

export interface JobSamplesResponse {
  jobId: string;
  verification?: VerificationResult | null;
  samples: SamplePair[];
}

export const api = {
  fetchState: () => request<ClusterStateSnapshot>('/api/state'),
  fetchWorkloads: () => request<WorkloadMetadata[]>('/api/workloads'),
  fetchJobDetail: (id: string) => request<JobDetailResponse>(`/api/jobs/${id}`),
  fetchRecentEvents: () => request<EventLog[]>('/api/events/recent'),

  // V3 Endpoints
  createRequestMultipart: (formData: FormData) =>
    request<RequestDraftResponse>('/api/requests', {
      method: 'POST',
      body: formData,
    }),

  createRequestJson: (data: { brief: string; files: Array<{ name: string; content: string; mime?: string }> }) =>
    request<RequestDraftResponse>('/api/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getRequest: (id: string) =>
    request<{ job?: Job; plan?: Plan; manifest?: Manifest; planRecord?: PlanRecord; stages: Stage[] }>(
      `/api/requests/${id}`
    ),

  submitAnswers: (id: string, answers: string[]) =>
    request<{ plan: Plan; estCost: number; estTasks: number }>(`/api/requests/${id}/answers`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),

  replan: (id: string, brief: string) =>
    request<{ plan: Plan; estCost: number; estTasks: number }>(`/api/requests/${id}/replan`, {
      method: 'POST',
      body: JSON.stringify({ brief }),
    }),

  approvePlan: (id: string, confirmCost: boolean = false) =>
    request<{ ok: boolean; jobId: string; totalTasks: number }>(`/api/requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ confirmCost }),
    }),

  fetchJobSamples: (id: string) => request<JobSamplesResponse>(`/api/jobs/${id}/samples`),
  fetchJobStages: (id: string) => request<{ stages: Stage[] }>(`/api/jobs/${id}/stages`),
  getDeliverableUrl: (id: string) => `${BASE_URL}/api/jobs/${id}/deliverable`,

  // Core cluster & job controls
  createJob: (type: string, params: Record<string, unknown>, priority: number = 1) =>
    request<Job>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ type, params, priority }),
    }),

  cancelJob: (id: string) =>
    request<{ ok: boolean; job: Job }>(`/api/jobs/${id}/cancel`, {
      method: 'POST',
    }),

  spawnWorker: () =>
    request<{ ok: boolean; pid: number }>('/api/cluster/spawn', {
      method: 'POST',
    }),

  scaleCluster: (count: number) =>
    request<{ liveCount: number; target: number }>('/api/cluster/scale', {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),

  killWorker: (id: string) =>
    request<{ ok: boolean }>(`/api/workers/${id}/kill`, {
      method: 'POST',
    }),

  slowWorker: (id: string, factor: number) =>
    request<{ ok: boolean }>(`/api/workers/${id}/slow`, {
      method: 'POST',
      body: JSON.stringify({ factor }),
    }),

  stopWorker: (id: string) =>
    request<{ ok: boolean }>(`/api/workers/${id}/stop`, {
      method: 'POST',
    }),
};
