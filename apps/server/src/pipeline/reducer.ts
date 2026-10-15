import crypto from 'node:crypto';
import type { Plan, Task } from '@relay/shared';
import type { GeneratedTask } from './splitter.js';

export function createReduceTasks(
  _jobId: string,
  plan: Plan,
  stageIdx: number,
  priorTasks: Task[]
): GeneratedTask[] {
  const fanIn = Math.max(2, plan.reduce.fanIn || 20);
  const reduceOp = plan.reduce.op;
  const instruction = plan.reduce.instruction || 'Synthesize and merge all input data into a unified output.';

  // Extract results from prior tasks in index order
  const sortedPriorTasks = [...priorTasks].sort((a, b) => a.idx - b.idx);
  const results = sortedPriorTasks.map(t => ({
    taskId: t.id,
    taskIdx: t.idx,
    result: t.result,
  }));

  if (reduceOp === 'llm_synthesis') {
    // If results > fanIn, split into batches
    const batches: Array<typeof results> = [];
    for (let i = 0; i < results.length; i += fanIn) {
      batches.push(results.slice(i, i + fanIn));
    }

    const tasks: GeneratedTask[] = [];
    for (let b = 0; b < batches.length; b++) {
      tasks.push({
        id: crypto.randomUUID(),
        idx: b,
        stage_idx: stageIdx,
        op: 'llm',
        payload: {
          reduceOp: 'llm_synthesis',
          batchIdx: b,
          totalBatches: batches.length,
          instruction,
          inputs: batches[b].map(item => item.result),
          outputSchema: {
            type: 'object',
            properties: {
              synthesis: { type: 'string' },
              keyFindings: { type: 'array', items: { type: 'string' } },
            },
            required: ['synthesis'],
          },
        },
        input_ref: {
          priorStage: stageIdx - 1,
          batchIdx: b,
          count: batches[b].length,
        },
      });
    }
    return tasks;
  }

  // Deterministic reduction operations: concat, merge_json, table_union
  // Usually single batch unless huge, but even if multiple, we can run 1 task
  return [
    {
      id: crypto.randomUUID(),
      idx: 0,
      stage_idx: stageIdx,
      op: 'tool',
      payload: {
        reduceOp,
        instruction,
        inputs: results.map(item => item.result),
      },
      input_ref: {
        priorStage: stageIdx - 1,
        count: results.length,
      },
    },
  ];
}

export function executeDeterministicReduce(op: string, inputs: any[]): any {
  switch (op) {
    case 'concat': {
      if (inputs.length === 0) return '';
      if (typeof inputs[0] === 'string') {
        return inputs.join('\n\n---\n\n');
      }
      if (Array.isArray(inputs[0])) {
        return inputs.flat();
      }
      // If items are objects with summary or text
      const parts = inputs.map(item => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (item.summary) return item.summary;
        if (item.translatedText) return item.translatedText;
        return JSON.stringify(item, null, 2);
      });
      return parts.join('\n\n---\n\n');
    }

    case 'table_union': {
      const allRows: any[] = [];
      for (const item of inputs) {
        if (!item) continue;
        if (Array.isArray(item)) {
          allRows.push(...item);
        } else if (item.cleanedRows && Array.isArray(item.cleanedRows)) {
          allRows.push(...item.cleanedRows);
        } else if (item.rows && Array.isArray(item.rows)) {
          allRows.push(...item.rows);
        } else if (typeof item === 'object') {
          allRows.push(item);
        }
      }
      return { rows: allRows, totalRows: allRows.length };
    }

    case 'merge_json': {
      if (inputs.length === 0) return {};
      const merged: Record<string, any> = {};
      for (const item of inputs) {
        if (!item || typeof item !== 'object') continue;
        for (const [key, val] of Object.entries(item)) {
          if (merged[key] === undefined) {
            merged[key] = val;
          } else if (Array.isArray(merged[key]) && Array.isArray(val)) {
            merged[key] = [...merged[key], ...val];
          } else if (typeof merged[key] === 'object' && typeof val === 'object' && val !== null) {
            merged[key] = { ...merged[key], ...val };
          } else {
            merged[key] = val;
          }
        }
      }
      return merged;
    }

    default:
      return inputs;
  }
}
