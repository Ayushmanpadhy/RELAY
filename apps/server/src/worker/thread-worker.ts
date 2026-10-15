import { parentPort } from 'node:worker_threads';
import { WORKLOADS } from '../workloads/index.js';

if (parentPort) {
  parentPort.on('message', async (msg: { taskId: string; type: string; payload: any; slowFactor?: number }) => {
    try {
      const workload = WORKLOADS[msg.type];
      if (!workload) {
        throw new Error(`Unknown workload type: ${msg.type}`);
      }

      const result = await workload.run(msg.payload, { slowFactor: msg.slowFactor ?? 1 });
      parentPort?.postMessage({ success: true, result });
    } catch (err: any) {
      parentPort?.postMessage({ success: false, error: err?.message || String(err) });
    }
  });
}
