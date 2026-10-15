import Anthropic from '@anthropic-ai/sdk';
import {
  type LlmProxyRequestInput,
  CONFIG,
  calculateLlmCost,
} from '@relay/shared';
import type { Repository } from '../db/repo.js';

class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

const llmSemaphore = new Semaphore(CONFIG.LLM_MAX_CONCURRENCY || 8);

function generateDeterministicResponse(schema?: Record<string, unknown>, promptText: string = ''): any {
  if (!schema || !schema.properties) {
    return {
      summary: 'Task analysis completed successfully.',
      details: promptText.slice(0, 100),
    };
  }

  const props = schema.properties as Record<string, any>;
  const result: Record<string, any> = {};

  for (const [key, val] of Object.entries(props)) {
    const type = val.type || 'string';
    if (type === 'string') {
      if (key === 'sentiment') result[key] = 'positive';
      else if (key === 'category') result[key] = 'General';
      else if (key === 'summary') result[key] = 'Analyzed input content with high consistency across all operational parameters.';
      else result[key] = `Value for ${key}`;
    } else if (type === 'number' || type === 'integer') {
      result[key] = 42;
    } else if (type === 'boolean') {
      result[key] = true;
    } else if (type === 'array') {
      if (key === 'themes') result[key] = ['Quality & Value', 'Speed of Resolution', 'Ease of Use'];
      else if (key === 'keyPoints') result[key] = ['Strong performance noted', 'Minor edge cases handled', 'Recommendations implemented'];
      else result[key] = ['Item 1', 'Item 2'];
    } else if (type === 'object') {
      result[key] = { status: 'ok' };
    } else {
      result[key] = null;
    }
  }

  return result;
}

export async function proxyLlmCall(
  req: LlmProxyRequestInput,
  repo: Repository
): Promise<{ result: any; tokens_in: number; tokens_out: number; cost_usd: number; ms: number }> {
  // 1. Budget and Job check
  const job = repo.getJob(req.jobId);
  if (!job) {
    throw new Error(`Job ${req.jobId} not found`);
  }
  const currentCost = job.cost_usd ?? 0;
  const budgetLimit = job.budget_usd ?? 5;
  if (currentCost >= budgetLimit) {
    repo.recordEvent('error', `Job ${job.id} budget exceeded: $${currentCost.toFixed(4)} >= $${budgetLimit.toFixed(4)}`);
    throw new Error(`BUDGET_EXCEEDED: Job cost $${currentCost.toFixed(4)} has reached budget limit $${budgetLimit.toFixed(4)}`);
  }

  // 2. Task Lease check
  if (req.taskId) {
    const task = repo.getTask(req.taskId);
    if (!task) {
      throw new Error(`Task ${req.taskId} not found`);
    }
    if (task.status !== 'LEASED') {
      throw new Error(`Task ${req.taskId} is not leased (status: ${task.status})`);
    }
    if (task.lease_expires_at && task.lease_expires_at < Date.now()) {
      throw new Error(`Task ${req.taskId} lease expired at ${task.lease_expires_at}`);
    }
  }

  const model = req.model || CONFIG.RELAY_WORKER_MODEL || 'claude-haiku-5-5';
  const startTs = Date.now();

  await llmSemaphore.acquire();
  try {
    const useFake = process.env.RELAY_FAKE_LLM === '1' || !process.env.ANTHROPIC_API_KEY;

    if (useFake) {
      // Deterministic simulation
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 50) + 30));
      const promptStr = JSON.stringify(req.messages);
      const tokens_in = Math.ceil(promptStr.length / 4) + 50;
      const tokens_out = 180;
      const ms = Date.now() - startTs;
      const cost_usd = calculateLlmCost(model, tokens_in, tokens_out);

      const result = generateDeterministicResponse(req.schema, promptStr);

      repo.recordLlmCall({
        job_id: req.jobId,
        task_id: req.taskId,
        model: `fake-${model}`,
        tokens_in,
        tokens_out,
        ms,
        ok: true,
        ts: Date.now(),
      });

      return { result, tokens_in, tokens_out, cost_usd, ms };
    }

    // Live Anthropic Call
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const anthropicMessages: Anthropic.MessageParam[] = req.messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content.map((item) => {
          if (item.type === 'text') return { type: 'text', text: item.text };
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: item.source.media_type as any,
              data: item.source.data,
            },
          };
        }),
      };
    });

    let tools: Anthropic.Tool[] | undefined;
    let tool_choice: any | undefined;

    if (req.schema) {
      tools = [
        {
          name: 'submit_result',
          description: 'Submit the structured result for this task.',
          input_schema: req.schema as any,
        },
      ];
      tool_choice = { type: 'tool', name: 'submit_result' };
    }

    let response: Anthropic.Message | null = null;
    let lastError: any = null;

    // Retry loop for rate limits (429/529)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await anthropic.messages.create({
          model,
          max_tokens: req.maxTokens || 2000,
          system: req.system,
          messages: anthropicMessages,
          tools,
          tool_choice,
        });
        break;
      } catch (err: any) {
        lastError = err;
        if (err.status === 429 || err.status === 529) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    if (!response) {
      throw lastError || new Error('Anthropic request failed after retries');
    }

    const ms = Date.now() - startTs;
    const tokens_in = response.usage.input_tokens;
    const tokens_out = response.usage.output_tokens;
    const cost_usd = calculateLlmCost(model, tokens_in, tokens_out);

    let result: any = null;
    if (req.schema) {
      const toolUse = response.content.find(c => c.type === 'tool_use' && c.name === 'submit_result') as Anthropic.ToolUseBlock | undefined;
      result = toolUse?.input || {};
    } else {
      const textBlock = response.content.find(c => c.type === 'text') as Anthropic.TextBlock | undefined;
      result = textBlock?.text || '';
    }

    repo.recordLlmCall({
      job_id: req.jobId,
      task_id: req.taskId,
      model,
      tokens_in,
      tokens_out,
      ms,
      ok: true,
      ts: Date.now(),
    });

    return { result, tokens_in, tokens_out, cost_usd, ms };
  } catch (err: any) {
    const ms = Date.now() - startTs;
    repo.recordLlmCall({
      job_id: req.jobId,
      task_id: req.taskId,
      model,
      tokens_in: 0,
      tokens_out: 0,
      ms,
      ok: false,
      error: err.message,
      ts: Date.now(),
    });
    throw err;
  } finally {
    llmSemaphore.release();
  }
}
