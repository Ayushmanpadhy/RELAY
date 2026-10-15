import fs from 'node:fs';
import crypto from 'node:crypto';
import type { Manifest, Plan } from '@relay/shared';

export interface GeneratedTask {
  id: string;
  idx: number;
  stage_idx: number;
  op: 'llm' | 'tool';
  tool?: string | null;
  payload: Record<string, any>;
  input_ref: Record<string, any>;
}

export function splitJobIntoTasks(_jobId: string, plan: Plan, manifest: Manifest): GeneratedTask[] {
  const tasks: GeneratedTask[] = [];
  const mapOp = plan.map.op;
  const tool = plan.map.tool || null;
  const instruction = plan.map.instruction;
  const outputSchema = plan.map.outputSchema;

  function readExtractedData(extractedPath?: string): { text: string; data?: any; pages?: number; rows?: number } {
    if (!extractedPath || !fs.existsSync(extractedPath)) {
      return { text: '' };
    }
    try {
      const raw = fs.readFileSync(extractedPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { text: '' };
    }
  }

  let taskIdx = 0;

  switch (plan.strategy) {
    case 'per_file': {
      for (const file of manifest.files) {
        const extracted = readExtractedData(file.extractedPath);
        tasks.push({
          id: crypto.randomUUID(),
          idx: taskIdx++,
          stage_idx: 0,
          op: mapOp,
          tool,
          payload: {
            fileId: file.id,
            filename: file.name,
            mime: file.mime,
            bytes: file.bytes,
            extractedPath: file.extractedPath,
            text: extracted.text || file.textPreview,
            data: extracted.data,
            instruction,
            outputSchema,
          },
          input_ref: {
            fileId: file.id,
            filename: file.name,
            bytes: file.bytes,
          },
        });
      }
      break;
    }

    case 'chunk_rows': {
      const targetRows = Math.max(1, plan.chunking.target || 500);

      for (const file of manifest.files) {
        const extracted = readExtractedData(file.extractedPath);
        let allRows: any[] = [];

        if (Array.isArray(extracted.data)) {
          allRows = extracted.data;
        } else if (extracted.text) {
          // Fallback line split
          allRows = extracted.text.split(/\r?\n/).filter(l => l.trim().length > 0);
        }

        if (allRows.length === 0) {
          tasks.push({
            id: crypto.randomUUID(),
            idx: taskIdx++,
            stage_idx: 0,
            op: mapOp,
            tool,
            payload: {
              sourceFileId: file.id,
              filename: file.name,
              rows: [],
              instruction,
              outputSchema,
            },
            input_ref: { fileId: file.id, chunk: 0 },
          });
          continue;
        }

        const totalChunks = Math.ceil(allRows.length / targetRows);
        for (let c = 0; c < totalChunks; c++) {
          const slice = allRows.slice(c * targetRows, (c + 1) * targetRows);
          tasks.push({
            id: crypto.randomUUID(),
            idx: taskIdx++,
            stage_idx: 0,
            op: mapOp,
            tool,
            payload: {
              sourceFileId: file.id,
              filename: file.name,
              chunkIdx: c,
              totalChunks,
              startRow: c * targetRows,
              rowCount: slice.length,
              rows: slice,
              instruction,
              outputSchema,
            },
            input_ref: {
              fileId: file.id,
              chunk: c,
              startRow: c * targetRows,
            },
          });
        }
      }
      break;
    }

    case 'chunk_text': {
      const targetTokens = Math.max(100, plan.chunking.target || 2000);
      const targetChars = targetTokens * 4;

      for (const file of manifest.files) {
        const extracted = readExtractedData(file.extractedPath);
        const text = extracted.text || file.textPreview;

        if (text.length <= targetChars) {
          tasks.push({
            id: crypto.randomUUID(),
            idx: taskIdx++,
            stage_idx: 0,
            op: mapOp,
            tool,
            payload: {
              sourceFileId: file.id,
              filename: file.name,
              chunkIdx: 0,
              totalChunks: 1,
              text,
              instruction,
              outputSchema,
            },
            input_ref: { fileId: file.id, chunk: 0 },
          });
          continue;
        }

        // Split text by paragraphs or sentences
        const chunks: string[] = [];
        let cur = '';

        const paragraphs = text.split(/\n\s*\n/);
        for (const para of paragraphs) {
          if ((cur.length + para.length) > targetChars && cur.length > 0) {
            chunks.push(cur.trim());
            cur = '';
          }
          cur += (cur ? '\n\n' : '') + para;
        }
        if (cur.trim().length > 0) {
          chunks.push(cur.trim());
        }

        for (let c = 0; c < chunks.length; c++) {
          tasks.push({
            id: crypto.randomUUID(),
            idx: taskIdx++,
            stage_idx: 0,
            op: mapOp,
            tool,
            payload: {
              sourceFileId: file.id,
              filename: file.name,
              chunkIdx: c,
              totalChunks: chunks.length,
              text: chunks[c],
              instruction,
              outputSchema,
            },
            input_ref: { fileId: file.id, chunk: c },
          });
        }
      }
      break;
    }

    case 'page_groups': {
      const targetPages = Math.max(1, plan.chunking.target || 5);

      for (const file of manifest.files) {
        const extracted = readExtractedData(file.extractedPath);
        const pages = extracted.pages || 1;
        const totalGroups = Math.ceil(pages / targetPages);

        for (let g = 0; g < totalGroups; g++) {
          const pageStart = g * targetPages + 1;
          const pageEnd = Math.min(pages, (g + 1) * targetPages);

          tasks.push({
            id: crypto.randomUUID(),
            idx: taskIdx++,
            stage_idx: 0,
            op: mapOp,
            tool,
            payload: {
              sourceFileId: file.id,
              filename: file.name,
              pageStart,
              pageEnd,
              text: extracted.text || file.textPreview,
              instruction,
              outputSchema,
            },
            input_ref: { fileId: file.id, pageStart, pageEnd },
          });
        }
      }
      break;
    }

    case 'single':
    default: {
      tasks.push({
        id: crypto.randomUUID(),
        idx: 0,
        stage_idx: 0,
        op: mapOp,
        tool,
        payload: {
          manifestSummary: manifest.summary,
          files: manifest.files.map(f => ({ id: f.id, name: f.name, path: f.extractedPath })),
          instruction,
          outputSchema,
        },
        input_ref: { totalFiles: manifest.totalFiles },
      });
      break;
    }
  }

  // Fallback if no tasks generated
  if (tasks.length === 0) {
    tasks.push({
      id: crypto.randomUUID(),
      idx: 0,
      stage_idx: 0,
      op: mapOp,
      tool,
      payload: {
        manifestSummary: manifest.summary,
        instruction,
        outputSchema,
      },
      input_ref: { empty: true },
    });
  }

  return tasks;
}
