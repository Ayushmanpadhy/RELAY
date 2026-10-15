import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

dotenv.config();
[
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(process.cwd(), '..', '..', '.env'),
  path.resolve(process.cwd(), 'apps', 'server', '.env'),
].forEach(envPath => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
});

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { createDatabaseAdapter } from './db/adapter.js';
import { initializeDatabase } from './db/schema.js';
import { Repository } from './db/repo.js';
import { SSEBroker } from './sse/broker.js';
import { Supervisor } from './supervisor/supervisor.js';
import { Sweeper } from './sweeper/sweeper.js';
import { registerRoutes } from './api/routes.js';

import fastifyMultipart from '@fastify/multipart';
import { IntakeManager } from './intake/intake.js';

export async function createServer(options: { dbPath?: string; port?: number; host?: string; autoSpawnWorkers?: boolean } = {}) {
  const port = options.port || Number(process.env.PORT) || 4000;
  const host = options.host || process.env.HOST || '0.0.0.0';
  const dbDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = options.dbPath ?? path.join(dbDir, 'relay.db');
  const db = createDatabaseAdapter(dbPath);
  initializeDatabase(db);

  const intakeManager = new IntakeManager(dbDir);
  const repo = new Repository(db);
  const sseBroker = new SSEBroker();
  const supervisor = new Supervisor(repo, port);
  const sweeper = new Sweeper(repo, sseBroker, intakeManager);

  const app = Fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500 MB
      files: 2000,
    },
  });

  registerRoutes(app, repo, sseBroker, supervisor, intakeManager);

  // Serve production web frontend assets if built
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidateWebPaths = [
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(__dirname, '../../../apps/web/dist'),
    path.resolve(process.cwd(), 'dist/web'),
    path.resolve(process.cwd(), 'web/dist'),
  ];
  const webDist = candidateWebPaths.find((p) => fs.existsSync(p));

  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
    });

    // SPA fallback: redirect unmatched frontend routes to index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && req.raw.url.startsWith('/api')) {
        reply.status(404).send({ error: 'Endpoint not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  const start = async () => {
    sweeper.start();

    if (options.autoSpawnWorkers !== false) {
      await supervisor.bootRecovery();
    }

    await app.listen({ port, host });
    console.log(`[Coordinator] Relay Coordinator listening at http://${host}:${port}`);
    if (webDist) {
      console.log(`[Coordinator] Serving web frontend from ${webDist}`);
    }
  };

  const stop = async () => {
    console.log('[Coordinator] Stopping sweeper and supervisor...');
    sweeper.stop();
    supervisor.shutdown();
    sseBroker.close();
    await app.close();
    db.close();
  };

  return { app, db, repo, sseBroker, supervisor, sweeper, start, stop };
}

// If executed directly, run the server
const selfPath = fileURLToPath(import.meta.url).toLowerCase();
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() : '';
const isMain = invokedPath === selfPath || invokedPath.endsWith('index.js') || invokedPath.endsWith('index.ts');

if (isMain) {
  createServer().then(({ start, stop }) => {
    start().catch((err) => {
      console.error('Fatal startup error:', err);
      process.exit(1);
    });

    const shutdown = async () => {
      console.log('\nShutting down Relay Coordinator...');
      await stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

