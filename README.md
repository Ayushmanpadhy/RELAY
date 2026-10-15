# Relay — Distributed Task Platform (V3)

[![Build Status](https://img.shields.io/badge/build-passing-4ADE9A?style=flat-square)]()
[![Tests](https://img.shields.io/badge/tests-20%20passed-4ADE9A?style=flat-square)]()
[![Chaos Test](https://img.shields.io/badge/chaos--test-verified-7C8CFF?style=flat-square)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-7C8CFF?style=flat-square)]()

**Relay** is an open, distributed task execution platform. In V3, Relay introduces the end-to-end autonomous pipeline: **"Upload anything, tell us what you want, we get it done."**

Users upload raw files (ZIP, PDF, DOCX, CSV, Excel, TXT, images) and write their intent in plain English. An AI **planner** constructs a structured distributed execution plan; users approve cost estimates; the coordinator **splits** the work into parallel tasks; independent **worker processes** execute safe tools and LLM proxy calls with leases, heartbeats, and fencing; results are **merged** in staged reductions; an AI **verifier** spot-checks quality; and the final deliverable is compiled for instant download.

---

## Key Distributed Computing Principles Implemented

1. **Work Partitioning (Map/Reduce):** Deterministic partitioning strategies (`per_file`, `chunk_rows`, `chunk_text`, `page_groups`, and legacy numerical compute).
2. **Pull-Based Load Balancing:** Workers poll for tasks when idle; fast workers process more chunks without coordinator push bottlenecks.
3. **Atomic Task Claims:** Single serialized SQLite transaction guarantees race-free claims—no two workers can ever claim the same task (`stage_idx = current_stage`).
4. **Failure Detection & Heartbeats:** Workers send heartbeats every 1000ms. If a worker goes silent for > 4000ms, it is marked `DEAD`.
5. **Lease Renewals & Lost Attempt Tracking:** Claimed tasks are leased for 8000ms. Active workers continuously renew leases. When a worker dies, its uncommitted task attempt is marked **LOST** (rendered as diagonal hatched red bars) and requeued.
6. **Retries with Exponential Backoff:** Tasks are retried with capped exponential backoff: $t = \min(8000, 500 \cdot 2^{\text{attempt}-1})$. After 5 failed attempts, tasks transition to `DEAD` and cleanly fail the job.
7. **Fencing Tokens (Zombie Protection):** All result completions require matching `(workerId, attempt)`. If a partitioned or delayed worker submits late, the coordinator responds with **HTTP 409 Conflict** and rejects the stale result.
8. **Staged Tree Reduction:** Large-scale reductions group prior outputs in batches with `fanIn` (default 20), executing tree reductions across worker processes.
9. **Zero-Trust LLM Proxy & Budget Enforcement:** Workers never hold external API keys. All LLM calls pass through the coordinator proxy with concurrency semaphore, rate-limit backoff, and hard budget limits (`BUDGET_EXCEEDED`).
10. **Offline Deterministic Mode (`RELAY_FAKE_LLM=1`):** Complete end-to-end pipeline executes without requiring an API key or incurring any costs.

---

## Tech Stack

- **Monorepo:** npm workspaces (`@relay/shared`, `@relay/server`, `@relay/web`)
- **Backend & Coordinator:** Node.js 20+, TypeScript (Strict), Fastify, `@fastify/multipart`, SQLite with WAL mode (`better-sqlite3` / `node:sqlite`), Zod validation, Vitest
- **AI & File Engines:** `@anthropic-ai/sdk`, `pdf-parse`, `mammoth`, `xlsx`, `papaparse`, `jimp`, `docx`, `exceljs`, `adm-zip`
- **Telemetry & Updates:** Server-Sent Events (SSE) with periodic keepalive pings
- **Workers:** Standalone OS child processes via `child_process.fork`, communicating strictly over HTTP, running safe tools and proxy calls
- **Frontend:** React 18, Vite, TypeScript, React Router, Tailwind CSS, Framer Motion, Recharts, Three.js, Zustand
- **Typography:** Inter (UI) & JetBrains Mono (metrics, logs, IDs) via `@fontsource`

---

## Project Structure

```
relay/
├── packages/
│   └── shared/                 # Config, domain types, pricing table, zod schemas, SSE events
├── apps/
│   ├── server/                 # Fastify coordinator, SQLite repo, supervisor, sweeper, worker
│   │   ├── src/
│   │   │   ├── ai/             # AI Planner, Estimator, Coordinator LLM Proxy, Tool Registry
│   │   │   ├── intake/         # Zip-slip safe extractor (PDF, DOCX, CSV/XLSX, Text, Images)
│   │   │   ├── pipeline/       # Splitter, Staged Reducer, Verifier, Deliverable Builder
│   │   │   ├── api/            # REST endpoints, SSE stream, multipart file handler
│   │   │   ├── db/             # SQLite adapter, schema DDL, repository
│   │   │   ├── sse/            # SSE broker with broadcast & keepalive
│   │   │   ├── supervisor/     # Process supervisor (spawn, scale, kill, boot recovery)
│   │   │   ├── sweeper/        # Sweeper loop (failure recovery, stage transitions, finalization)
│   │   │   ├── worker/         # Worker process CLI & tool/LLM runner
│   │   │   └── test/           # Vitest integration test suites (20 tests)
│   └── web/                    # React 18 frontend
│       ├── src/
│       │   ├── api/            # Frontend API client
│       │   ├── components/     # TopStrip, WorkerCard, Timeline, NewJobModal, EventLogDrawer
│       │   ├── pages/          # Landing (3D Hero), Dashboard, JobDetail (Stage Stepper), Benchmark
│       │   └── store/          # Zustand store hydrated by SSE stream
├── samples/                    # Pre-generated realistic datasets for instant testing
│   ├── reviews/                # 40 customer review files (sentiment & complaints)
│   ├── data/                   # 5,000-row messy leads CSV (whitespace, deduplication)
│   └── images/                 # 12 product images (PNG / JPG)
├── docs/
│   ├── ARCHITECTURE.md         # Deep-dive architecture, pipeline flow, security model
│   └── DEMO_SCRIPT.md          # 5-minute step-by-step presentation script
├── scripts/
│   ├── chaos-test.ts           # Automated chaos test (SIGKILL injection & recovery verification)
│   └── generate-samples.ts     # Sample datasets generator script
├── package.json
└── README.md
```

---

## Quick Start & Exact Commands

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Full Stack in Development
Starts both the Coordinator (which auto-spawns 3 managed workers) and the Web UI:
```bash
npm run dev
```
- Web Application: `http://localhost:5173`
- Coordinator REST & SSE: `http://localhost:4000`

### 3. Build All Packages
Verifies strict TypeScript compilation and bundles frontend assets:
```bash
npm run build
```

### 4. Run Automated Test Suite
Runs all 20 Vitest unit, integration, and V3 architecture tests:
```bash
npm test
```

### 5. Run the Distributed Chaos Test
Starts an isolated coordinator, injects a mid-execution hard crash (`SIGKILL`) into a busy worker, and verifies automatic recovery and exact result calculation:
```bash
npm run chaos-test
```

### 6. Run in Production Mode
Builds and runs the unified production bundle (Fastify coordinator + child worker processes + static web frontend) on a single port:
```bash
npm run build
npm start
```
- Full Platform available at: `http://localhost:4000`

### 7. Zero-Cost Offline Demonstration (`RELAY_FAKE_LLM=1`)
To demo and test without an Anthropic API key, set `RELAY_FAKE_LLM=1`:
```bash
# Windows PowerShell
$env:RELAY_FAKE_LLM="1"; npm run dev

# Linux / macOS
RELAY_FAKE_LLM=1 npm run dev
```

---

## Sample Datasets for Testing

The `samples/` directory contains pre-generated datasets ready for immediate upload in the UI:
1. `samples/reviews/`: 40 customer review text files for sentiment extraction and markdown report synthesis.
2. `samples/data/messy_leads.csv`: 5,000-row tabular dataset with formatting anomalies and 150 duplicate rows for data cleaning.
3. `samples/images/`: 12 product graphics for parallel resizing and ZIP packaging.

Clicking any of the template chips on the **New Request** dialog automatically loads and configures these datasets.

---

## 5-Minute Demonstration Script

See [`docs/DEMO_SCRIPT.md`](file:///d:/DC/docs/DEMO_SCRIPT.md) for the complete walkthrough:
1. **Interactive 3D Hero:** Test real-time packet rerouting when crashing a worker node.
2. **Dashboard & Telemetry:** Inspect live OS child processes and add workers dynamically.
3. **AI Pipeline Request:** Upload files, generate an AI plan, and inspect the cost estimate.
4. **Stage Stepper & Live Metrics:** Watch progress across Intake $\to$ Plan $\to$ Approve $\to$ Map $\to$ Merge $\to$ Verify $\to$ Done.
5. **Check the Work:** Inspect sample source inputs vs worker outputs with verification badges.
6. **Deliverable Download:** Download finished `.md`, `.csv`, `.xlsx`, or `.zip` deliverables.
7. **Chaos Injection:** Kill a worker process mid-execution; observe the red `crashed` marker and hatched `LOST` bar recover cleanly.
