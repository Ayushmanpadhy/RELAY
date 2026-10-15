import { createServer } from '../apps/server/src/index.js';

async function runChaosTest() {
  console.log('====================================================');
  console.log('   STARTING RELAY DISTRIBUTED CHAOS TEST            ');
  console.log('====================================================');

  const testPort = 4050 + Math.floor(Math.random() * 50);
  console.log(`[Chaos] Initializing isolated coordinator server on port ${testPort}...`);

  const { repo, supervisor, start, stop } = await createServer({
    port: testPort,
    dbPath: `:memory:`,
    autoSpawnWorkers: true,
  });

  await start();

  try {
    // 1. Wait for workers to register and become IDLE
    console.log('[Chaos] Waiting for managed workers to register...');
    let workers = repo.getAllWorkers();
    const waitStart = Date.now();
    while (workers.filter((w) => w.status === 'IDLE').length < 3) {
      if (Date.now() - waitStart > 15000) {
        throw new Error(`Timed out waiting for 3 workers to register. Found: ${workers.length}`);
      }
      await new Promise((r) => setTimeout(r, 200));
      workers = repo.getAllWorkers();
    }

    console.log(`[Chaos] Detected ${workers.length} registered live workers:`);
    workers.forEach((w) => console.log(`   - ${w.name} (PID: ${w.pid}, Status: ${w.status})`));

    // 2. Submit a Medium primes job: 10,000,000 across 24 tasks
    console.log('\n[Chaos] Submitting Medium Primes job (10M limit, 24 chunks)...');
    const submitRes = await fetch(`http://localhost:${testPort}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'primes',
        params: { limit: 10_000_000, chunks: 24 },
        priority: 1,
      }),
    });

    if (!submitRes.ok) {
      throw new Error(`Job submission failed: ${await submitRes.text()}`);
    }

    const job = await submitRes.json();
    console.log(`[Chaos] Job created: ${job.id} (${job.total_tasks} tasks)`);

    // 3. Wait until tasks are actively running
    console.log('[Chaos] Waiting for tasks to be claimed by workers...');
    let runningTasks = 0;
    while (runningTasks === 0) {
      await new Promise((r) => setTimeout(r, 200));
      const tasks = repo.getTasksForJob(job.id);
      runningTasks = tasks.filter((t) => t.status === 'LEASED').length;
    }
    console.log(`[Chaos] Tasks in flight! Currently ${runningTasks} tasks leased.`);

    // 4. Inject hard crash: pick a worker that is actively BUSY with an in-flight task
    console.log('[Chaos] Waiting for a worker to be actively BUSY with a leased task...');
    let victim: any = null;
    const findBusyStart = Date.now();
    while (!victim) {
      if (Date.now() - findBusyStart > 10000) {
        throw new Error('Timed out waiting for a busy worker');
      }
      await new Promise((r) => setTimeout(r, 80));
      const busyWorkers = repo.getAllWorkers().filter((w) => w.status === 'BUSY' && w.current_task_id);
      if (busyWorkers.length > 0) {
        victim = busyWorkers[0];
      }
    }

    console.log(`\n🔥 [Chaos] INJECTING CHAOS: Hard killing busy worker ${victim.name} (PID ${victim.pid}) working on task ${victim.current_task_id}!`);
    supervisor.killWorker(victim.id);

    // 5. Monitor execution and recovery
    console.log('[Chaos] Monitoring system recovery and job progress...');
    let finishedJob = repo.getJob(job.id);
    const jobStartTime = Date.now();

    while (finishedJob && finishedJob.status !== 'DONE' && finishedJob.status !== 'FAILED') {
      if (Date.now() - jobStartTime > 45000) {
        throw new Error('Timed out waiting for job to finish under chaos conditions');
      }
      await new Promise((r) => setTimeout(r, 400));
      finishedJob = repo.getJob(job.id);

      const tasks = repo.getTasksForJob(job.id);
      const doneCount = tasks.filter((t) => t.status === 'DONE').length;
      const leasedCount = tasks.filter((t) => t.status === 'LEASED').length;
      const pendingCount = tasks.filter((t) => t.status === 'PENDING').length;
      process.stdout.write(`\r[Chaos] Progress: ${doneCount}/${job.total_tasks} done | ${leasedCount} leased | ${pendingCount} pending   `);
    }

    console.log('\n');

    // 6. Assertions per Section 4 Phase 5:
    // (a) job reaches DONE
    console.log(`[Chaos] Assertion (a): Job status is DONE...`);
    if (!finishedJob || finishedJob.status !== 'DONE') {
      throw new Error(`Assertion failed: Job did not reach DONE. Status: ${finishedJob?.status}, Error: ${finishedJob?.error}`);
    }
    console.log('   ✓ Passed: Job status === DONE');

    // (b) result equals the known-correct value (664,579)
    console.log(`[Chaos] Assertion (b): Result equals known-correct value (664,579 primes)...`);
    const finalResult = finishedJob.result as any;
    if (finalResult?.totalPrimes !== 664579) {
      throw new Error(`Assertion failed: Result is incorrect. Expected 664579, got ${finalResult?.totalPrimes}`);
    }
    console.log(`   ✓ Passed: Computed result is exactly ${finalResult.totalPrimes}`);

    // (c) at least one LOST attempt exists
    console.log(`[Chaos] Assertion (c): At least one LOST attempt exists due to killed worker...`);
    const attempts = repo.getAttemptsForJob(job.id);
    const lostAttempts = attempts.filter((a) => a.outcome === 'LOST');
    if (lostAttempts.length === 0) {
      throw new Error('Assertion failed: No LOST attempts recorded in database');
    }
    console.log(`   ✓ Passed: Found ${lostAttempts.length} LOST attempt(s) recorded in timeline`);

    // (d) no task was completed twice
    console.log(`[Chaos] Assertion (d): No task completed twice...`);
    const doneAttempts = attempts.filter((a) => a.outcome === 'DONE');
    const doneTaskIds = new Set(doneAttempts.map((a) => a.task_id));
    if (doneTaskIds.size !== job.total_tasks || doneAttempts.length !== job.total_tasks) {
      throw new Error(`Assertion failed: Expected exactly ${job.total_tasks} DONE attempts, got ${doneAttempts.length}`);
    }
    console.log(`   ✓ Passed: Exactly ${job.total_tasks} unique tasks marked DONE without duplicate executions`);

    console.log('\n====================================================');
    console.log('   🎉 CHAOS TEST PASSED ALL ASSERTIONS!             ');
    console.log('====================================================\n');
  } finally {
    console.log('[Chaos] Tearing down coordinator and workers...');
    await stop();
  }
}

runChaosTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ CHAOS TEST FAILED:', err);
    process.exit(1);
  });
