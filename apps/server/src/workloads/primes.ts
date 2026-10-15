import { z } from 'zod';
import type { WorkloadDefinition, WorkloadContext } from './types.js';

export interface PrimesParams extends Record<string, unknown> {
  limit: number;
  chunks: number;
}

export interface PrimesPayload extends Record<string, unknown> {
  chunkIndex: number;
  start: number;
  end: number;
  totalChunks: number;
}

export interface PrimesResult {
  chunkIndex: number;
  start: number;
  end: number;
  count: number;
}

export interface PrimesFinal {
  limit: number;
  totalPrimes: number;
  summary: string;
}

function getBasePrimes(limit: number): number[] {
  if (limit < 2) return [];
  const isPrime = new Uint8Array(limit + 1);
  isPrime.fill(1);
  isPrime[0] = 0;
  isPrime[1] = 0;

  for (let p = 2; p * p <= limit; p++) {
    if (isPrime[p]) {
      for (let i = p * p; i <= limit; i += p) {
        isPrime[i] = 0;
      }
    }
  }

  const primes: number[] = [];
  for (let i = 2; i <= limit; i++) {
    if (isPrime[i]) primes.push(i);
  }
  return primes;
}

function countPrimesSegmented(start: number, end: number): number {
  if (end < 2 || start > end) return 0;
  const actualStart = Math.max(2, start);
  const sqrtEnd = Math.floor(Math.sqrt(end));
  const basePrimes = getBasePrimes(sqrtEnd);

  const rangeSize = end - actualStart + 1;
  const isPrime = new Uint8Array(rangeSize);
  isPrime.fill(1);

  for (const p of basePrimes) {
    let firstMultiple = Math.floor(actualStart / p) * p;
    if (firstMultiple < actualStart) firstMultiple += p;
    if (firstMultiple < p * p) firstMultiple = p * p;

    for (let j = firstMultiple; j <= end; j += p) {
      isPrime[j - actualStart] = 0;
    }
  }

  let count = 0;
  for (let i = 0; i < rangeSize; i++) {
    if (isPrime[i]) count++;
  }
  return count;
}

export const primesWorkload: WorkloadDefinition<PrimesParams, PrimesPayload, PrimesResult, PrimesFinal> = {
  type: 'primes',
  label: 'Prime Counter',
  description: 'Counts prime numbers across partitioned numerical intervals using segmented sieve.',
  paramsSchema: z.object({
    limit: z.number().int().min(10).max(100_000_000),
    chunks: z.number().int().min(1).max(100),
  }),
  presets: {
    small: { limit: 1_000_000, chunks: 10 },
    medium: { limit: 10_000_000, chunks: 24 },
    large: { limit: 25_000_000, chunks: 48 },
  },
  split(params: PrimesParams): PrimesPayload[] {
    const { limit, chunks } = params;
    const chunkSize = Math.ceil(limit / chunks);
    const payloads: PrimesPayload[] = [];

    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize + 1;
      const end = Math.min((i + 1) * chunkSize, limit);
      if (start <= end) {
        payloads.push({
          chunkIndex: i,
          start,
          end,
          totalChunks: chunks,
        });
      }
    }
    return payloads;
  },
  run(payload: PrimesPayload, ctx?: WorkloadContext): PrimesResult {
    const slowFactor = ctx?.slowFactor ?? 1;
    // Calibrated baseline duration so tasks are visible and interactable (~450ms for Medium chunks)
    const baseDelayMs = 450;
    const targetMs = baseDelayMs * slowFactor;
    const startMs = Date.now();

    const count = countPrimesSegmented(payload.start, payload.end);

    // Apply smooth calibrated pacing according to slowFactor
    const elapsed = Date.now() - startMs;
    if (elapsed < targetMs) {
      const waitTime = targetMs - elapsed;
      const endWait = Date.now() + waitTime;
      while (Date.now() < endWait) {
        // Spin in worker thread without blocking coordinator or worker main heartbeat
      }
    }

    return {
      chunkIndex: payload.chunkIndex,
      start: payload.start,
      end: payload.end,
      count,
    };
  },
  reduce(results: PrimesResult[], params: PrimesParams): PrimesFinal {
    const totalPrimes = results.reduce((sum, r) => sum + r.count, 0);
    return {
      limit: params.limit,
      totalPrimes,
      summary: `${totalPrimes.toLocaleString('en-US')} primes ≤ ${params.limit.toLocaleString('en-US')}`,
    };
  },
};
