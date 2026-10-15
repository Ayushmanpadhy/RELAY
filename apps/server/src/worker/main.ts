import { Worker as ThreadWorker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONFIG, type Task } from '@relay/shared';
import { WORKLOADS } from '../workloads/index.js';
import { getTool } from '../ai/tools/index.js';
import { executeDeterministicReduce } from '../pipeline/reducer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read CLI args and env vars
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
};

const coordinatorUrl = getArg('coordinator') || process.env.COORDINATOR_URL || 'http://127.0.0.1:4000';
const workerName = getArg('name') || process.env.WORKER_NAME || `worker-${Math.floor(Math.random() * 9000 + 1000)}`;
const isManaged = getArg('managed') === 'true' || process.env.WORKER_MANAGED === '1';

let workerId: string = getArg('id') || process.env.WORKER_ID || `w_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
let slowFactor = 1.0;
let isStopping = false;
let currentTaskId: string | null = null;
let isBusy = false;

// Heartbeat timer
let heartbeatTimer: NodeJS.Timeout | null = null;

async function postJson(url: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}: ${errorText}`);
    (err as any).status = res.status;
    (err as any).body = errorText;
    throw err;
  }
  return res.json().catch(() => ({}));
}

async function register(): Promise<void> {
  try {
    const res = await postJson(`${coordinatorUrl}/api/workers/register`, {
      id: workerId,
      name: workerName,
      managed: isManaged,
      pid: process.pid,
    });
    if (res.workerId) {
      workerId = res.workerId;
    }
    console.log(`[${workerName}] Registered successfully as ${workerId} (PID: ${process.pid})`);
  } catch (err: any) {
    console.error(`[${workerName}] Registration failed: ${err.message}. Retrying in 2s...`);
    await new Promise((r) => setTimeout(r, 2000));
    return register();
  }
}

async function sendHeartbeat(): Promise<void> {
  try {
    const res = await postJson(`${coordinatorUrl}/api/workers/${workerId}/heartbeat`, {
      currentTaskId: currentTaskId ?? undefined,
    });

    if (res.commands) {
      if (typeof res.commands.slowFactor === 'number' && res.commands.slowFactor > 0) {
        if (slowFactor !== res.commands.slowFactor) {
          console.log(`[${workerName}] Updated slowFactor to ${res.commands.slowFactor}x`);
          slowFactor = res.commands.slowFactor;
        }
      }

      if (res.commands.stop === true) {
        console.log(`[${workerName}] Received stop command from coordinator`);
        isStopping = true;
        if (!isBusy) {
          shutdown(0);
        }
      }
    }
  } catch (err: any) {
    // Silent on normal heartbeat failures, coordinator will detect dead worker if prolonged
  }
}

