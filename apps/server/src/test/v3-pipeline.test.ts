import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createDatabaseAdapter } from '../db/adapter.js';
import { initializeDatabase } from '../db/schema.js';
import { Repository } from '../db/repo.js';
import { IntakeManager } from '../intake/intake.js';
import { generatePlan, estimatePlan } from '../ai/planner.js';
import { splitJobIntoTasks } from '../pipeline/splitter.js';
import { createReduceTasks, executeDeterministicReduce } from '../pipeline/reducer.js';
import { verifyMapStage } from '../pipeline/verifier.js';
import { createDeliverable } from '../pipeline/deliverable.js';
import { proxyLlmCall } from '../ai/proxy.js';
import type { Manifest, Plan, Task } from '@relay/shared';

describe('V3 Pipeline Architecture Suite', () => {
  const testDataDir = path.resolve(process.cwd(), 'data/test_v3');
  let db: any;
  let repo: Repository;
  let intake: IntakeManager;

  beforeEach(() => {
    process.env.RELAY_FAKE_LLM = '1';
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDataDir, { recursive: true });

    db = createDatabaseAdapter(path.join(testDataDir, 'test.db'));
    initializeDatabase(db);
    repo = new Repository(db);
    intake = new IntakeManager(testDataDir);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  // 1. Intake Test
  it('processes multiple uploaded files and builds manifest correctly', async () => {
    const jobId = 'test_job_intake';
    const uploadsDir = intake.getUploadsDir(jobId);

    const f1 = path.join(uploadsDir, 'review1.txt');
    const f2 = path.join(uploadsDir, 'data.csv');
    fs.writeFileSync(f1, 'Great service! Loved the quick latency and reliable queue.', 'utf-8');
    fs.writeFileSync(f2, 'id,name,value\n1,alpha,100\n2,beta,200\n', 'utf-8');

    const manifest = await intake.processUploads(jobId, [
      { originalName: 'review1.txt', savedPath: f1, mime: 'text/plain', bytes: 60 },
      { originalName: 'data.csv', savedPath: f2, mime: 'text/csv', bytes: 36 },
    ]);

    expect(manifest.totalFiles).toBe(2);
    expect(manifest.files.length).toBe(2);
    expect(manifest.summary).toContain('1 .txt');
    expect(manifest.summary).toContain('1 .csv');
    expect(manifest.files[1].rows).toBe(2);
  });

  // 2. Planner & Estimation Test
  it('generates valid plan and cost estimates based on manifest and brief', async () => {
    const mockManifest: Manifest = {
      files: [
        { id: 'f1', name: 'rev1.txt', mime: 'text/plain', bytes: 100, textPreview: 'Positive review', estTokens: 25 },
        { id: 'f2', name: 'rev2.txt', mime: 'text/plain', bytes: 120, textPreview: 'Negative review', estTokens: 30 },
      ],
      summary: '2 .txt',
      totalFiles: 2,
      totalBytes: 220,
      totalEstTokens: 55,
    };

    const plan = await generatePlan('Summarize customer sentiment and highlight key complaints', mockManifest);

    expect(plan.understanding).toBeDefined();
    expect(plan.strategy).toBe('per_file');
    expect(plan.map.op).toBe('llm');
    expect(plan.reduce.op).toBe('llm_synthesis');
    expect(plan.deliverable.format).toBe('md');

    const est = estimatePlan(plan, mockManifest);
    expect(est.estTasks).toBeGreaterThanOrEqual(2);
    expect(est.estCostUsd).toBeGreaterThanOrEqual(0);
  });

  // 3. Splitter Strategies Test
  it('splits tasks according to chunking strategy', () => {
    const mockManifest: Manifest = {
      files: [
        { id: 'f1', name: 'f1.txt', mime: 'text/plain', bytes: 4000, textPreview: 'A'.repeat(4000), estTokens: 1000 },
        { id: 'f2', name: 'f2.txt', mime: 'text/plain', bytes: 4000, textPreview: 'B'.repeat(4000), estTokens: 1000 },
      ],
      summary: '2 .txt',
      totalFiles: 2,
      totalBytes: 8000,
      totalEstTokens: 2000,
    };

    const perFilePlan: Plan = {
      userSummary: 'Summary',
      understanding: 'Understanding',
      strategy: 'per_file',
      chunking: { unit: 'file', target: 1 },
      map: { op: 'llm', instruction: 'Analyze', outputSchema: { type: 'object' } },
      reduce: { op: 'concat', fanIn: 20 },
      deliverable: { format: 'md', filename: 'out.md', description: 'Desc' },
      assumptions: [],
      questions: [],
      risks: [],
    };

    const tasks = splitJobIntoTasks('job_split_1', perFilePlan, mockManifest);
    expect(tasks.length).toBe(2);
    expect(tasks[0].stage_idx).toBe(0);
    expect(tasks[0].op).toBe('llm');
  });

  // 4. Staged Reduce Test with fanIn
  it('creates reduction tasks and executes deterministic operations', () => {
    const mockPriorTasks: Task[] = Array.from({ length: 25 }, (_, idx) => ({
      id: `task_${idx}`,
      job_id: 'job_test_reduce',
      idx,
      payload: {},
      status: 'DONE',
      priority: 1,
      attempts: 1,
      worker_id: 'w_1',
      lease_expires_at: null,
      available_at: 0,
      result: { summary: `Result for chunk ${idx}` },
      error: null,
      created_at: 0,
      finished_at: 0,
      stage_idx: 0,
      op: 'llm',
      tool: null,
      input_ref: null,
      tokens_in: 0,
      tokens_out: 0,
      needs_review: false,
    }));

    const synthesisPlan: Plan = {
      userSummary: 'Summary',
      understanding: 'Understanding',
      strategy: 'per_file',
      chunking: { unit: 'file', target: 1 },
      map: { op: 'llm', instruction: 'Analyze', outputSchema: { type: 'object' } },
      reduce: { op: 'llm_synthesis', instruction: 'Synthesize', fanIn: 20 },
      deliverable: { format: 'md', filename: 'out.md', description: 'Desc' },
      assumptions: [],
      questions: [],
      risks: [],
    };

    // 25 items with fanIn=20 should yield 2 batches
    const reduceTasks = createReduceTasks('job_test_reduce', synthesisPlan, 1, mockPriorTasks);
    expect(reduceTasks.length).toBe(2);
    expect(reduceTasks[0].stage_idx).toBe(1);

    // Test table_union
    const unionRes = executeDeterministicReduce('table_union', [
      [{ id: 1, name: 'Alice' }],
      [{ id: 2, name: 'Bob' }],
    ]);
    expect(unionRes.totalRows).toBe(2);

    // Test concat
    const concatRes = executeDeterministicReduce('concat', ['Part 1', 'Part 2']);
    expect(concatRes).toContain('Part 1');
    expect(concatRes).toContain('Part 2');
  });

  // 5. Verifier Test
  it('verifies map stage quality spot-check', async () => {
    const mockPlan: Plan = {
      userSummary: 'Summary',
      understanding: 'Understanding',
      strategy: 'per_file',
      chunking: { unit: 'file', target: 1 },
      map: { op: 'llm', instruction: 'Analyze', outputSchema: { type: 'object' } },
      reduce: { op: 'concat', fanIn: 20 },
      deliverable: { format: 'md', filename: 'out.md', description: 'Desc' },
      assumptions: [],
      questions: [],
      risks: [],
    };

    const mapTasks: Task[] = [
      {
        id: 't_1',
        job_id: 'job_v',
        idx: 0,
        payload: { text: 'Input content' },
        status: 'DONE',
        priority: 1,
        attempts: 1,
        worker_id: 'w1',
        lease_expires_at: null,
        available_at: 0,
        result: { summary: 'Generated summary' },
        error: null,
        created_at: 0,
        finished_at: 0,
        stage_idx: 0,
        op: 'llm',
        tool: null,
        input_ref: null,
        tokens_in: 50,
        tokens_out: 20,
        needs_review: false,
      },
    ];

    const verification = await verifyMapStage(mockPlan, mapTasks);
    expect(verification.ok).toBe(true);
    expect(verification.sample_count).toBe(1);
    expect(verification.samples[0].verified).toBe(true);
  });

  // 6. Deliverable Builder Test
  it('creates deliverables in markdown and CSV formats', async () => {
    const deliverableDir = intake.getDeliverableDir('job_deliv');
    const mdPlan: Plan = {
      userSummary: 'Customer sentiment analysis',
      understanding: 'Synthesize reviews',
      strategy: 'per_file',
      chunking: { unit: 'file', target: 1 },
      map: { op: 'llm', instruction: 'Analyze', outputSchema: {} },
      reduce: { op: 'llm_synthesis', fanIn: 20 },
      deliverable: { format: 'md', filename: 'final_report.md', description: 'Executive Synthesis' },
      assumptions: [],
      questions: [],
      risks: [],
    };

    const mdPath = await createDeliverable('job_deliv', deliverableDir, mdPlan, {
      synthesis: 'Customers are highly satisfied with reliability and speed.',
      keyFindings: ['Zero downtime during peak hours', 'Fast webhook delivery'],
    }, []);

    expect(fs.existsSync(mdPath)).toBe(true);
    const mdText = fs.readFileSync(mdPath, 'utf-8');
    expect(mdText).toContain('Executive Synthesis');
    expect(mdText).toContain('Zero downtime during peak hours');
  });

  // 7. Coordinator Proxy & Budget Cap Test
  it('enforces budget limits in LLM proxy calls', async () => {
    // Create job with low budget
    repo.createJob('job_budget_test', 'v3_pipeline', {}, 1, []);
    db.prepare('UPDATE jobs SET budget_usd = 0.05, cost_usd = 0.06 WHERE id = ?').run('job_budget_test');

    await expect(
      proxyLlmCall(
        {
          jobId: 'job_budget_test',
          messages: [{ role: 'user', content: 'Hello' }],
        },
        repo
      )
    ).rejects.toThrow('BUDGET_EXCEEDED');
  });
});
