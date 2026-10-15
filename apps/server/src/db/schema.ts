import type { DatabaseAdapter } from './adapter.js';

export function initializeDatabase(db: DatabaseAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      params TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      total_tasks INTEGER NOT NULL,
      done_tasks INTEGER NOT NULL DEFAULT 0,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      brief TEXT,
      plan_id TEXT,
      current_stage INTEGER DEFAULT 0,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      budget_usd REAL DEFAULT 5,
      deliverable_path TEXT,
      verification TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0,
      worker_id TEXT,
      lease_expires_at INTEGER,
      available_at INTEGER NOT NULL,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      stage_idx INTEGER DEFAULT 0,
      op TEXT DEFAULT 'compute',
      tool TEXT,
      input_ref TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      needs_review INTEGER DEFAULT 0,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      worker_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      outcome TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      brief TEXT NOT NULL,
      manifest TEXT NOT NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      est_cost REAL NOT NULL DEFAULT 0,
      est_tasks INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stages (
      job_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      PRIMARY KEY (job_id, idx),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      task_id TEXT,
      model TEXT NOT NULL,
      tokens_in INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      ms INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      ts INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      managed INTEGER NOT NULL DEFAULT 0,
      pid INTEGER,
      status TEXT NOT NULL,
      slow_factor REAL NOT NULL DEFAULT 1,
      current_task_id TEXT,
      tasks_done INTEGER NOT NULL DEFAULT 0,
      last_heartbeat INTEGER NOT NULL,
      registered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks(status, priority DESC, available_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_job_stage ON tasks(job_id, stage_idx, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks(job_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_worker_id ON tasks(worker_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_task_id ON attempts(task_id);
    CREATE INDEX IF NOT EXISTS idx_stages_job ON stages(job_id, idx);
    CREATE INDEX IF NOT EXISTS idx_llm_calls_job ON llm_calls(job_id);
    CREATE INDEX IF NOT EXISTS idx_plans_job ON plans(job_id);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
  `);

  // Safe migration for existing SQLite databases
  try {
    const jobCols = new Set(db.prepare('PRAGMA table_info(jobs)').all<{ name: string }>().map((c: any) => c.name));
    if (!jobCols.has('brief')) db.exec('ALTER TABLE jobs ADD COLUMN brief TEXT');
    if (!jobCols.has('plan_id')) db.exec('ALTER TABLE jobs ADD COLUMN plan_id TEXT');
    if (!jobCols.has('current_stage')) db.exec('ALTER TABLE jobs ADD COLUMN current_stage INTEGER DEFAULT 0');
    if (!jobCols.has('tokens_in')) db.exec('ALTER TABLE jobs ADD COLUMN tokens_in INTEGER DEFAULT 0');
    if (!jobCols.has('tokens_out')) db.exec('ALTER TABLE jobs ADD COLUMN tokens_out INTEGER DEFAULT 0');
    if (!jobCols.has('cost_usd')) db.exec('ALTER TABLE jobs ADD COLUMN cost_usd REAL DEFAULT 0');
    if (!jobCols.has('budget_usd')) db.exec('ALTER TABLE jobs ADD COLUMN budget_usd REAL DEFAULT 5');
    if (!jobCols.has('deliverable_path')) db.exec('ALTER TABLE jobs ADD COLUMN deliverable_path TEXT');
    if (!jobCols.has('verification')) db.exec('ALTER TABLE jobs ADD COLUMN verification TEXT');

    const taskCols = new Set(db.prepare('PRAGMA table_info(tasks)').all<{ name: string }>().map((c: any) => c.name));
    if (!taskCols.has('stage_idx')) db.exec('ALTER TABLE tasks ADD COLUMN stage_idx INTEGER DEFAULT 0');
    if (!taskCols.has('op')) db.exec("ALTER TABLE tasks ADD COLUMN op TEXT DEFAULT 'compute'");
    if (!taskCols.has('tool')) db.exec('ALTER TABLE tasks ADD COLUMN tool TEXT');
    if (!taskCols.has('input_ref')) db.exec('ALTER TABLE tasks ADD COLUMN input_ref TEXT');
    if (!taskCols.has('tokens_in')) db.exec('ALTER TABLE tasks ADD COLUMN tokens_in INTEGER DEFAULT 0');
    if (!taskCols.has('tokens_out')) db.exec('ALTER TABLE tasks ADD COLUMN tokens_out INTEGER DEFAULT 0');
    if (!taskCols.has('needs_review')) db.exec('ALTER TABLE tasks ADD COLUMN needs_review INTEGER DEFAULT 0');
  } catch {
    // Columns already present or table newly created
  }
}
