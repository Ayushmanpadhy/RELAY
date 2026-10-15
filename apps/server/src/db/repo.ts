import type { DatabaseAdapter } from './adapter.js';
import {
  CONFIG,
  calculateBackoff,
  type Job,
  type Task,
  type Attempt,
  type WorkerInfo,
  type EventLog,
  type TasksSummary,
  type ClusterStateSnapshot,
  type LogLevel,
  type Plan,
  type PlanRecord,
  type PlanStatus,
  type Stage,
  type StageKind,
  type StageStatus,
  type ToolName,
  type VerificationResult,
  type LlmCall,
} from '@relay/shared';

export interface TaskClaimResult {
  task: Task | null;
}

export interface FencingResult {
  success: boolean;
  reason?: string;
  jobId?: string;
  dead?: boolean;
}

export class Repository {
  constructor(private db: DatabaseAdapter) {}

  // ================= Events / Logs =================
  recordEvent(level: LogLevel, message: string): EventLog {
    const ts = Date.now();
    const res = this.db.prepare(
      'INSERT INTO events (ts, level, message) VALUES (?, ?, ?)'
    ).run(ts, level, message);

    const eventId = Number(res.lastInsertRowid);

    // Keep only last 500 events
    this.db.exec(`
      DELETE FROM events WHERE id NOT IN (
        SELECT id FROM events ORDER BY id DESC LIMIT 500
      )
    `);

    return { id: eventId, ts, level, message };
  }

  getRecentEvents(limit: number = 200): EventLog[] {
    const rows = this.db.prepare(
      'SELECT id, ts, level, message FROM events ORDER BY id DESC LIMIT ?'
    ).all<any>(limit);

    return rows.reverse().map((r) => ({
      id: r.id,
      ts: r.ts,
      level: r.level as LogLevel,
      message: r.message,
    }));
  }

