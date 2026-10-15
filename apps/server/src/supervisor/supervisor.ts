import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONFIG } from '@relay/shared';
import type { Repository } from '../db/repo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Supervisor {
  private managedProcesses = new Map<number, ChildProcess>(); // pid -> process
  private workerCounter = 0;
  private coordinatorPort: number;

  constructor(
    private repo: Repository,
    coordinatorPort: number = 4000
  ) {
    this.coordinatorPort = coordinatorPort;
  }

  async bootRecovery(): Promise<void> {
    this.repo.recordEvent('info', 'Coordinator booting: performing crash recovery on stale state...');

    // Mark all previously active workers DEAD
    const allWorkers = this.repo.getAllWorkers();
    for (const w of allWorkers) {
      if (w.status === 'IDLE' || w.status === 'BUSY') {
        this.repo.markWorkerDead(w.id);
        const { requeuedCount } = this.repo.requeueTasksForWorker(w.id);
        if (requeuedCount > 0) {
          this.repo.recordEvent(
            'warn',
            `Boot recovery: worker ${w.name} marked DEAD → ${requeuedCount} leased task(s) requeued`
          );
        }
      }
    }

    // Spawn DEFAULT_WORKERS
    this.repo.recordEvent('info', `Spawning ${CONFIG.DEFAULT_WORKERS} initial managed workers...`);
    for (let i = 0; i < CONFIG.DEFAULT_WORKERS; i++) {
      this.spawnWorker();
      // stagger slightly to avoid race on initial registration
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  spawnWorker(customName?: string): ChildProcess {
    this.workerCounter++;
    const name = customName || `worker-${this.workerCounter}`;
    const ext = path.extname(__filename);
    const workerScript = path.resolve(__dirname, `../worker/main${ext}`);

    const child = fork(workerScript, [], {
      env: {
        ...process.env,
        WORKER_NAME: name,
        WORKER_MANAGED: '1',
        COORDINATOR_URL: process.env.COORDINATOR_URL || `http://127.0.0.1:${this.coordinatorPort}`,
      },
      execArgv: process.execArgv,
      stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
    });

    if (child.pid) {
      this.managedProcesses.set(child.pid, child);
    }

    child.on('exit', (code, signal) => {
      if (child.pid) {
        this.managedProcesses.delete(child.pid);
      }
      this.repo.recordEvent('info', `Managed worker ${name} exited (code: ${code}, signal: ${signal})`);
    });

    this.repo.recordEvent('info', `Spawned managed worker process ${name} (PID: ${child.pid})`);
    return child;
  }

  async scale(targetCount: number): Promise<{ liveCount: number; target: number }> {
    const clampedTarget = Math.max(0, Math.min(CONFIG.MAX_MANAGED_WORKERS, targetCount));
    const activeWorkers = this.repo.getAllWorkers().filter(
      (w) => w.managed && (w.status === 'IDLE' || w.status === 'BUSY')
    );

    const currentCount = activeWorkers.length;

    if (currentCount < clampedTarget) {
      const toSpawn = clampedTarget - currentCount;
      this.repo.recordEvent('info', `Scaling cluster: spawning ${toSpawn} worker(s)...`);
      for (let i = 0; i < toSpawn; i++) {
        this.spawnWorker();
        await new Promise((r) => setTimeout(r, 80));
      }
    } else if (currentCount > clampedTarget) {
      const toStop = currentCount - clampedTarget;
      this.repo.recordEvent('info', `Scaling cluster: gracefully stopping ${toStop} worker(s)...`);
      // Pick idle workers first, then busy
      const sorted = [...activeWorkers].sort((a, b) => {
        if (a.status === 'IDLE' && b.status !== 'IDLE') return -1;
        if (a.status !== 'IDLE' && b.status === 'IDLE') return 1;
        return 0;
      });

      for (let i = 0; i < toStop; i++) {
        const w = sorted[i];
        this.repo.setWorkerStop(w.id);
        this.repo.recordEvent('info', `Sent graceful stop to worker ${w.name}`);
      }
    }

    return { liveCount: currentCount, target: clampedTarget };
  }

  killWorker(workerId: string): boolean {
    const worker = this.repo.getWorker(workerId);
    if (!worker) return false;

    this.repo.recordEvent('warn', `Simulating hard crash: killing worker ${worker.name} (PID: ${worker.pid})`);

    if (worker.pid) {
      const child = this.managedProcesses.get(worker.pid);
      if (child) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        this.managedProcesses.delete(worker.pid);
      } else {
        try {
          process.kill(worker.pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }

    return true;
  }

  setSlow(workerId: string, factor: number): boolean {
    const ok = this.repo.setWorkerSlow(workerId, factor);
    if (ok) {
      this.repo.recordEvent('info', `Worker ${workerId} configured slow factor = ${factor}x`);
    }
    return ok;
  }

  stopWorker(workerId: string): boolean {
    const ok = this.repo.setWorkerStop(workerId);
    if (ok) {
      this.repo.recordEvent('info', `Worker ${workerId} requested to stop gracefully`);
    }
    return ok;
  }

  shutdown(): void {
    for (const [, child] of this.managedProcesses) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    this.managedProcesses.clear();
  }
}
