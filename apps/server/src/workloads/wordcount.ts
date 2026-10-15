import { z } from 'zod';
import type { WorkloadDefinition, WorkloadContext } from './types.js';

export interface WordcountParams extends Record<string, unknown> {
  text?: string;
  generateWords?: number;
  chunks: number;
}

export interface WordcountPayload extends Record<string, unknown> {
  chunkIndex: number;
  words: string[];
  totalChunks: number;
}

export interface WordcountResult {
  chunkIndex: number;
  counts: Record<string, number>;
  totalWords: number;
}

export interface WordcountFinal {
  totalWords: number;
  uniqueWords: number;
  topWords: Array<{ word: string; count: number }>;
  summary: string;
}

const VOCABULARY = [
  'distributed', 'system', 'worker', 'coordinator', 'task',
  'failure', 'heartbeat', 'lease', 'fencing', 'requeue',
  'process', 'memory', 'network', 'latency', 'concurrency',
  'state', 'consensus', 'stream', 'event', 'sqlite',
  'node', 'fastify', 'parallel', 'scale', 'cluster',
  'pipeline', 'throughput', 'batch', 'deterministic', 'protocol',
  'thread', 'message', 'retry', 'backoff', 'recovery',
  'atomic', 'partition', 'snapshot', 'synchronous', 'asynchronous',
  'client', 'server', 'buffer', 'channel', 'queue',
  'pool', 'monitor', 'supervisor', 'benchmark', 'speedup',
];

function mulberry32(a: number): () => number {
  let state = a;
  return function () {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateDeterministicCorpus(wordCount: number, seed: number): string[] {
  const prng = mulberry32(seed);
  const words: string[] = new Array(wordCount);
  const vocabLen = VOCABULARY.length;
  for (let i = 0; i < wordCount; i++) {
    const idx = Math.floor(prng() * vocabLen);
    words[i] = VOCABULARY[idx];
  }
  return words;
}

export const wordcountWorkload: WorkloadDefinition<WordcountParams, WordcountPayload, WordcountResult, WordcountFinal> = {
  type: 'wordcount',
  label: 'Mini MapReduce (Word Count)',
  description: 'MapReduce tokenization, counting, and aggregation over large text corpora.',
  paramsSchema: z.object({
    text: z.string().optional(),
    generateWords: z.number().int().min(100).max(5_000_000).optional(),
    chunks: z.number().int().min(1).max(100),
  }),
  presets: {
    small: { generateWords: 50_000, chunks: 10 },
    medium: { generateWords: 200_000, chunks: 24 },
    large: { generateWords: 600_000, chunks: 48 },
  },
  split(params: WordcountParams, jobId: string): WordcountPayload[] {
    const { chunks, text, generateWords } = params;
    let allWords: string[] = [];

    if (text && text.trim().length > 0) {
      allWords = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 0);
    } else {
      const count = generateWords ?? 200_000;
      let seed = 42;
      for (let i = 0; i < jobId.length; i++) {
        seed = (seed * 31 + jobId.charCodeAt(i)) | 0;
      }
      allWords = generateDeterministicCorpus(count, seed >>> 0);
    }

    const wordsPerChunk = Math.ceil(allWords.length / chunks);
    const payloads: WordcountPayload[] = [];

    for (let i = 0; i < chunks; i++) {
      const start = i * wordsPerChunk;
      const end = Math.min((i + 1) * wordsPerChunk, allWords.length);
      const chunkWords = allWords.slice(start, end);
      payloads.push({
        chunkIndex: i,
        words: chunkWords,
        totalChunks: chunks,
      });
    }
    return payloads;
  },
  run(payload: WordcountPayload, ctx?: WorkloadContext): WordcountResult {
    const slowFactor = ctx?.slowFactor ?? 1;
    const baseDelayMs = 450;
    const targetMs = baseDelayMs * slowFactor;
    const startMs = Date.now();

    const counts: Record<string, number> = {};
    let total = 0;

    for (const w of payload.words) {
      const word = w.toLowerCase().trim();
      if (!word) continue;
      counts[word] = (counts[word] || 0) + 1;
      total++;
    }

    const elapsed = Date.now() - startMs;
    if (elapsed < targetMs) {
      const endWait = Date.now() + (targetMs - elapsed);
      while (Date.now() < endWait) {
        // Spin inside worker thread
      }
    }

    return {
      chunkIndex: payload.chunkIndex,
      counts,
      totalWords: total,
    };
  },
  reduce(results: WordcountResult[], _params: WordcountParams): WordcountFinal {
    const merged: Record<string, number> = {};
    let totalWords = 0;

    for (const r of results) {
      totalWords += r.totalWords;
      for (const [word, cnt] of Object.entries(r.counts)) {
        merged[word] = (merged[word] || 0) + cnt;
      }
    }

    const sorted = Object.entries(merged)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count);

    const topWords = sorted.slice(0, 15);
    const uniqueWords = Object.keys(merged).length;

    return {
      totalWords,
      uniqueWords,
      topWords,
      summary: `${totalWords.toLocaleString('en-US')} words processed (${uniqueWords.toLocaleString('en-US')} unique)`,
    };
  },
};
