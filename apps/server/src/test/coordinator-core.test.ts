import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseAdapter } from '../db/adapter.js';
import { initializeDatabase } from '../db/schema.js';
import { Repository } from '../db/repo.js';
import { CONFIG, calculateBackoff } from '@relay/shared';

describe('Phase 2: Coordinator Core Semantics', () => {
  let db: ReturnType<typeof createDatabaseAdapter>;
  let repo: Repository;

  beforeEach(() => {
    db = createDatabaseAdapter(':memory:');
    initializeDatabase(db);
    repo = new Repository(db);
  });

  it('calculates exponential backoff capped at 8000ms correctly', () => {
    expect(calculateBackoff(0)).toBe(0);
    expect(calculateBackoff(1)).toBe(500);
    expect(calculateBackoff(2)).toBe(1000);
    expect(calculateBackoff(3)).toBe(2000);
    expect(calculateBackoff(4)).toBe(4000);
    expect(calculateBackoff(5)).toBe(8000);
    expect(calculateBackoff(6)).toBe(8000);
    expect(calculateBackoff(10)).toBe(8000);
  });

  it('guarantees 50 concurrent simulated claims never return the same task twice', async () => {
    // Register 50 simulated workers
    for (let i = 0; i < 50; i++) {
      repo.registerWorker(`worker-${i}`, `Worker ${i}`, true, 1000 + i);
    }

    // Create a job with 50 tasks
    const payloads = Array.from({ length: 50 }, (_, i) => ({ item: i }));
    const job = repo.createJob('job_test_concurrent', 'primes', { limit: 100, chunks: 50 }, 1, payloads);
    expect(job.status).toBe('QUEUED');
    expect(job.total_tasks).toBe(50);

    // 50 concurrent claim requests
    const claimPromises = Array.from({ length: 50 }, (_, i) => {
      return Promise.resolve().then(() => repo.atomicClaim(`worker-${i}`));
    });

    const claimedTasks = await Promise.all(claimPromises);

    const nonNullClaims = claimedTasks.filter((t) => t !== null);
    expect(nonNullClaims.length).toBe(50);

    // Assert that every claimed task ID is completely unique
    const claimedIds = nonNullClaims.map((t) => t!.id);
    const uniqueIds = new Set(claimedIds);
    expect(uniqueIds.size).toBe(50);

    // Verify all 50 tasks are now LEASED
    for (const t of nonNullClaims) {
      expect(t!.status).toBe('LEASED');
      expect(t!.attempts).toBe(1);
    }

    // Ensure job transitioned to RUNNING
    const updatedJob = repo.getJob('job_test_concurrent');
    expect(updatedJob?.status).toBe('RUNNING');
    expect(updatedJob?.started_at).not.toBeNull();
  });

  it('rejects stale task completion with fencing violation (409 logic)', () => {
    repo.registerWorker('worker-1', 'Worker 1', true, 1001);
    repo.registerWorker('worker-2', 'Worker 2', true, 1002);

    repo.createJob('job_fencing', 'primes', { limit: 100, chunks: 1 }, 1, [{ chunk: 0 }]);

    // Worker 1 claims task 0 (attempt 1)
    const taskAttempt1 = repo.atomicClaim('worker-1');
    expect(taskAttempt1).not.toBeNull();
    expect(taskAttempt1?.attempts).toBe(1);
    expect(taskAttempt1?.worker_id).toBe('worker-1');

    // Simulate worker-1 crash or timeout: worker becomes DEAD and tasks requeued
    repo.markWorkerDead('worker-1');
    repo.requeueTasksForWorker('worker-1');

    // Fast-forward available_at to now for immediate re-claim in test
    db.prepare("UPDATE tasks SET available_at = 0 WHERE job_id = 'job_fencing'").run();

    // Worker 2 claims the requeued task (attempt 2)
    const taskAttempt2 = repo.atomicClaim('worker-2');
    expect(taskAttempt2).not.toBeNull();
    expect(taskAttempt2?.attempts).toBe(2);
    expect(taskAttempt2?.worker_id).toBe('worker-2');

    // Now zombie worker-1 tries to submit completion for attempt 1
    const staleResult = repo.completeTask(taskAttempt1!.id, 'worker-1', 1, { count: 42 });
    expect(staleResult.success).toBe(false);
    expect(staleResult.reason).toContain('Stale result rejected');

    // Ensure the task is still LEASED to worker 2 and NOT done
    const currentTask = repo.getTask(taskAttempt1!.id);
    expect(currentTask?.status).toBe('LEASED');
    expect(currentTask?.worker_id).toBe('worker-2');
    expect(currentTask?.attempts).toBe(2);

    // Worker 2 completes its legitimate attempt 2
    const validResult = repo.completeTask(taskAttempt2!.id, 'worker-2', 2, { count: 25 });
    expect(validResult.success).toBe(true);

    const completedTask = repo.getTask(taskAttempt2!.id);
    expect(completedTask?.status).toBe('DONE');
    expect(completedTask?.result).toEqual({ count: 25 });
  });

  it('marks task DEAD and fails job after MAX_ATTEMPTS are exhausted', () => {
    repo.registerWorker('worker-flaky', 'Flaky Worker', true, 2001);
    repo.createJob('job_flaky', 'primes', { limit: 100, chunks: 1 }, 1, [{ chunk: 0 }]);

    let task = repo.atomicClaim('worker-flaky');
    expect(task).not.toBeNull();

    // Fail attempts 1 through 4
    for (let attempt = 1; attempt < CONFIG.MAX_ATTEMPTS; attempt++) {
      const failRes = repo.failTask(task!.id, 'worker-flaky', attempt, `Simulated error ${attempt}`);
      expect(failRes.success).toBe(true);
      expect(failRes.dead).toBe(false);

      const t = repo.getTask(task!.id);
      expect(t?.status).toBe('PENDING');
      expect(t?.attempts).toBe(attempt);

      // Fast-forward available_at so it can be reclaimed immediately
      db.prepare(`UPDATE tasks SET available_at = 0 WHERE id = ?`).run(task!.id);

      task = repo.atomicClaim('worker-flaky');
      expect(task).not.toBeNull();
      expect(task?.attempts).toBe(attempt + 1);
    }

    // Now fail attempt 5 (MAX_ATTEMPTS = 5)
    const finalFailRes = repo.failTask(task!.id, 'worker-flaky', CONFIG.MAX_ATTEMPTS, 'Final failure');
    expect(finalFailRes.success).toBe(true);
    expect(finalFailRes.dead).toBe(true);

    const deadTask = repo.getTask(task!.id);
    expect(deadTask?.status).toBe('DEAD');
    expect(deadTask?.error).toBe('Final failure');

    const failedJob = repo.getJob('job_flaky');
    expect(failedJob?.status).toBe('FAILED');
    expect(failedJob?.error).toContain(`Task ${task!.id} exceeded max attempts`);
  });
});
