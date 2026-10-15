import { create } from 'zustand';
import type {
  WorkerInfo,
  Job,
  TasksSummary,
  Config,
  EventLog,
  JobDetailResponse,
  WorkloadMetadata,
  SSEEvent,
  TaskSummary,
  Attempt,
} from '@relay/shared';
import { api } from '../api/client';

interface RelayState {
  connected: boolean;
  reconnecting: boolean;
  workers: WorkerInfo[];
  jobs: Job[];
  tasksSummary: TasksSummary;
  config: Config | null;
  logs: EventLog[];
  jobDetail: JobDetailResponse | null;
  workloads: WorkloadMetadata[];
  activeJobId: string | null;

  initSSE: () => () => void;
  fetchJobDetail: (id: string) => Promise<void>;
  fetchWorkloads: () => Promise<void>;
  clearJobDetail: () => void;
}

export const useRelayStore = create<RelayState>((set) => ({
  connected: false,
  reconnecting: false,
  workers: [],
  jobs: [],
  tasksSummary: { queued: 0, running: 0, done: 0, dead: 0 },
  config: null,
  logs: [],
  jobDetail: null,
  workloads: [],
  activeJobId: null,

  initSSE: () => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isClosed = false;

    // Load initial logs
    api.fetchRecentEvents().then((logs) => {
      set({ logs });
    }).catch(() => {});

    // Load workloads metadata
    api.fetchWorkloads().then((workloads) => {
      set({ workloads });
    }).catch(() => {});

    function connect() {
      if (isClosed) return;
      eventSource = new EventSource('/api/stream');

      eventSource.onopen = () => {
        set({ connected: true, reconnecting: false });
      };

      eventSource.onmessage = (event) => {
        try {
          const sseEvent: SSEEvent = JSON.parse(event.data);

          switch (sseEvent.type) {
            case 'snapshot': {
              const { workers, jobs, tasksSummary, config } = sseEvent.data;
              set({ workers, jobs, tasksSummary, config, connected: true, reconnecting: false });
              break;
            }

            case 'worker': {
              const updatedWorker = sseEvent.data;
              set((state) => {
                const index = state.workers.findIndex((w) => w.id === updatedWorker.id);
                if (index >= 0) {
                  const updated = [...state.workers];
                  updated[index] = updatedWorker;
                  return { workers: updated };
                } else {
                  return { workers: [...state.workers, updatedWorker] };
                }
              });
              break;
            }

            case 'job': {
              const updatedJob = sseEvent.data;
              set((state) => {
                const index = state.jobs.findIndex((j) => j.id === updatedJob.id);
                let newJobs: Job[];
                if (index >= 0) {
                  newJobs = [...state.jobs];
                  newJobs[index] = updatedJob;
                } else {
                  newJobs = [updatedJob, ...state.jobs];
                }

                // If currently viewing this job in detail, update it
                let newDetail = state.jobDetail;
                if (state.jobDetail && state.jobDetail.job.id === updatedJob.id) {
                  newDetail = {
                    ...state.jobDetail,
                    job: updatedJob,
                  };
                }

                return { jobs: newJobs, jobDetail: newDetail };
              });
              break;
            }

            case 'task': {
              const taskSummary: TaskSummary = sseEvent.data;
              set((state) => {
                // If viewing this job in detail, update the corresponding task
                if (state.jobDetail && state.jobDetail.job.id === taskSummary.job_id) {
                  const currentTasks = state.jobDetail.tasks;
                  const taskIndex = currentTasks.findIndex((t) => t.id === taskSummary.id);
                  if (taskIndex >= 0) {
                    const updatedTasks = [...currentTasks];
                    updatedTasks[taskIndex] = {
                      ...updatedTasks[taskIndex],
                      status: taskSummary.status,
                      worker_id: taskSummary.worker_id,
                      attempts: taskSummary.attempts,
                    };
                    return {
                      jobDetail: {
                        ...state.jobDetail,
                        tasks: updatedTasks,
                      },
                    };
                  }
                }
                return {};
              });
              break;
            }

            case 'attempt': {
              const attempt: Attempt = sseEvent.data;
              set((state) => {
                if (state.jobDetail) {
                  const attempts = state.jobDetail.attempts;
                  const idx = attempts.findIndex((a) => a.id === attempt.id || (a.task_id === attempt.task_id && a.attempt === attempt.attempt));
                  let newAttempts: Attempt[];
                  if (idx >= 0) {
                    newAttempts = [...attempts];
                    newAttempts[idx] = attempt;
                  } else {
                    newAttempts = [...attempts, attempt];
                  }
                  return {
                    jobDetail: {
                      ...state.jobDetail,
                      attempts: newAttempts,
                    },
                  };
                }
                return {};
              });
              break;
            }

            case 'log': {
              const logEntry: EventLog = {
                id: Date.now() + Math.random(),
                ts: sseEvent.data.ts,
                level: sseEvent.data.level,
                message: sseEvent.data.message,
              };
              set((state) => ({
                logs: [...state.logs.slice(-199), logEntry],
              }));
              break;
            }
          }
        } catch {
          // ignore parsing error
        }
      };

      eventSource.onerror = () => {
        set({ connected: false, reconnecting: true });
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        if (!isClosed) {
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };
    }

    connect();

    return () => {
      isClosed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) eventSource.close();
    };
  },

  fetchJobDetail: async (id: string) => {
    set({ activeJobId: id });
    try {
      const detail = await api.fetchJobDetail(id);
      set({ jobDetail: detail });
    } catch (err) {
      console.error('Failed to load job detail:', err);
    }
  },

  fetchWorkloads: async () => {
    try {
      const workloads = await api.fetchWorkloads();
      set({ workloads });
    } catch (err) {
      console.error('Failed to load workloads:', err);
    }
  },

  clearJobDetail: () => {
    set({ jobDetail: null, activeJobId: null });
  },
}));
