import type { FastifyReply } from 'fastify';
import type { SSEEvent, ClusterStateSnapshot } from '@relay/shared';

export class SSEBroker {
  private clients = new Set<FastifyReply>();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.pingInterval = setInterval(() => {
      this.sendKeepalive();
    }, 15000);
  }

  addClient(reply: FastifyReply, initialSnapshot: ClusterStateSnapshot): void {
    // Write SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial snapshot
    const snapshotEvent: SSEEvent = {
      type: 'snapshot',
      data: initialSnapshot,
    };
    reply.raw.write(`data: ${JSON.stringify(snapshotEvent)}\n\n`);

    this.clients.add(reply);

    reply.raw.on('close', () => {
      this.clients.delete(reply);
    });
  }

  broadcast(event: SSEEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.raw.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private sendKeepalive(): void {
    for (const client of this.clients) {
      try {
        client.raw.write(': ping\n\n');
      } catch {
        this.clients.delete(client);
      }
    }
  }

  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const client of this.clients) {
      try {
        client.raw.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }
}
