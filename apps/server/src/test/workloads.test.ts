import { describe, it, expect } from 'vitest';
import { primesWorkload } from '../workloads/primes.js';
import { piWorkload } from '../workloads/pi.js';
import { wordcountWorkload } from '../workloads/wordcount.js';

describe('Phase 3: Workloads and Determinism', () => {
  it('correctly calculates primes(10_000_000) === 664,579 via split/run/reduce', () => {
    const params = { limit: 10_000_000, chunks: 8 };
    const payloads = primesWorkload.split(params, 'job_primes_10m');
    expect(payloads.length).toBe(8);

    // Run sequentially with slowFactor = 0 (bypassing delay in unit test)
    const results = payloads.map((p) => primesWorkload.run(p, { slowFactor: 0 }) as any);
    const final = primesWorkload.reduce(results, params);

    expect(final.totalPrimes).toBe(664579);
    expect(final.summary).toContain('664,579 primes ≤ 10,000,000');
  });

  it('verifies primes workload yields identical output when run twice on the same payload', () => {
    const payload = { chunkIndex: 2, start: 1000, end: 50000, totalChunks: 5 };
    const run1 = primesWorkload.run(payload, { slowFactor: 0 });
    const run2 = primesWorkload.run(payload, { slowFactor: 0 });

    expect(run1).toEqual(run2);
  });

  it('verifies Monte Carlo pi workload determinism and split/run/reduce equivalence', () => {
    const params = { samples: 500_000, chunks: 5 };
    const payloads = piWorkload.split(params, 'job_pi_test');
    expect(payloads.length).toBe(5);

    // Running the same payload twice with same seed yields identical result
    const run1 = piWorkload.run(payloads[0], { slowFactor: 0 });
    const run2 = piWorkload.run(payloads[0], { slowFactor: 0 });
    expect(run1).toEqual(run2);

    // Run all chunks and reduce
    const results = payloads.map((p) => piWorkload.run(p, { slowFactor: 0 }) as any);
    const final = piWorkload.reduce(results, params);

    expect(final.totalSamples).toBe(500_000);
    expect(final.pi).toBeGreaterThan(3.10);
    expect(final.pi).toBeLessThan(3.18);
    expect(final.error).toBeLessThan(0.05);
  });

  it('verifies wordcount workload determinism and mini MapReduce equivalence', () => {
    const params = { generateWords: 50_000, chunks: 4 };
    const payloads = wordcountWorkload.split(params, 'job_wc_test');
    expect(payloads.length).toBe(4);

    // Running the same payload twice yields identical counts
    const run1 = wordcountWorkload.run(payloads[0], { slowFactor: 0 });
    const run2 = wordcountWorkload.run(payloads[0], { slowFactor: 0 });
    expect(run1).toEqual(run2);

    // Run all chunks and reduce
    const results = payloads.map((p) => wordcountWorkload.run(p, { slowFactor: 0 }) as any);
    const final = wordcountWorkload.reduce(results, params);

    expect(final.totalWords).toBe(50_000);
    expect(final.uniqueWords).toBeGreaterThan(0);
    expect(final.topWords.length).toBeLessThanOrEqual(15);
    expect(final.topWords[0].count).toBeGreaterThan(0);
  });
});