  // ================= Workers =================
  registerWorker(id: string, name: string, managed: boolean, pid: number | null): WorkerInfo {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO workers (id, name, managed, pid, status, slow_factor, current_task_id, tasks_done, last_heartbeat, registered_at)
      VALUES (?, ?, ?, ?, 'IDLE', 1.0, NULL, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        managed = excluded.managed,
        pid = excluded.pid,
        status = 'IDLE',
        slow_factor = 1.0,
        current_task_id = NULL,
        last_heartbeat = excluded.last_heartbeat
    `).run(id, name, managed ? 1 : 0, pid, now, now);

    return this.getWorker(id)!;
  }

  getWorker(id: string): WorkerInfo | null {
    const r = this.db.prepare('SELECT * FROM workers WHERE id = ?').get<any>(id);
    if (!r) return null;
    return this.mapWorker(r);
  }

  getAllWorkers(): WorkerInfo[] {
    const rows = this.db.prepare('SELECT * FROM workers ORDER BY registered_at ASC').all<any>();
    return rows.map((r) => this.mapWorker(r));
  }

  updateHeartbeat(workerId: string, currentTaskId?: string): { slowFactor: number; stop: boolean } | null {
    const now = Date.now();
    return this.db.transaction(() => {
      const worker = this.db.prepare('SELECT * FROM workers WHERE id = ?').get<any>(workerId);
      if (!worker) return null;

      // Update heartbeat timestamp
      this.db.prepare(`
        UPDATE workers
        SET last_heartbeat = ?,
            current_task_id = ?
        WHERE id = ?
      `).run(now, currentTaskId ?? worker.current_task_id, workerId);

      // Renew leases for all tasks currently leased to this worker
      const newLeaseExpiry = now + CONFIG.LEASE_MS;
      this.db.prepare(`
        UPDATE tasks
        SET lease_expires_at = ?
        WHERE worker_id = ? AND status = 'LEASED'
      `).run(newLeaseExpiry, workerId);

      return {
        slowFactor: worker.slow_factor,
        stop: worker.status === 'STOPPED',
      };
    });
  }

  setWorkerSlow(workerId: string, factor: number): boolean {
    const res = this.db.prepare('UPDATE workers SET slow_factor = ? WHERE id = ?').run(factor, workerId);
    return res.changes > 0;
  }

  setWorkerStop(workerId: string): boolean {
    const res = this.db.prepare("UPDATE workers SET status = 'STOPPED' WHERE id = ?").run(workerId);
    return res.changes > 0;
  }

  markWorkerDead(workerId: string): boolean {
    const res = this.db.prepare("UPDATE workers SET status = 'DEAD', current_task_id = NULL WHERE id = ?").run(workerId);
    return res.changes > 0;
  }

  deleteWorker(workerId: string): boolean {
    const res = this.db.prepare('DELETE FROM workers WHERE id = ?').run(workerId);
    return res.changes > 0;
  }

  // ================= Jobs & Tasks =================
  // ================= Jobs & Tasks =================
  createJob(
    jobId: string,
    type: string,
    params: Record<string, unknown>,
    priority: number,
    taskPayloads: Record<string, unknown>[] = [],
    brief?: string,
    planId?: string,
    budgetUsd: number = 5,
    initialStatus: 'QUEUED' | 'RUNNING' = 'QUEUED'
  ): Job {
    const now = Date.now();
    const totalTasks = taskPayloads.length;

    return this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO jobs (id, type, params, priority, status, total_tasks, done_tasks, created_at, brief, plan_id, budget_usd, current_stage)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0)
      `).run(jobId, type, JSON.stringify(params), priority, initialStatus, totalTasks, now, brief || null, planId || null, budgetUsd);

      const insertTaskStmt = this.db.prepare(`
        INSERT INTO tasks (id, job_id, idx, payload, status, priority, attempts, available_at, created_at, stage_idx, op)
        VALUES (?, ?, ?, ?, 'PENDING', ?, 0, ?, ?, 0, 'compute')
      `);

      taskPayloads.forEach((payload, idx) => {
        const taskId = `${jobId}_t${idx}`;
        insertTaskStmt.run(taskId, jobId, idx, JSON.stringify(payload), priority, now, now);
      });

      return this.getJob(jobId)!;
    });
  }

  getJob(id: string): Job | null {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get<any>(id);
    if (!r) return null;
    return this.mapJob(r);
  }

  getRecentJobs(limit: number = 50): Job[] {
    const rows = this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all<any>(limit);
    return rows.map((r) => this.mapJob(r));
  }

  updateJobStatus(jobId: string, status: string, error?: string | null): void {
    const now = Date.now();
    const finishedAt = status === 'DONE' || status === 'FAILED' ? now : null;
    this.db.prepare(`
      UPDATE jobs
      SET status = ?,
          error = COALESCE(?, error),
          finished_at = COALESCE(?, finished_at)
      WHERE id = ?
    `).run(status, error ?? null, finishedAt, jobId);
  }

  updateJobStage(jobId: string, currentStage: number, status?: string): void {
    if (status) {
      this.db.prepare(`
        UPDATE jobs SET current_stage = ?, status = ? WHERE id = ?
      `).run(currentStage, status, jobId);
    } else {
      this.db.prepare(`
        UPDATE jobs SET current_stage = ? WHERE id = ?
      `).run(currentStage, jobId);
    }
  }

  updateJobDeliverable(jobId: string, deliverablePath: string): void {
    this.db.prepare('UPDATE jobs SET deliverable_path = ? WHERE id = ?').run(deliverablePath, jobId);
  }

  updateJobVerification(jobId: string, verification: VerificationResult): void {
    this.db.prepare('UPDATE jobs SET verification = ? WHERE id = ?').run(JSON.stringify(verification), jobId);
  }

  getTask(id: string): Task | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get<any>(id);
    if (!r) return null;
    return this.mapTask(r);
  }

  getTasksForJob(jobId: string): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE job_id = ? ORDER BY stage_idx ASC, idx ASC').all<any>(jobId);
    return rows.map((r) => this.mapTask(r));
  }

  getStageTasks(jobId: string, stageIdx: number): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE job_id = ? AND stage_idx = ? ORDER BY idx ASC').all<any>(jobId, stageIdx);
    return rows.map((r) => this.mapTask(r));
  }

  addTasks(
    jobId: string,
    stageIdx: number,
    tasks: Array<{
      idx: number;
      payload: Record<string, unknown>;
      priority?: number;
      op?: 'llm' | 'tool' | 'compute';
      tool?: ToolName;
      input_ref?: any;
    }>
  ): Task[] {
    const now = Date.now();
    return this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO tasks (id, job_id, idx, payload, status, priority, attempts, available_at, created_at, stage_idx, op, tool, input_ref)
        VALUES (?, ?, ?, ?, 'PENDING', ?, 0, ?, ?, ?, ?, ?, ?)
      `);

      tasks.forEach((t) => {
        const taskId = `${jobId}_s${stageIdx}_t${t.idx}`;
        const prio = t.priority ?? 1;
        const op = t.op ?? 'compute';
        const tool = t.tool ?? null;
        const inputRef = t.input_ref ? JSON.stringify(t.input_ref) : null;

        stmt.run(taskId, jobId, t.idx, JSON.stringify(t.payload), prio, now, now, stageIdx, op, tool, inputRef);
      });

      // Update total_tasks count on job
      this.db.prepare(`
        UPDATE jobs
        SET total_tasks = (SELECT COUNT(*) FROM tasks WHERE job_id = ?)
        WHERE id = ?
      `).run(jobId, jobId);

      return this.getStageTasks(jobId, stageIdx);
    });
  }

  setTaskNeedsReview(taskId: string, needsReview: boolean): void {
    this.db.prepare('UPDATE tasks SET needs_review = ? WHERE id = ?').run(needsReview ? 1 : 0, taskId);
  }

  getAttemptsForJob(jobId: string): Attempt[] {
    const rows = this.db.prepare(`
      SELECT a.* FROM attempts a
      JOIN tasks t ON a.task_id = t.id
      WHERE t.job_id = ?
      ORDER BY a.started_at ASC, a.id ASC
    `).all<any>(jobId);
    return rows.map((r) => this.mapAttempt(r));
  }

  // ================= Plans =================
  createPlanRecord(plan: PlanRecord): PlanRecord {
    this.db.prepare(`
      INSERT INTO plans (id, job_id, brief, manifest, plan, status, est_cost, est_tasks, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plan.id,
      plan.job_id,
      plan.brief,
      JSON.stringify(plan.manifest),
      JSON.stringify(plan.plan),
      plan.status,
      plan.est_cost,
      plan.est_tasks,
      plan.created_at
    );
    return plan;
  }

  getPlan(id: string): PlanRecord | null {
    const r = this.db.prepare('SELECT * FROM plans WHERE id = ?').get<any>(id);
    if (!r) return null;
    return {
      id: r.id,
      job_id: r.job_id,
      brief: r.brief,
      manifest: JSON.parse(r.manifest),
      plan: JSON.parse(r.plan),
      status: r.status,
      est_cost: Number(r.est_cost),
      est_tasks: Number(r.est_tasks),
      created_at: Number(r.created_at),
    };
  }

  getPlanByJobId(jobId: string): PlanRecord | null {
    const r = this.db.prepare('SELECT * FROM plans WHERE job_id = ? ORDER BY created_at DESC LIMIT 1').get<any>(jobId);
    if (!r) return null;
    return {
      id: r.id,
      job_id: r.job_id,
      brief: r.brief,
      manifest: JSON.parse(r.manifest),
      plan: JSON.parse(r.plan),
      status: r.status,
      est_cost: Number(r.est_cost),
      est_tasks: Number(r.est_tasks),
      created_at: Number(r.created_at),
    };
  }

  updatePlan(id: string, plan: Plan, status: PlanStatus, estCost?: number, estTasks?: number): void {
    this.db.prepare(`
      UPDATE plans
      SET plan = ?,
          status = ?,
          est_cost = COALESCE(?, est_cost),
          est_tasks = COALESCE(?, est_tasks)
      WHERE id = ?
    `).run(JSON.stringify(plan), status, estCost ?? null, estTasks ?? null, id);
  }

  // ================= Stages =================
  createStages(jobId: string, stages: Array<{ idx: number; kind: StageKind }>): void {
    const stmt = this.db.prepare(`
      INSERT INTO stages (job_id, idx, kind, status, started_at, finished_at)
      VALUES (?, ?, ?, 'PENDING', NULL, NULL)
      ON CONFLICT(job_id, idx) DO UPDATE SET
        kind = excluded.kind,
        status = 'PENDING'
    `);
    this.db.transaction(() => {
      stages.forEach((s) => stmt.run(jobId, s.idx, s.kind));
    });
  }

  getStagesForJob(jobId: string): Stage[] {
    const rows = this.db.prepare('SELECT * FROM stages WHERE job_id = ? ORDER BY idx ASC').all<any>(jobId);
    return rows.map((r) => ({
      job_id: r.job_id,
      idx: Number(r.idx),
      kind: r.kind,
      status: r.status,
      started_at: r.started_at ? Number(r.started_at) : null,
      finished_at: r.finished_at ? Number(r.finished_at) : null,
    }));
  }

  getStage(jobId: string, idx: number): Stage | null {
    const r = this.db.prepare('SELECT * FROM stages WHERE job_id = ? AND idx = ?').get<any>(jobId, idx);
    if (!r) return null;
    return {
      job_id: r.job_id,
      idx: Number(r.idx),
      kind: r.kind,
      status: r.status,
      started_at: r.started_at ? Number(r.started_at) : null,
      finished_at: r.finished_at ? Number(r.finished_at) : null,
    };
  }

  updateStageStatus(jobId: string, idx: number, status: StageStatus, startedAt?: number, finishedAt?: number): void {
    this.db.prepare(`
      UPDATE stages
      SET status = ?,
          started_at = COALESCE(?, started_at),
          finished_at = COALESCE(?, finished_at)
      WHERE job_id = ? AND idx = ?
    `).run(status, startedAt ?? null, finishedAt ?? null, jobId, idx);
  }

  // ================= LLM Calls & Metrics =================
  recordLlmCall(call: Omit<LlmCall, 'id'>): LlmCall {
    const res = this.db.prepare(`
      INSERT INTO llm_calls (job_id, task_id, model, tokens_in, tokens_out, ms, ok, error, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      call.job_id,
      call.task_id || null,
      call.model,
      call.tokens_in,
      call.tokens_out,
      call.ms,
      call.ok ? 1 : 0,
      call.error || null,
      call.ts
    );
    return { id: Number(res.lastInsertRowid), ...call };
  }

  getLlmCallsForJob(jobId: string): LlmCall[] {
    const rows = this.db.prepare('SELECT * FROM llm_calls WHERE job_id = ? ORDER BY ts ASC').all<any>(jobId);
    return rows.map((r) => ({
      id: Number(r.id),
      job_id: r.job_id,
      task_id: r.task_id,
      model: r.model,
      tokens_in: Number(r.tokens_in),
      tokens_out: Number(r.tokens_out),
      ms: Number(r.ms),
      ok: Boolean(r.ok),
      error: r.error,
      ts: Number(r.ts),
    }));
  }

  // ================= Atomic Task Claim =================
  atomicClaim(workerId: string): Task | null {
    const now = Date.now();
    return this.db.transaction(() => {
      // Ensure worker exists and is eligible to claim
      const worker = this.db.prepare('SELECT * FROM workers WHERE id = ?').get<any>(workerId);
      if (!worker || worker.status === 'DEAD' || worker.status === 'STOPPED') {
        return null;
      }

      // Best claimable task: status = 'PENDING' AND available_at <= now, matching job current_stage
      const taskRow = this.db.prepare(`
        SELECT t.* FROM tasks t
        JOIN jobs j ON t.job_id = j.id
        WHERE t.status = 'PENDING'
          AND t.available_at <= ?
          AND j.status IN ('QUEUED', 'RUNNING')
          AND t.stage_idx = j.current_stage
        ORDER BY t.priority DESC, t.created_at ASC
        LIMIT 1
      `).get<any>(now);

      if (!taskRow) {
        return null;
      }

      const nextAttempt = taskRow.attempts + 1;
      const leaseExpiresAt = now + CONFIG.LEASE_MS;

      // Update task status to LEASED
      this.db.prepare(`
        UPDATE tasks
        SET status = 'LEASED',
            worker_id = ?,
            lease_expires_at = ?,
            attempts = ?
        WHERE id = ?
      `).run(workerId, leaseExpiresAt, nextAttempt, taskRow.id);

      // Record open attempt
      this.db.prepare(`
        INSERT INTO attempts (task_id, attempt, worker_id, started_at)
        VALUES (?, ?, ?, ?)
      `).run(taskRow.id, nextAttempt, workerId, now);

      // Update worker to BUSY
      this.db.prepare(`
        UPDATE workers
        SET status = 'BUSY',
            current_task_id = ?
        WHERE id = ?
      `).run(taskRow.id, workerId);

      // Transition job from QUEUED to RUNNING if not already
      this.db.prepare(`
        UPDATE jobs
        SET status = 'RUNNING',
            started_at = CASE WHEN started_at IS NULL THEN ? ELSE started_at END
        WHERE id = ? AND status = 'QUEUED'
      `).run(now, taskRow.job_id);

      return this.getTask(taskRow.id);
    });
  }

  // ================= Task Completion with Fencing =================
  completeTask(
    taskId: string,
    workerId: string,
    attempt: number,
    result: unknown,
    tokensIn: number = 0,
    tokensOut: number = 0,
    costUsd: number = 0
  ): FencingResult {
    const now = Date.now();
    return this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get<any>(taskId);
      if (!task) {
        return { success: false, reason: 'Task not found' };
      }

      // Fencing check: task must be LEASED to this exact worker and attempt
      if (task.status !== 'LEASED' || task.worker_id !== workerId || task.attempts !== attempt) {
        return {
          success: false,
          reason: `Stale result rejected: task status is ${task.status}, worker is ${task.worker_id}, attempt is ${task.attempts}`,
        };
      }

      // Mark task as DONE
      this.db.prepare(`
        UPDATE tasks
        SET status = 'DONE',
            result = ?,
            finished_at = ?,
            tokens_in = ?,
            tokens_out = ?
        WHERE id = ?
      `).run(JSON.stringify(result), now, tokensIn, tokensOut, taskId);

      // Update attempt
      this.db.prepare(`
        UPDATE attempts
        SET ended_at = ?,
            outcome = 'DONE'
        WHERE task_id = ? AND attempt = ? AND worker_id = ?
      `).run(now, taskId, attempt, workerId);

      // Worker is now IDLE
      this.db.prepare(`
        UPDATE workers
        SET status = 'IDLE',
            current_task_id = NULL,
            tasks_done = tasks_done + 1
        WHERE id = ?
      `).run(workerId);

      // Increment job's done_tasks, tokens, and cost
      this.db.prepare(`
        UPDATE jobs
        SET done_tasks = done_tasks + 1,
            tokens_in = tokens_in + ?,
            tokens_out = tokens_out + ?,
            cost_usd = cost_usd + ?
        WHERE id = ?
      `).run(tokensIn, tokensOut, costUsd, task.job_id);

      return { success: true, jobId: task.job_id };
    });
  }

  // ================= Task Failure with Fencing =================
  failTask(taskId: string, workerId: string, attempt: number, error: string): FencingResult {
    const now = Date.now();
    return this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get<any>(taskId);
      if (!task) {
        return { success: false, reason: 'Task not found' };
      }

      // Fencing check
      if (task.status !== 'LEASED' || task.worker_id !== workerId || task.attempts !== attempt) {
        return {
          success: false,
          reason: `Stale failure report rejected: task status is ${task.status}, worker is ${task.worker_id}, attempt is ${task.attempts}`,
        };
      }

      // Update attempt outcome to FAILED
      this.db.prepare(`
        UPDATE attempts
        SET ended_at = ?,
            outcome = 'FAILED'
        WHERE task_id = ? AND attempt = ? AND worker_id = ?
      `).run(now, taskId, attempt, workerId);

      // Worker is now IDLE
      this.db.prepare(`
        UPDATE workers
        SET status = 'IDLE',
            current_task_id = NULL
        WHERE id = ?
      `).run(workerId);

      // Check retry policy
      if (task.attempts < CONFIG.MAX_ATTEMPTS) {
        const delay = calculateBackoff(task.attempts);
        const availableAt = now + delay;

        this.db.prepare(`
          UPDATE tasks
          SET status = 'PENDING',
              worker_id = NULL,
              lease_expires_at = NULL,
              available_at = ?,
              error = ?
          WHERE id = ?
        `).run(availableAt, error, taskId);

        return { success: true, dead: false, jobId: task.job_id };
      } else {
        // Exceeded MAX_ATTEMPTS -> DEAD
        this.db.prepare(`
          UPDATE tasks
          SET status = 'DEAD',
              worker_id = NULL,
              lease_expires_at = NULL,
              error = ?,
              finished_at = ?
          WHERE id = ?
        `).run(error, now, taskId);

        // Fail the entire job
        this.db.prepare(`
          UPDATE jobs
          SET status = 'FAILED',
              error = ?,
              finished_at = ?
          WHERE id = ?
        `).run(`Task ${taskId} exceeded max attempts (${CONFIG.MAX_ATTEMPTS}): ${error}`, now, task.job_id);

        return { success: true, dead: true, jobId: task.job_id };
      }
    });
  }

  // ================= Job Finalisation / Cancellation =================
  finalizeJob(jobId: string, result: unknown): boolean {
    const now = Date.now();
    return this.db.transaction(() => {
      const job = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get<any>(jobId);
      if (!job || job.status === 'DONE' || job.status === 'FAILED') {
        return false;
      }

      this.db.prepare(`
        UPDATE jobs
        SET status = 'DONE',
            result = ?,
            finished_at = ?
        WHERE id = ?
      `).run(JSON.stringify(result), now, jobId);

      return true;
    });
  }

  cancelJob(jobId: string): boolean {
    const now = Date.now();
    return this.db.transaction(() => {
      const job = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get<any>(jobId);
      if (!job || job.status === 'DONE' || job.status === 'FAILED') {
        return false;
      }

      // Mark all pending tasks as DEAD
      this.db.prepare(`
        UPDATE tasks
        SET status = 'DEAD',
            error = 'Job cancelled by user',
            finished_at = ?
        WHERE job_id = ? AND status = 'PENDING'
      `).run(now, jobId);

      // Set job to FAILED
      this.db.prepare(`
        UPDATE jobs
        SET status = 'FAILED',
            error = 'Cancelled by user',
            finished_at = ?
        WHERE id = ?
      `).run(now, jobId);

      return true;
    });
  }

  // ================= Sweeper Helpers =================
  findDeadWorkers(deadThresholdTs: number): WorkerInfo[] {
    const rows = this.db.prepare(`
      SELECT * FROM workers
      WHERE status IN ('IDLE', 'BUSY') AND last_heartbeat < ?
    `).all<any>(deadThresholdTs);
    return rows.map((r) => this.mapWorker(r));
  }

  requeueTasksForWorker(workerId: string): { requeuedCount: number; affectedJobIds: string[] } {
    const now = Date.now();
    return this.db.transaction(() => {
      const leasedTasks = this.db.prepare(`
        SELECT * FROM tasks
        WHERE worker_id = ? AND status = 'LEASED'
      `).all<any>(workerId);

      const affectedJobIds = new Set<string>();

      for (const t of leasedTasks) {
        affectedJobIds.add(t.job_id);

        // Mark open attempt outcome = LOST
        this.db.prepare(`
          UPDATE attempts
          SET ended_at = ?,
              outcome = 'LOST'
          WHERE task_id = ? AND attempt = ? AND worker_id = ?
        `).run(now, t.id, t.attempts, workerId);

        if (t.attempts < CONFIG.MAX_ATTEMPTS) {
          const delay = calculateBackoff(t.attempts);
          this.db.prepare(`
            UPDATE tasks
            SET status = 'PENDING',
                worker_id = NULL,
                lease_expires_at = NULL,
                available_at = ?
            WHERE id = ?
          `).run(now + delay, t.id);
        } else {
          this.db.prepare(`
            UPDATE tasks
            SET status = 'DEAD',
                worker_id = NULL,
                lease_expires_at = NULL,
                error = 'Worker died and max attempts exceeded',
                finished_at = ?
            WHERE id = ?
          `).run(now, t.id);

          this.db.prepare(`
            UPDATE jobs
            SET status = 'FAILED',
                error = ?,
                finished_at = ?
            WHERE id = ?
          `).run(`Task ${t.id} exceeded max attempts`, now, t.job_id);
        }
      }

      return { requeuedCount: leasedTasks.length, affectedJobIds: Array.from(affectedJobIds) };
    });
  }

  findExpiredLeasedTasks(now: number): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'LEASED' AND lease_expires_at < ?
    `).all<any>(now);
    return rows.map((r) => this.mapTask(r));
  }

  requeueExpiredTask(task: Task): { dead: boolean; jobId: string } {
    const now = Date.now();
    return this.db.transaction(() => {
      // Mark open attempt as LOST
      this.db.prepare(`
        UPDATE attempts
        SET ended_at = ?,
            outcome = 'LOST'
        WHERE task_id = ? AND attempt = ?
      `).run(now, task.id, task.attempts);

      // Reset worker if still assigned
      if (task.worker_id) {
        this.db.prepare(`
          UPDATE workers
          SET status = 'IDLE',
              current_task_id = NULL
          WHERE id = ? AND current_task_id = ?
        `).run(task.worker_id, task.id);
      }

      if (task.attempts < CONFIG.MAX_ATTEMPTS) {
        const delay = calculateBackoff(task.attempts);
        this.db.prepare(`
          UPDATE tasks
          SET status = 'PENDING',
              worker_id = NULL,
              lease_expires_at = NULL,
              available_at = ?
          WHERE id = ?
        `).run(now + delay, task.id);
        return { dead: false, jobId: task.job_id };
      } else {
        this.db.prepare(`
          UPDATE tasks
          SET status = 'DEAD',
              worker_id = NULL,
              lease_expires_at = NULL,
              error = 'Lease expired and max attempts exceeded',
              finished_at = ?
          WHERE id = ?
        `).run(now, task.id);

        this.db.prepare(`
          UPDATE jobs
          SET status = 'FAILED',
              error = ?,
              finished_at = ?
          WHERE id = ?
        `).run(`Task ${task.id} exceeded max attempts after lease timeout`, now, task.job_id);
        return { dead: true, jobId: task.job_id };
      }
    });
  }

  findUnfinalizedCompletedJobs(): Job[] {
    const rows = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'RUNNING' AND done_tasks = total_tasks
    `).all<any>();
    return rows.map((r) => this.mapJob(r));
  }

  // ================= State Snapshot =================
  getTasksSummary(): TasksSummary {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'LEASED' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'DEAD' THEN 1 ELSE 0 END) as dead
      FROM tasks
    `).get<any>();

    return {
      queued: Number(row?.queued ?? 0),
      running: Number(row?.running ?? 0),
      done: Number(row?.done ?? 0),
      dead: Number(row?.dead ?? 0),
    };
  }

  getClusterSnapshot(): ClusterStateSnapshot {
    return {
      workers: this.getAllWorkers(),
      jobs: this.getRecentJobs(50),
      tasksSummary: this.getTasksSummary(),
      config: CONFIG,
    };
  }

  // ================= Mapping Helpers =================
  private mapWorker(r: any): WorkerInfo {
    return {
      id: r.id,
      name: r.name,
      managed: Boolean(r.managed),
      pid: r.pid,
      status: r.status,
      slow_factor: Number(r.slow_factor),
      current_task_id: r.current_task_id,
      tasks_done: Number(r.tasks_done),
      last_heartbeat: Number(r.last_heartbeat),
      registered_at: Number(r.registered_at),
    };
  }

  private mapJob(r: any): Job {
    return {
      id: r.id,
      type: r.type,
      params: JSON.parse(r.params),
      priority: Number(r.priority),
      status: r.status,
      total_tasks: Number(r.total_tasks),
      done_tasks: Number(r.done_tasks),
      result: r.result ? JSON.parse(r.result) : null,
      error: r.error,
      created_at: Number(r.created_at),
      started_at: r.started_at ? Number(r.started_at) : null,
      finished_at: r.finished_at ? Number(r.finished_at) : null,
      brief: r.brief || null,
      plan_id: r.plan_id || null,
      current_stage: Number(r.current_stage || 0),
      tokens_in: Number(r.tokens_in || 0),
      tokens_out: Number(r.tokens_out || 0),
      cost_usd: Number(r.cost_usd || 0),
      budget_usd: Number(r.budget_usd || 5),
      deliverable_path: r.deliverable_path || null,
      verification: r.verification ? JSON.parse(r.verification) : null,
    };
  }

  private mapTask(r: any): Task {
    return {
      id: r.id,
      job_id: r.job_id,
      idx: Number(r.idx),
      payload: JSON.parse(r.payload),
      status: r.status,
      priority: Number(r.priority),
      attempts: Number(r.attempts),
      worker_id: r.worker_id,
      lease_expires_at: r.lease_expires_at ? Number(r.lease_expires_at) : null,
      available_at: Number(r.available_at),
      result: r.result ? JSON.parse(r.result) : null,
      error: r.error,
      created_at: Number(r.created_at),
      finished_at: r.finished_at ? Number(r.finished_at) : null,
      stage_idx: Number(r.stage_idx || 0),
      op: r.op || 'compute',
      tool: r.tool || null,
      input_ref: r.input_ref ? JSON.parse(r.input_ref) : null,
      tokens_in: Number(r.tokens_in || 0),
      tokens_out: Number(r.tokens_out || 0),
      needs_review: Boolean(r.needs_review),
    };
  }

  private mapAttempt(r: any): Attempt {
    return {
      id: Number(r.id),
      task_id: r.task_id,
      attempt: Number(r.attempt),
      worker_id: r.worker_id,
      started_at: Number(r.started_at),
      ended_at: r.ended_at ? Number(r.ended_at) : null,
      outcome: r.outcome,
    };
  }
}
