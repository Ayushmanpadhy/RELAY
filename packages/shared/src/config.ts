export const CONFIG = {
  HEARTBEAT_INTERVAL_MS: 1000,
  WORKER_DEAD_AFTER_MS: 4000,   // no heartbeat for this long => worker DEAD
  LEASE_MS: 8000,              // a claimed task must be renewed (heartbeat renews) or it expires
  CLAIM_POLL_MS: 400,          // idle worker polls this often
  SWEEP_INTERVAL_MS: 500,
  MAX_ATTEMPTS: 5,
  BACKOFF_BASE_MS: 500,        // retry delay = BASE * 2^(attempt-1), capped at 8000
  DEFAULT_WORKERS: 3,
  MAX_MANAGED_WORKERS: 8,

  // Relay V3 Configuration
  RELAY_PLANNER_MODEL: 'claude-sonnet-5-5',
  RELAY_WORKER_MODEL: 'claude-haiku-5-5',
  MAX_JOB_COST_USD: 5,
  LLM_MAX_CONCURRENCY: 8,
  MAX_UPLOAD_BYTES: 500 * 1024 * 1024, // 500 MB limit
  MAX_UPLOAD_FILES: 2000,              // Max 2,000 files per upload
  RETENTION_DAYS: 7,
} as const;

export type Config = typeof CONFIG;

export function calculateBackoff(attempt: number, baseMs: number = CONFIG.BACKOFF_BASE_MS): number {
  if (attempt <= 0) return 0;
  return Math.min(8000, baseMs * Math.pow(2, attempt - 1));
}
