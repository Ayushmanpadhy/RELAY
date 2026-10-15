import { CONFIG } from '@relay/shared';
import type { Repository } from '../db/repo.js';
import type { SSEBroker } from '../sse/broker.js';
import { WORKLOADS } from '../workloads/index.js';
import { IntakeManager } from '../intake/intake.js';
import {
  createReduceTasks,
  verifyMapStage,
  createDeliverable,
} from '../pipeline/index.js';

export class Sweeper {
  private timer: NodeJS.Timeout | null = null;
  private isSweeping = false;
  private intakeManager: IntakeManager;

  constructor(
    private repo: Repository,
    private sseBroker: SSEBroker,
    intakeManager?: IntakeManager
  ) {
    this.intakeManager = intakeManager || new IntakeManager();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        console.error('Sweeper error:', err);
      });
    }, CONFIG.SWEEP_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<void> {
    if (this.isSweeping) return;
    this.isSweeping = true;

    try {
      const now = Date.now();

      // 1. Detect dead workers
      const deadThreshold = now - CONFIG.WORKER_DEAD_AFTER_MS;
      const deadWorkers = this.repo.findDeadWorkers(deadThreshold);

      for (const worker of deadWorkers) {
        this.repo.markWorkerDead(worker.id);
        const { requeuedCount, affectedJobIds } = this.repo.requeueTasksForWorker(worker.id);

        const updatedWorker = this.repo.getWorker(worker.id);
        if (updatedWorker) {
          this.sseBroker.broadcast({ type: 'worker', data: updatedWorker });
        }

        const logMsg = `${worker.name} lost contact → ${requeuedCount} task(s) requeued`;
        const log = this.repo.recordEvent('warn', logMsg);
        this.sseBroker.broadcast({
          type: 'log',
          data: { ts: log.ts, level: log.level, message: log.message },
        });

        // Broadcast affected tasks & jobs
        for (const jobId of affectedJobIds) {
          const tasks = this.repo.getTasksForJob(jobId);
          for (const t of tasks) {
            this.sseBroker.broadcast({
              type: 'task',
              data: {
                id: t.id,
                job_id: t.job_id,
                idx: t.idx,
                status: t.status,
                worker_id: t.worker_id,
                attempts: t.attempts,
              },
            });
          }
          const job = this.repo.getJob(jobId);
          if (job) {
            this.sseBroker.broadcast({ type: 'job', data: job });
          }
        }
      }

      // 2. Expired leases safety net
      const expiredTasks = this.repo.findExpiredLeasedTasks(now);
      for (const t of expiredTasks) {
        const { dead, jobId } = this.repo.requeueExpiredTask(t);
        const logMsg = dead
          ? `Task ${t.id} lease expired and reached max attempts → marked DEAD`
          : `Task ${t.id} lease expired → requeued`;
        const log = this.repo.recordEvent(dead ? 'error' : 'warn', logMsg);
        this.sseBroker.broadcast({
          type: 'log',
          data: { ts: log.ts, level: log.level, message: log.message },
        });

        const updatedTask = this.repo.getTask(t.id);
        if (updatedTask) {
          this.sseBroker.broadcast({
            type: 'task',
            data: {
              id: updatedTask.id,
              job_id: updatedTask.job_id,
              idx: updatedTask.idx,
              status: updatedTask.status,
              worker_id: updatedTask.worker_id,
              attempts: updatedTask.attempts,
            },
          });
        }

        const job = this.repo.getJob(jobId);
        if (job) {
          this.sseBroker.broadcast({ type: 'job', data: job });
        }
      }

      // 3. V3 Pipeline Stage Progression & Job Completion
      await this.checkV3PipelineJobs();

      // 4. Legacy Job Finalisation
      const unfinalizedJobs = this.repo.findUnfinalizedCompletedJobs();
      for (const job of unfinalizedJobs) {
        if (job.type === 'v3_pipeline') {
          continue; // Handled by checkV3PipelineJobs
        }

        const workload = WORKLOADS[job.type];
        if (!workload) {
          this.repo.recordEvent('error', `Unknown workload type ${job.type} for job ${job.id}`);
          continue;
        }

        const tasks = this.repo.getTasksForJob(job.id);
        const taskResults = tasks.map((t) => t.result);
        const finalResult = workload.reduce(taskResults, job.params as any);

        const ok = this.repo.finalizeJob(job.id, finalResult);
        if (ok) {
          const finishedJob = this.repo.getJob(job.id);
          if (finishedJob) {
            const elapsed = finishedJob.started_at
              ? ((now - finishedJob.started_at) / 1000).toFixed(1)
              : '0.0';
            const log = this.repo.recordEvent(
              'info',
              `Job ${job.id} (${workload.label}) completed in ${elapsed}s`
            );
            this.sseBroker.broadcast({
              type: 'log',
              data: { ts: log.ts, level: log.level, message: log.message },
            });
            this.sseBroker.broadcast({ type: 'job', data: finishedJob });
          }
        }
      }
    } finally {
      this.isSweeping = false;
    }
  }

  private async checkV3PipelineJobs(): Promise<void> {
    const runningJobs = this.repo.getRecentJobs(20).filter(j => j.type === 'v3_pipeline' && j.status === 'RUNNING');

    for (const job of runningJobs) {
      const currentStage = job.current_stage ?? 0;
      const stageTasks = this.repo.getStageTasks(job.id, currentStage);

      if (stageTasks.length === 0) continue;

      const allStageTasksDone = stageTasks.every(t => t.status === 'DONE');
      if (!allStageTasksDone) continue;

      const planRecord = job.plan_id ? this.repo.getPlan(job.plan_id) : null;
      if (!planRecord) continue;
      const plan = planRecord.plan;

      const now = Date.now();

      if (currentStage === 0) {
        // Stage 0 (Map stage) complete
        this.repo.updateStageStatus(job.id, 0, 'DONE', undefined, now);

        // Verification spot-check
        const verification = await verifyMapStage(plan, stageTasks);
        this.repo.updateJobVerification(job.id, verification);

        if (!verification.ok) {
          const log = this.repo.recordEvent('warn', `Job ${job.id} spot-check verification detected issues (${verification.issues.length}). Flagging for review.`);
          this.sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });
        } else {
          const log = this.repo.recordEvent('info', `Job ${job.id} map stage verified (${verification.sample_count} sample(s) checked)`);
          this.sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });
        }

        // Check if reduce stage is needed
        if (plan.reduce) {
          const reduceTasks = createReduceTasks(job.id, plan, 1, stageTasks);
          this.repo.createStages(job.id, [{ idx: 1, kind: 'reduce' }]);
          this.repo.updateStageStatus(job.id, 1, 'RUNNING', now);
          this.repo.addTasks(
            job.id,
            1,
            reduceTasks.map(t => ({
              idx: t.idx,
              payload: t.payload,
              priority: 1,
              op: t.op,
              tool: (t.tool || undefined) as any,
              input_ref: t.input_ref,
            }))
          );
          this.repo.updateJobStage(job.id, 1);

          const log = this.repo.recordEvent('info', `Job ${job.id} transitioning to stage 1 (Reduce: ${plan.reduce.op}) with ${reduceTasks.length} task(s)`);
          this.sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });

          const updatedJob = this.repo.getJob(job.id);
          if (updatedJob) {
            this.sseBroker.broadcast({ type: 'job', data: updatedJob });
          }
        } else {
          // Direct deliverable creation
          const deliverableDir = this.intakeManager.getDeliverableDir(job.id);
          const finalResult = stageTasks.map(t => t.result);
          const outPath = await createDeliverable(job.id, deliverableDir, plan, finalResult, stageTasks);

          this.repo.updateJobDeliverable(job.id, outPath);
          this.repo.finalizeJob(job.id, finalResult);

          const finishedJob = this.repo.getJob(job.id);
          if (finishedJob) {
            const elapsed = finishedJob.started_at ? ((now - finishedJob.started_at) / 1000).toFixed(1) : '0.0';
            const log = this.repo.recordEvent('info', `Job ${job.id} completed deliverable in ${elapsed}s: ${plan.deliverable.filename}`);
            this.sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });
            this.sseBroker.broadcast({ type: 'job', data: finishedJob });
          }
        }
      } else {
        // Stage 1+ (Reduce stage) complete
        this.repo.updateStageStatus(job.id, currentStage, 'DONE', undefined, now);

        const fanIn = Math.max(2, plan.reduce?.fanIn || 20);
        if (stageTasks.length > 1 && plan.reduce?.op === 'llm_synthesis' && stageTasks.length > fanIn) {
          // Additional staged reduce
          const nextStage = currentStage + 1;
          const nextReduceTasks = createReduceTasks(job.id, plan, nextStage, stageTasks);
          this.repo.createStages(job.id, [{ idx: nextStage, kind: 'reduce' }]);
          this.repo.updateStageStatus(job.id, nextStage, 'RUNNING', now);
          this.repo.addTasks(
            job.id,
            nextStage,
            nextReduceTasks.map(t => ({
              idx: t.idx,
              payload: t.payload,
              priority: 1,
              op: t.op,
              tool: (t.tool || undefined) as any,
              input_ref: t.input_ref,
            }))
          );
          this.repo.updateJobStage(job.id, nextStage);

          const log = this.repo.recordEvent('info', `Job ${job.id} transitioning to staged reduce stage ${nextStage} (${nextReduceTasks.length} task(s))`);
          this.sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });

          const updatedJob = this.repo.getJob(job.id);
          if (updatedJob) {
            this.sseBroker.broadcast({ type: 'job', data: updatedJob });
          }
        } else {
          // All reduction stages finished! Build deliverable.
          const deliverableDir = this.intakeManager.getDeliverableDir(job.id);
          const finalResult = stageTasks.length === 1 ? stageTasks[0].result : stageTasks.map(t => t.result);
          const allTasks = this.repo.getTasksForJob(job.id);
          const outPath = await createDeliverable(job.id, deliverableDir, plan, finalResult, allTasks);

          this.repo.updateJobDeliverable(job.id, outPath);
          this.repo.finalizeJob(job.id, finalResult);

          const finishedJob = this.repo.getJob(job.id);
          if (finishedJob) {
            const elapsed = finishedJob.started_at ? ((now - finishedJob.started_at) / 1000).toFixed(1) : '0.0';
            const log = this.repo.recordEvent(
              'info',
              `Job ${job.id} deliverable ready: ${plan.deliverable.filename} ($${(finishedJob.cost_usd ?? 0).toFixed(4)}, ${elapsed}s)`
            );
            this.sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });
            this.sseBroker.broadcast({ type: 'job', data: finishedJob });
          }
        }
      }
    }
  }
}