function executeInThread(task: Task, taskType: string, currentSlowFactor: number): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const ext = path.extname(__filename);
      const threadWorkerFile = path.join(__dirname, `thread-worker${ext}`);

      const thread = new ThreadWorker(threadWorkerFile, {
        execArgv: process.execArgv,
      });

      thread.on('message', (msg: { success: boolean; result?: any; error?: string }) => {
        thread.terminate().catch(() => {});
        if (msg.success) {
          resolve(msg.result);
        } else {
          reject(new Error(msg.error || 'Execution failed in thread'));
        }
      });

      thread.on('error', (err) => {
        thread.terminate().catch(() => {});
        // Fallback: run directly in process if thread crashes
        try {
          const workload = WORKLOADS[taskType];
          if (workload) {
            Promise.resolve(workload.run(task.payload, { slowFactor: currentSlowFactor }))
              .then(resolve)
              .catch(reject);
          } else {
            reject(err);
          }
        } catch {
          reject(err);
        }
      });

      thread.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Thread worker stopped with exit code ${code}`));
        }
      });

      thread.postMessage({
        taskId: task.id,
        type: taskType,
        payload: task.payload,
        slowFactor: currentSlowFactor,
      });
    } catch {
      // Direct in-process fallback
      try {
        const workload = WORKLOADS[taskType];
        if (workload) {
          Promise.resolve(workload.run(task.payload, { slowFactor: currentSlowFactor }))
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`Unknown workload: ${taskType}`));
        }
      } catch (e) {
        reject(e);
      }
    }
  });
}

async function claimAndExecute(): Promise<void> {
  while (!isStopping) {
    if (isBusy) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }

    try {
      // Claim task atomically
      const res = await postJson(`${coordinatorUrl}/api/workers/${workerId}/claim`, {});
      const task: Task | null = res.task;

      if (!task) {
        // No pending task, wait CLAIM_POLL_MS
        await new Promise((r) => setTimeout(r, CONFIG.CLAIM_POLL_MS));
        continue;
      }

      isBusy = true;
      currentTaskId = task.id;

      console.log(`[${workerName}] Claimed task ${task.id} (attempt #${task.attempts})`);

      // Determine job workload type from taskId or job
      const jobRes = (await fetch(`${coordinatorUrl}/api/jobs/${task.job_id}`).then((r) => r.json()).catch(() => null)) as any;
      const workloadType = (jobRes?.job?.type as string) || 'primes';

      const taskStartTime = Date.now();
      try {
        let result: any;
        let tokens_in = 0;
        let tokens_out = 0;

        if (slowFactor > 1) {
          await new Promise((r) => setTimeout(r, (slowFactor - 1) * 300));
        }

        if (task.op === 'llm') {
          const promptContent = typeof task.payload?.text === 'string'
            ? `${task.payload.instruction || 'Process this chunk'}\n\nContent:\n${task.payload.text}`
            : `${task.payload?.instruction || 'Process this task'}\n\nData:\n${JSON.stringify(task.payload)}`;

          const proxyRes = await postJson(`${coordinatorUrl}/api/llm`, {
            jobId: task.job_id,
            taskId: task.id,
            system: 'You are Relay AI Worker. Execute the task strictly according to instructions and schema.',
            messages: [{ role: 'user', content: promptContent }],
            schema: task.payload?.outputSchema,
          });

          result = proxyRes.result;
          tokens_in = proxyRes.tokens_in || 0;
          tokens_out = proxyRes.tokens_out || 0;
        } else if (task.op === 'tool') {
          if (task.tool && getTool(task.tool as any)) {
            const toolInstance = getTool(task.tool as any)!;
            result = await toolInstance.execute(task.payload);
          } else if ((task.payload as any)?.reduceOp) {
            result = executeDeterministicReduce(String((task.payload as any).reduceOp), (task.payload as any).inputs || []);
          } else {
            result = { completed: true, data: task.payload };
          }
        } else {
          // Legacy compute workload
          result = await executeInThread(task, workloadType, slowFactor);
        }

        const durationSec = ((Date.now() - taskStartTime) / 1000).toFixed(2);

        // Report task completion
        try {
          await postJson(`${coordinatorUrl}/api/tasks/${task.id}/complete`, {
            workerId,
            attempt: task.attempts,
            result,
            tokens_in,
            tokens_out,
          });
          console.log(`[${workerName}] Completed task ${task.id} in ${durationSec}s`);
        } catch (postErr: any) {
          if (postErr.status === 409) {
            console.warn(`[${workerName}] Complete rejected (409 stale): ${postErr.message}`);
          } else {
            console.error(`[${workerName}] Failed to report complete: ${postErr.message}`);
          }
        }
      } catch (execErr: any) {
        console.error(`[${workerName}] Task ${task.id} execution failed: ${execErr.message}`);
        try {
          await postJson(`${coordinatorUrl}/api/tasks/${task.id}/fail`, {
            workerId,
            attempt: task.attempts,
            error: execErr.message || 'Execution error',
          });
        } catch (failErr: any) {
          if (failErr.status === 409) {
            console.warn(`[${workerName}] Fail report rejected (409 stale): ${failErr.message}`);
          }
        }
      } finally {
        isBusy = false;
        currentTaskId = null;

        if (isStopping) {
          shutdown(0);
          return;
        }

        // Brief delay before next claim
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (err: any) {
      // Coordinator might be temporarily unreachable
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  shutdown(0);
}

function shutdown(code = 0): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  console.log(`[${workerName}] Worker exiting gracefully (code ${code})`);
  process.exit(code);
}

process.on('SIGTERM', () => {
  console.log(`[${workerName}] SIGTERM received. Gracefully stopping...`);
  isStopping = true;
  if (!isBusy) {
    shutdown(0);
  }
});

process.on('SIGINT', () => {
  console.log(`[${workerName}] SIGINT received. Gracefully stopping...`);
  isStopping = true;
  if (!isBusy) {
    shutdown(0);
  }
});

async function start(): Promise<void> {
  console.log(`[${workerName}] Starting worker process (PID: ${process.pid})...`);
  await register();

  // Start heartbeat loop
  heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL_MS);
  // Send initial heartbeat
  await sendHeartbeat();

  // Start claim loop
  await claimAndExecute();
}

start().catch((err) => {
  console.error(`[${workerName}] Fatal worker error:`, err);
  process.exit(1);
});
