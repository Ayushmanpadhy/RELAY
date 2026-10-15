import { z } from 'zod';
import type { WorkloadDefinition, WorkloadContext } from './types.js';

export interface PiParams extends Record<string, unknown> {
  samples: number;
  chunks: number;
}

export interface PiPayload extends Record<string, unknown> {
  chunkIndex: number;
  samples: number;
  seed: number;
  totalChunks: number;
}

export interface PiResult {
  chunkIndex: number;
  samples: number;
  inside: number;
}

export interface PiFinal {
  pi: number;
  error: number;
  totalInside: number;
  totalSamples: number;
  summary: string;
}

function mulberry32(a: number): () => number {
  let state = a;
  return function () {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(jobId: string, chunkIndex: number): number {
  let hash = chunkIndex * 37 + 1013904223;
  for (let i = 0; i < jobId.length; i++) {
    hash = (hash << 5) - hash + jobId.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0) || 12345;
}

export const piWorkload: WorkloadDefinition<PiParams, PiPayload, PiResult, PiFinal> = {
  type: 'pi',
  label: 'Monte Carlo π',
  description: 'Estimates π using deterministic seeded pseudo-random sampling across worker nodes.',
  paramsSchema: z.object({
    samples: z.number().int().min(100).max(1_000_000_000),
    chunks: z.number().int().min(1).max(100),
  }),
  presets: {
    small: { samples: 5_000_000, chunks: 10 },
    medium: { samples: 24_000_000, chunks: 24 },
    large: { samples: 100_000_000, chunks: 48 },
  },
  split(params: PiParams, jobId: string): PiPayload[] {
    const { samples, chunks } = params;
    const samplesPerChunk = Math.ceil(samples / chunks);
    const payloads: PiPayload[] = [];

    for (let i = 0; i < chunks; i++) {
      const chunkSamples = i === chunks - 1 ? samples - samplesPerChunk * (chunks - 1) : samplesPerChunk;
      payloads.push({
        chunkIndex: i,
        samples: Math.max(0, chunkSamples),
        seed: hashSeed(jobId, i),
        totalChunks: chunks,
      });
    }
    return payloads;
  },
  run(payload: PiPayload, ctx?: WorkloadContext): PiResult {
    const slowFactor = ctx?.slowFactor ?? 1;
    const baseDelayMs = 450;
    const targetMs = baseDelayMs * slowFactor;
    const startMs = Date.now();

    const prng = mulberry32(payload.seed);
    let inside = 0;
    const { samples } = payload;

    for (let i = 0; i < samples; i++) {
      const x = prng();
      const y = prng();
      if (x * x + y * y <= 1.0) {
        inside++;
      }
    }

    // Pacing for visibility and fault injection demos
    const elapsed = Date.now() - startMs;
    if (elapsed < targetMs) {
      const endWait = Date.now() + (targetMs - elapsed);
      while (Date.now() < endWait) {
        // Spin inside worker thread
      }
    }

    return {
      chunkIndex: payload.chunkIndex,
      samples: payload.samples,
      inside,
    };
  },
  reduce(results: PiResult[], _params: PiParams): PiFinal {
    const totalInside = results.reduce((sum, r) => sum + r.inside, 0);
    const totalSamples = results.reduce((sum, r) => sum + r.samples, 0);
    const pi = totalSamples > 0 ? (4 * totalInside) / totalSamples : 0;
    const error = Math.abs(pi - Math.PI);

    return {
      pi,
      error,
      totalInside,
      totalSamples,
      summary: `π ≈ ${pi.toFixed(6)} (error: ${error.toFixed(6)})`,
    };
  },
};
