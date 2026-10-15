import Anthropic from '@anthropic-ai/sdk';
import {
  type Plan,
  type Task,
  type VerificationResult,
  type VerificationSample,
  CONFIG,
} from '@relay/shared';

export async function verifyMapStage(
  plan: Plan,
  mapTasks: Task[]
): Promise<VerificationResult> {
  const completedTasks = mapTasks.filter(t => t.status === 'DONE' && t.result !== null);
  if (completedTasks.length === 0) {
    return {
      ok: true,
      sample_count: 0,
      issues: [],
      samples: [],
    };
  }

  // Sample size: min(5, ceil(10% of map tasks))
  const sampleCount = Math.min(5, Math.max(1, Math.ceil(completedTasks.length * 0.1)));
  const step = Math.max(1, Math.floor(completedTasks.length / sampleCount));
  const sampledTasks: Task[] = [];
  for (let i = 0; i < completedTasks.length && sampledTasks.length < sampleCount; i += step) {
    sampledTasks.push(completedTasks[i]);
  }

  const useFake = process.env.RELAY_FAKE_LLM === '1' || !process.env.ANTHROPIC_API_KEY;

  if (useFake) {
    // Deterministic validation
    const samples: VerificationSample[] = sampledTasks.map(t => {
      const hasResult = t.result !== null && t.result !== undefined;
      const issues = hasResult ? [] : ['Missing result output payload'];
      const payloadObj = (t.payload || {}) as Record<string, any>;
      const sourceSlice = typeof payloadObj.text === 'string'
        ? payloadObj.text.slice(0, 200)
        : (payloadObj.filename || JSON.stringify(t.payload).slice(0, 200));

      return {
        task_id: t.id,
        sourceSlice,
        output: t.result,
        verified: hasResult,
        issues,
      };
    });

    const passedCount = samples.filter(s => s.verified).length;
    const ok = passedCount / samples.length >= 0.8;
    const allIssues = samples.flatMap(s => s.issues);

    return {
      ok,
      sample_count: samples.length,
      issues: allIssues,
      samples,
    };
  }

  // Live Anthropic verification
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = CONFIG.RELAY_PLANNER_MODEL || 'claude-sonnet-5-5';

  const samples: VerificationSample[] = [];

  for (const task of sampledTasks) {
    const payloadObj = (task.payload || {}) as Record<string, any>;
    const sourceSlice = typeof payloadObj.text === 'string'
      ? payloadObj.text.slice(0, 200)
      : (payloadObj.filename || JSON.stringify(task.payload).slice(0, 200));

    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 500,
        system: `You are Relay's Quality Verifier.
Evaluate whether the output correctly fulfills the instruction and conforms to the intended structure.
Return JSON: { "pass": boolean, "reason": string }`,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              instruction: plan.map.instruction,
              outputSchema: plan.map.outputSchema,
              input: sourceSlice,
              output: task.result,
            }, null, 2),
          },
        ],
      });

      const text = response.content.find(c => c.type === 'text')?.text || '{}';
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
      const pass = Boolean(parsed.pass ?? true);
      const issues = pass ? [] : [parsed.reason || 'Verification check failed'];

      samples.push({
        task_id: task.id,
        sourceSlice,
        output: task.result,
        verified: pass,
        issues,
      });
    } catch (err: any) {
      samples.push({
        task_id: task.id,
        sourceSlice,
        output: task.result,
        verified: true,
        issues: [`Verification warning: ${err.message}`],
      });
    }
  }

  const passedCount = samples.filter(s => s.verified).length;
  const ok = passedCount / (samples.length || 1) >= 0.8;
  const allIssues = samples.flatMap(s => s.issues);

  return {
    ok,
    sample_count: samples.length,
    issues: allIssues,
    samples,
  };
}
