import { primesWorkload } from './primes.js';
import { piWorkload } from './pi.js';
import { wordcountWorkload } from './wordcount.js';
import type { WorkloadDefinition } from './types.js';
import type { WorkloadMetadata } from '@relay/shared';

export * from './types.js';
export * from './primes.js';
export * from './pi.js';
export * from './wordcount.js';

export const WORKLOADS: Record<string, WorkloadDefinition<any, any, any, any>> = {
  primes: primesWorkload,
  pi: piWorkload,
  wordcount: wordcountWorkload,
};

export function getWorkloadMetadataList(): WorkloadMetadata[] {
  return Object.values(WORKLOADS).map((w) => ({
    type: w.type,
    label: w.label,
    description: w.description,
    presets: w.presets,
  }));
}
