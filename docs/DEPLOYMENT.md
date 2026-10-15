# Deployment Guide: Relay Distributed Task Platform

This guide covers production deployment options for **Relay**. The system is packaged as a unified monorepo where the Fastify Coordinator serves both the API endpoints, Server-Sent Events (SSE), and the compiled React SPA web application, while managing child worker processes.

---

## 1. Architecture Overview in Production

```
              Clients (Browser / API)
                        │
                        ▼
       ┌──────────────────────────────────┐
       │     Fastify Coordinator Server   │  (Port 4000 / $PORT)
       │  • Static Web Files (/ & assets) │
       │  • REST API (/api/*)             │
       │  • SSE Broadcast (/api/stream)   │
       │  • Sweeper / Lease Watchdog      │
       │  • SQLite Storage (data/relay.db)│
       └────────────────┬─────────────────┘
                        │ HTTP / Heartbeats (127.0.0.1)
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
   ┌───────────┐  ┌───────────┐  ┌───────────┐
   │ Worker #1 │  │ Worker #2 │  │ Worker #3 │ (child_process.fork)
   │  Thread   │  │  Thread   │  │  Thread   │
   └───────────┘  └───────────┘  └───────────┘
```

- **Single Service**: A single container or process runs the Coordinator, auto-spawns managed workers, and serves the frontend.
- **Worker Isolation**: Each worker runs as a separate OS process, with compute executed inside `worker_threads` so heartbeats are never blocked by CPU work.
- **Storage**: SQLite database in WAL mode stored at `$DATA_DIR/relay.db` (default: `./data/relay.db`).

---

## 2. Docker Deployment (Recommended)

### Using Docker Compose
```bash
# Build and run container with persistent volume
docker compose up -d --build

# View real-time cluster logs
docker compose logs -f

# Stop container
docker compose down
```
Access the application at `http://localhost:4000`.

### Using Docker CLI
```bash
# Build production image
docker build -t relay:latest .

# Run with persistent volume for database
docker run -d \
  --name relay \
  -p 4000:4000 \
  -e PORT=4000 \
  -e HOST=0.0.0.0 \
  -v relay_data:/data \
  relay:latest
```

---

## 3. Bare Metal / VPS Deployment (PM2 / Node.js)

### Prerequisites
- Node.js 20+ installed
- npm 9+

### Build and Start
```bash
# 1. Install dependencies
npm ci

# 2. Build all workspaces (shared, server, web)
npm run build

# 3. Start production coordinator
npm start
```

### Running with PM2
```bash
npm install -g pm2

# Start coordinator with PM2
pm2 start apps/server/dist/index.js --name "relay-coordinator" --env production

# Save process list for system reboot
pm2 save
pm2 startup
```

---

## 4. Cloud Platform Deployments

### Railway / Render
1. Connect your Git repository.
2. Set **Build Command**:
   ```bash
   npm run build
   ```
3. Set **Start Command**:
   ```bash
   npm start
   ```
4. Set Environment Variables:
   - `PORT`: Automatically set by Railway/Render
   - `HOST`: `0.0.0.0`
   - `NODE_ENV`: `production`
5. Optional: Mount a persistent volume at `/data` and set `DATA_DIR=/data`.

### Fly.io
Deploy directly using the provided `Dockerfile`:
```bash
fly launch
fly volumes create relay_data --size 1
fly deploy
```

---

## 5. Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Port for the HTTP server and API |
| `HOST` | `0.0.0.0` | Host interface to bind |
| `NODE_ENV` | `production` | Environment mode (`production` or `development`) |
| `DATA_DIR` | `./data` | Directory where SQLite `relay.db` is stored |
| `COORDINATOR_URL` | `http://127.0.0.1:$PORT` | Internal URL workers use to register and heartbeat |

---

## 6. Health Checks & Verification

- **Cluster Snapshot**: `GET /api/state`
- **Workloads Metadata**: `GET /api/workloads`
- **Live Event Stream**: `GET /api/stream`
- **Frontend SPA**: `GET /` and `GET /app`
