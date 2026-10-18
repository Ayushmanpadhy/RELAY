import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  RegisterWorkerSchema,
  HeartbeatSchema,
  CompleteTaskSchema,
  FailTaskSchema,
  CreateJobSchema,
  ScaleClusterSchema,
  SlowWorkerSchema,
  ApprovePlanSchema,
  SubmitAnswersSchema,
  ReplanSchema,
  LlmProxyRequestSchema,
  CONFIG,
  type TaskSummary,
  type Manifest,
} from '@relay/shared';
import type { Repository } from '../db/repo.js';
import type { SSEBroker } from '../sse/broker.js';
import type { Supervisor } from '../supervisor/supervisor.js';
import { WORKLOADS, getWorkloadMetadataList } from '../workloads/index.js';
import { IntakeManager } from '../intake/intake.js';
import { generatePlan, estimatePlan } from '../ai/planner.js';
import { proxyLlmCall } from '../ai/proxy.js';
import { splitJobIntoTasks } from '../pipeline/splitter.js';

export function registerRoutes(
  app: FastifyInstance,
  repo: Repository,
  sseBroker: SSEBroker,
  supervisor: Supervisor,
  intakeManagerInstance?: IntakeManager
): void {
  const intakeManager = intakeManagerInstance || new IntakeManager();

  // ================= State Snapshot =================
  app.get('/api/state', async () => {
    return repo.getClusterSnapshot();
  });

  // ================= Server-Sent Events =================
  app.get('/api/stream', (_req: FastifyRequest, reply: FastifyReply) => {
    const snapshot = repo.getClusterSnapshot();
    sseBroker.addClient(reply, snapshot);
  });

  // ================= Workloads Metadata =================
  app.get('/api/workloads', async () => {
    return getWorkloadMetadataList();
  });

  // ================= Events / Logs =================
  app.get('/api/events/recent', async () => {
    return repo.getRecentEvents(200);
  });

  // ================= Worker Protocol =================
  app.post('/api/workers/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any;
    const parse = RegisterWorkerSchema.safeParse(body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.format() });
    }

    const id = body.id || `w_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const name = parse.data.name;
    const managed = Boolean(body.managed);
    const pid = typeof body.pid === 'number' ? body.pid : null;

    const worker = repo.registerWorker(id, name, managed, pid);
    const log = repo.recordEvent('info', `Worker ${name} registered (ID: ${id})`);

    sseBroker.broadcast({ type: 'worker', data: worker });
    sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });

    return { workerId: worker.id, config: repo.getClusterSnapshot().config };
  });

  app.post('/api/workers/:id/heartbeat', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const body = req.body as any;
    const parse = HeartbeatSchema.safeParse(body);
    const currentTaskId = parse.success ? parse.data.currentTaskId : undefined;

    const res = repo.updateHeartbeat(id, currentTaskId);
    if (!res) {
      return reply.status(404).send({ error: 'Worker not found' });
    }

    const worker = repo.getWorker(id);
    if (worker) {
      sseBroker.broadcast({ type: 'worker', data: worker });
    }

    return { commands: res };
  });

  app.post('/api/workers/:id/claim', async (req: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
    const { id } = req.params;
    const task = repo.atomicClaim(id);

    if (task) {
      const worker = repo.getWorker(id);
      if (worker) {
        sseBroker.broadcast({ type: 'worker', data: worker });
      }

      const taskSummary: TaskSummary = {
        id: task.id,
        job_id: task.job_id,
        idx: task.idx,
        status: task.status,
        worker_id: task.worker_id,
        attempts: task.attempts,
      };
      sseBroker.broadcast({ type: 'task', data: taskSummary });

      const job = repo.getJob(task.job_id);
      if (job) {
        sseBroker.broadcast({ type: 'job', data: job });
      }

      const attempts = repo.getAttemptsForJob(task.job_id);
      const latestAttempt = attempts.find((a) => a.task_id === task.id && a.attempt === task.attempts);
      if (latestAttempt) {
        sseBroker.broadcast({ type: 'attempt', data: latestAttempt });
      }

      const log = repo.recordEvent(
        'info',
        `Worker ${worker?.name ?? id} claimed task ${task.id} (stage ${task.stage_idx}, op: ${task.op})`
      );
      sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });
    }

    return { task };
  });

  app.post('/api/tasks/:id/complete', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const parse = CompleteTaskSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.format() });
    }

    const { workerId, attempt, result, tokens_in, tokens_out } = parse.data;
    const fencing = repo.completeTask(id, workerId, attempt, result, tokens_in, tokens_out);

    if (!fencing.success) {
      const log = repo.recordEvent('warn', `Stale result from ${workerId} rejected: ${fencing.reason}`);
      sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });
      return reply.status(409).send({ error: fencing.reason });
    }

    const worker = repo.getWorker(workerId);
    if (worker) {
      sseBroker.broadcast({ type: 'worker', data: worker });
    }

    const task = repo.getTask(id);
    if (task) {
      const taskSummary: TaskSummary = {
        id: task.id,
        job_id: task.job_id,
        idx: task.idx,
        status: task.status,
        worker_id: task.worker_id,
        attempts: task.attempts,
      };
      sseBroker.broadcast({ type: 'task', data: taskSummary });
    }

    if (fencing.jobId) {
      const job = repo.getJob(fencing.jobId);
      if (job) {
        sseBroker.broadcast({ type: 'job', data: job });
      }
      const attempts = repo.getAttemptsForJob(fencing.jobId);
      const currentAttempt = attempts.find((a) => a.task_id === id && a.attempt === attempt);
      if (currentAttempt) {
        sseBroker.broadcast({ type: 'attempt', data: currentAttempt });
      }
    }

    return { ok: true };
  });

  app.post('/api/tasks/:id/fail', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const parse = FailTaskSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.format() });
    }

    const { workerId, attempt, error } = parse.data;
    const fencing = repo.failTask(id, workerId, attempt, error);

    if (!fencing.success) {
      const log = repo.recordEvent('warn', `Stale failure report from ${workerId} rejected: ${fencing.reason}`);
      sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });
      return reply.status(409).send({ error: fencing.reason });
    }

    const worker = repo.getWorker(workerId);
    if (worker) {
      sseBroker.broadcast({ type: 'worker', data: worker });
    }

    const task = repo.getTask(id);
    if (task) {
      const taskSummary: TaskSummary = {
        id: task.id,
        job_id: task.job_id,
        idx: task.idx,
        status: task.status,
        worker_id: task.worker_id,
        attempts: task.attempts,
      };
      sseBroker.broadcast({ type: 'task', data: taskSummary });
    }

    if (fencing.dead) {
      const log = repo.recordEvent('error', `Task ${id} exhausted retries → DEAD`);
      sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });
    } else {
      const log = repo.recordEvent('warn', `Task ${id} attempt #${attempt} failed → scheduled retry with backoff`);
      sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });
    }

    if (fencing.jobId) {
      const job = repo.getJob(fencing.jobId);
      if (job) {
        sseBroker.broadcast({ type: 'job', data: job });
      }
      const attempts = repo.getAttemptsForJob(fencing.jobId);
      const currentAttempt = attempts.find((a) => a.task_id === id && a.attempt === attempt);
      if (currentAttempt) {
        sseBroker.broadcast({ type: 'attempt', data: currentAttempt });
      }
    }

    return { ok: true, dead: fencing.dead };
  });

  // ================= Job Management =================
  app.post('/api/jobs', async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = CreateJobSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.format() });
    }

    const { type, params, priority } = parse.data;
    const workload = WORKLOADS[type];
    if (!workload) {
      return reply.status(400).send({ error: `Unknown workload type: ${type}` });
    }

    const validParams = workload.paramsSchema.safeParse(params);
    if (!validParams.success) {
      return reply.status(400).send({ error: validParams.error.format() });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const taskPayloads = workload.split(validParams.data, jobId);

    const job = repo.createJob(jobId, type, validParams.data, priority, taskPayloads);
    const log = repo.recordEvent(
      'info',
      `Submitted job ${jobId} (${workload.label}): partitioned into ${taskPayloads.length} tasks`
    );

    sseBroker.broadcast({ type: 'job', data: job });
    sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });

    return reply.status(201).send(job);
  });

  app.get('/api/jobs/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const job = repo.getJob(id);
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    const tasks = repo.getTasksForJob(id);
    const attempts = repo.getAttemptsForJob(id);
    const stages = repo.getStagesForJob(id);
    const plan = job.plan_id ? repo.getPlan(job.plan_id) : null;

    return { job, tasks, attempts, stages, plan };
  });

  app.post('/api/jobs/:id/cancel', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const ok = repo.cancelJob(id);
    if (!ok) {
      return reply.status(400).send({ error: 'Job could not be cancelled' });
    }

    const job = repo.getJob(id);
    if (job) {
      sseBroker.broadcast({ type: 'job', data: job });
    }

    const log = repo.recordEvent('warn', `Job ${id} cancelled by user`);
    sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });

    return { ok: true, job };
  });

  // ================= V3: Requests / Pipeline Endpoints =================

  // 1. POST /api/requests (Upload + Brief -> Intake + Plan Draft)
  app.post('/api/requests', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const uploadsDir = intakeManager.getUploadsDir(jobId);

      const uploadedFiles: Array<{ originalName: string; savedPath: string; mime: string; bytes: number }> = [];
      let brief = '';

      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('multipart/form-data')) {
        const parts = (req as any).parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            const safeName = path.basename(part.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
            const dest = path.join(uploadsDir, safeName);
            await pipeline(part.file, fs.createWriteStream(dest));
            const stat = fs.statSync(dest);
            uploadedFiles.push({
              originalName: part.filename,
              savedPath: dest,
              mime: part.mimetype || 'application/octet-stream',
              bytes: stat.size,
            });
          } else {
            if (part.fieldname === 'brief') {
              brief = String(part.value || '');
            }
          }
        }
      } else if (contentType.includes('application/json')) {
        const body = req.body as any;
        brief = body.brief || '';
        if (Array.isArray(body.files)) {
          for (let i = 0; i < body.files.length; i++) {
            const f = body.files[i];
            const filename = f.name || `file_${i}.txt`;
            const dest = path.join(uploadsDir, filename);
            const content = f.content || '';
            fs.writeFileSync(dest, content, 'utf-8');
            const stat = fs.statSync(dest);
            uploadedFiles.push({
              originalName: filename,
              savedPath: dest,
              mime: f.mime || 'text/plain',
              bytes: stat.size,
            });
          }
        }
      }

      if (!brief) {
        brief = 'Process uploaded files';
      }

      // Process intake
      const manifest: Manifest = await intakeManager.processUploads(jobId, uploadedFiles);

      // AI Planner
      const plan = await generatePlan(brief, manifest);
      const estimation = estimatePlan(plan, manifest);

      // 1. Create preliminary job record (satisfies plans.job_id foreign key)
      const job = repo.createJob(jobId, 'v3_pipeline', { brief, manifest }, 1, [], brief, planId);

      // 2. Persist plan record
      const planRecord = repo.createPlanRecord({
        id: planId,
        job_id: jobId,
        brief,
        manifest,
        plan,
        status: 'DRAFT',
        est_cost: estimation.estCostUsd,
        est_tasks: estimation.estTasks,
        created_at: Date.now(),
      });

      const log = repo.recordEvent(
        'info',
        `Created request ${jobId}: ${manifest.summary}. Estimated ${estimation.estTasks} tasks ($${estimation.estCostUsd.toFixed(4)})`
      );
      sseBroker.broadcast({ type: 'job', data: job });
      sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });

      return reply.status(201).send({
        jobId,
        planId,
        manifest,
        plan,
        estCost: estimation.estCostUsd,
        estTasks: estimation.estTasks,
        planRecord,
      });
    } catch (err: any) {
      console.error('[POST /api/requests error]:', err);
      return reply.status(500).send({
        error: err.message || 'Internal error while processing request and generating plan',
      });
    }
  });

  // 2. GET /api/requests/:id
  app.get('/api/requests/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    let job = repo.getJob(id);
    let planRecord = job?.plan_id ? repo.getPlan(job.plan_id) : repo.getPlan(id);

    if (!job && planRecord) {
      job = repo.getJob(planRecord.job_id);
    }

    if (!planRecord && !job) {
      return reply.status(404).send({ error: 'Request not found' });
    }

    const stages = job ? repo.getStagesForJob(job.id) : [];

    return {
      job,
      plan: planRecord?.plan,
      manifest: planRecord?.manifest,
      planRecord,
      stages,
    };
  });

  // 3. POST /api/requests/:id/answers
  app.post('/api/requests/:id/answers', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const parse = SubmitAnswersSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.format() });
    }

    let job = repo.getJob(id);
    let planRecord = job?.plan_id ? repo.getPlan(job.plan_id) : repo.getPlan(id);
    if (!planRecord) {
      return reply.status(404).send({ error: 'Plan record not found' });
    }

    const newPlan = await generatePlan(planRecord.brief, planRecord.manifest, parse.data.answers);
    const est = estimatePlan(newPlan, planRecord.manifest);

    repo.updatePlan(planRecord.id, newPlan, 'DRAFT', est.estCostUsd, est.estTasks);

    const log = repo.recordEvent('info', `Plan updated with user answers for job ${planRecord.job_id}`);
    sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });

    return {
      plan: newPlan,
      estCost: est.estCostUsd,
      estTasks: est.estTasks,
    };
  });

  // 4. POST /api/requests/:id/replan
  app.post('/api/requests/:id/replan', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const parse = ReplanSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.format() });
    }

    let job = repo.getJob(id);
    let planRecord = job?.plan_id ? repo.getPlan(job.plan_id) : repo.getPlan(id);
    if (!planRecord) {
      return reply.status(404).send({ error: 'Plan record not found' });
    }

    const newPlan = await generatePlan(parse.data.brief, planRecord.manifest);
    const est = estimatePlan(newPlan, planRecord.manifest);

    repo.updatePlan(planRecord.id, newPlan, 'DRAFT', est.estCostUsd, est.estTasks);

    const log = repo.recordEvent('info', `Re-planned request ${planRecord.job_id} with updated brief`);
    sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });

    return {
      plan: newPlan,
      estCost: est.estCostUsd,
      estTasks: est.estTasks,
    };
  });

  // 5. POST /api/requests/:id/approve
  app.post('/api/requests/:id/approve', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const parse = ApprovePlanSchema.safeParse(req.body || {});
    const confirmCost = parse.success ? parse.data.confirmCost : false;

    let job = repo.getJob(id);
    let planRecord = job?.plan_id ? repo.getPlan(job.plan_id) : repo.getPlan(id);
    if (!planRecord || !job) {
      return reply.status(404).send({ error: 'Job or plan not found' });
    }

    if (planRecord.est_cost > CONFIG.MAX_JOB_COST_USD && !confirmCost) {
      return reply.status(400).send({
        error: `Cost estimate ($${planRecord.est_cost.toFixed(2)}) exceeds standard limit ($${CONFIG.MAX_JOB_COST_USD.toFixed(2)}). Explicit confirmation required.`,
      });
    }

    // Mark plan approved
    repo.updatePlan(planRecord.id, planRecord.plan, 'APPROVED');

    // Split work into tasks
    const generatedTasks = splitJobIntoTasks(job.id, planRecord.plan, planRecord.manifest);

    // Create stage 0 (Map stage)
    repo.createStages(job.id, [{ idx: 0, kind: 'map' }]);
    repo.updateStageStatus(job.id, 0, 'RUNNING', Date.now());

    // Insert stage 0 tasks
    repo.addTasks(
      job.id,
      0,
      generatedTasks.map((t) => ({
        idx: t.idx,
        payload: t.payload,
        priority: 1,
        op: t.op,
        tool: t.tool as any,
        input_ref: t.input_ref,
      }))
    );

    // Update job status to RUNNING
    repo.updateJobStage(job.id, 0, 'RUNNING');

    const updatedJob = repo.getJob(job.id);
    const log = repo.recordEvent(
      'info',
      `Approved plan for ${job.id}: Launched Stage 0 (Map: ${generatedTasks.length} tasks)`
    );

    if (updatedJob) {
      sseBroker.broadcast({ type: 'job', data: updatedJob });
    }
    sseBroker.broadcast({ type: 'log', data: { ts: log.ts, level: log.level, message: log.message } });

    return {
      ok: true,
      jobId: job.id,
      totalTasks: generatedTasks.length,
    };
  });

  // 6. POST /api/llm (Coordinator LLM Proxy)
  app.post('/api/llm', async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = LlmProxyRequestSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.format() });
    }

    try {
      const response = await proxyLlmCall(parse.data, repo);
      return response;
    } catch (err: any) {
      if (err.message && err.message.includes('BUDGET_EXCEEDED')) {
        return reply.status(402).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message || 'LLM proxy error' });
    }
  });

  // 7. GET /api/jobs/:id/deliverable
  app.get('/api/jobs/:id/deliverable', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const job = repo.getJob(id);
    if (!job || !job.deliverable_path || !fs.existsSync(job.deliverable_path)) {
      return reply.status(404).send({ error: 'Deliverable not ready or file missing.' });
    }

    const filename = path.basename(job.deliverable_path);
    const ext = path.extname(filename).toLowerCase();

    const mimeTypes: Record<string, string> = {
      '.md': 'text/markdown; charset=utf-8',
      '.csv': 'text/csv; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.zip': 'application/zip',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    const mime = mimeTypes[ext] || 'application/octet-stream';
    const stream = fs.createReadStream(job.deliverable_path);

    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Type', mime);
    return reply.send(stream);
  });

  // 8. GET /api/jobs/:id/samples (Source / Output Preview Pairs for Verification UI)
  app.get('/api/jobs/:id/samples', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const job = repo.getJob(id);
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    const tasks = repo.getTasksForJob(id);
    const mapTasks = tasks.filter(t => t.stage_idx === 0);
    const samples = mapTasks.slice(0, 8).map(t => {
      let previewInput = '';
      if (typeof t.payload?.text === 'string') {
        previewInput = t.payload.text.slice(0, 300);
      } else if (t.payload?.filename) {
        previewInput = `File: ${t.payload.filename} (${t.payload.bytes || 0} bytes)`;
      } else {
        previewInput = JSON.stringify(t.payload).slice(0, 300);
      }

      return {
        taskId: t.id,
        taskIdx: t.idx,
        status: t.status,
        inputPreview: previewInput,
        outputResult: t.result,
        needsReview: t.needs_review,
        attempts: t.attempts,
        workerId: t.worker_id,
      };
    });

    return {
      jobId: id,
      verification: job.verification,
      samples,
    };
  });

  // 9. GET /api/jobs/:id/stages
  app.get('/api/jobs/:id/stages', async (req: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
    const { id } = req.params;
    const stages = repo.getStagesForJob(id);
    return { stages };
  });

  // ================= Supervisor Endpoints =================
  app.post('/api/cluster/spawn', async () => {
    const child = supervisor.spawnWorker();
    return { ok: true, pid: child.pid };
  });

  app.post('/api/cluster/scale', async (req: FastifyRequest, reply: FastifyReply) => {
    const parse = ScaleClusterSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.format() });
    }
    const res = await supervisor.scale(parse.data.count);
    return res;
  });

  app.post('/api/workers/:id/kill', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const ok = supervisor.killWorker(id);
    if (!ok) {
      return reply.status(404).send({ error: 'Worker not found' });
    }
    return { ok: true };
  });

  app.post('/api/workers/:id/slow', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const parse = SlowWorkerSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.format() });
    }
    const ok = supervisor.setSlow(id, parse.data.factor);
    if (!ok) {
      return reply.status(404).send({ error: 'Worker not found' });
    }
    return { ok: true };
  });

  app.post('/api/workers/:id/stop', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const ok = supervisor.stopWorker(id);
    if (!ok) {
      return reply.status(404).send({ error: 'Worker not found' });
    }
    return { ok: true };
  });
}
