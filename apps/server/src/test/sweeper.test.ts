import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseAdapter } from '../db/adapter.js';
import { initializeDatabase } from '../db/schema.js';
import { Repository } from '../db/repo.js';
import { SSEBroker } from '../sse/broker.js';
import { Sweeper } from '../sweeper/sweeper.js';
import { CONFIG } from '@relay/shared';

describe('Phase 5: Sweeper and Fault Recovery', () => {
  let db: ReturnType<typeof createDatabaseAdapter>;
  let repo: Repository;
  let broker: SSEBroker;
  let sweeper: Sweeper;

  beforeEach(() => {
    db = createDatabaseAdapter(':memory:');
    initializeDatabase(db);
    repo = new Repository(db);
    broker = new SSEBroker();
    sweeper = new Sweeper(repo, broker);
  });

  it('detects dead worker after heartbeat timeout and requeues leased tasks', async () => {
    // Register worker and claim task
    const worker = repo.registerWorker('worker-timeout', 'Timeout Worker', true, 5001);
    repo.createJob('job_timeout', 'primes', { limit: 100, chunks: 1 }, 1, [{ chunk: 0 }]);

    const task = repo.atomicClaim(worker.id);
    expect(task).not.toBeNull();
    expect(task?.status).toBe('LEASED');

    // Simulate passage of time beyond WORKER_DEAD_AFTER_MS
    const pastHeartbeat = Date.now() - (CONFIG.WORKER_DEAD_AFTER_MS + 1000);
    db.prepare('UPDATE workers SET last_heartbeat = ? WHERE id = ?').run(pastHeartbeat, worker.id);

    // Run sweep
    await sweeper.sweep();

    // Verify worker marked DEAD
    const updatedWorker = repo.getWorker(worker.id);
    expect(updatedWorker?.status).toBe('DEAD');

    // Verify task requeued to PENDING
    const requeuedTask = repo.getTask(task!.id);
    expect(requeuedTask?.status).toBe('PENDING');
    expect(requeuedTask?.worker_id).toBeNull();

    // Verify timeline attempt marked LOST
    const attempts = repo.getAttemptsForJob('job_timeout');
    expect(attempts.length).toBe(1);
    expect(attempts[0].outcome).toBe('LOST');
  });

  it('finalizes completed job exactly once', async () => {
    const worker = repo.registerWorker('worker-fin', 'Finisher', true, 6001);
    repo.createJob('job_finalize', 'primes', { limit: 1000, chunks: 2 }, 1, [
      { chunkIndex: 0, start: 1, end: 500, totalChunks: 2 },
      { chunkIndex: 1, start: 501, end: 1000, totalChunks: 2 },
    ]);

    // Claim and complete task 0
    const t0 = repo.atomicClaim(worker.id)!;
    repo.completeTask(t0.id, worker.id, 1, { count: 95 });

    // Claim and complete task 1
    const t1 = repo.atomicClaim(worker.id)!;
    repo.completeTask(t1.id, worker.id, 1, { count: 73 });

    // Both tasks are DONE
    const tasks = repo.getTasksForJob('job_finalize');
    expect(tasks.every((t) => t.status === 'DONE')).toBe(true);

    // Sweeper finalises job
    await sweeper.sweep();

    const finalizedJob = repo.getJob('job_finalize');
    expect(finalizedJob?.status).toBe('DONE');
    expect(finalizedJob?.result).toEqual({
      limit: 1000,
      totalPrimes: 168,
      summary: '168 primes ≤ 1,000',
    });

    // Running sweep a second time guards against double-finalizing
    await sweeper.sweep();
    const jobAfterSecondSweep = repo.getJob('job_finalize');
    expect(jobAfterSecondSweep?.status).toBe('DONE');
  });
});
