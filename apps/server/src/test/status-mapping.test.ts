import { describe, it, expect } from 'vitest';
import type { WorkerStatus, TaskStatus, AttemptOutcome } from '@relay/shared';

// Status color and label mappings from design system
export function getWorkerStatusConfig(status: WorkerStatus): { label: string; color: string; isPulsing: boolean } {
  switch (status) {
    case 'BUSY':
      return { label: 'Busy', color: 'accent', isPulsing: true };
    case 'IDLE':
      return { label: 'Idle', color: 'ok', isPulsing: false };
    case 'DEAD':
      return { label: 'Dead', color: 'bad', isPulsing: false };
    case 'STOPPED':
      return { label: 'Stopped', color: 'dim', isPulsing: false };
  }
}

export function getTaskStatusConfig(status: TaskStatus): { label: string; color: string } {
  switch (status) {
    case 'PENDING':
      return { label: 'Pending', color: 'dim' };
    case 'LEASED':
      return { label: 'Leased', color: 'accent' };
    case 'DONE':
      return { label: 'Done', color: 'ok' };
    case 'DEAD':
      return { label: 'Dead', color: 'bad' };
  }
}

export function getAttemptOutcomeConfig(outcome: AttemptOutcome | null): { label: string; style: string } {
  switch (outcome) {
    case 'DONE':
      return { label: 'Done', style: 'ok' };
    case 'FAILED':
      return { label: 'Failed', style: 'warn' };
    case 'LOST':
      return { label: 'Lost', style: 'hatched-lost' };
    case null:
      return { label: 'Running', style: 'running-stripes' };
  }
}

describe('Design System: Status Mappings & SSE Reducers', () => {
  it('correctly maps worker statuses to design tokens', () => {
    expect(getWorkerStatusConfig('BUSY')).toEqual({ label: 'Busy', color: 'accent', isPulsing: true });
    expect(getWorkerStatusConfig('IDLE')).toEqual({ label: 'Idle', color: 'ok', isPulsing: false });
    expect(getWorkerStatusConfig('DEAD')).toEqual({ label: 'Dead', color: 'bad', isPulsing: false });
    expect(getWorkerStatusConfig('STOPPED')).toEqual({ label: 'Stopped', color: 'dim', isPulsing: false });
  });

  it('correctly maps task statuses to design tokens', () => {
    expect(getTaskStatusConfig('PENDING')).toEqual({ label: 'Pending', color: 'dim' });
    expect(getTaskStatusConfig('LEASED')).toEqual({ label: 'Leased', color: 'accent' });
    expect(getTaskStatusConfig('DONE')).toEqual({ label: 'Done', color: 'ok' });
    expect(getTaskStatusConfig('DEAD')).toEqual({ label: 'Dead', color: 'bad' });
  });

  it('correctly maps attempt outcomes, distinguishing hatched-lost for crashed workers', () => {
    expect(getAttemptOutcomeConfig('DONE')).toEqual({ label: 'Done', style: 'ok' });
    expect(getAttemptOutcomeConfig('FAILED')).toEqual({ label: 'Failed', style: 'warn' });
    expect(getAttemptOutcomeConfig('LOST')).toEqual({ label: 'Lost', style: 'hatched-lost' });
    expect(getAttemptOutcomeConfig(null)).toEqual({ label: 'Running', style: 'running-stripes' });
  });
});
