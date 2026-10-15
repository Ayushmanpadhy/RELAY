# Relay: 5-Minute Demonstration Walkthrough

This script provides an exact step-by-step walkthrough to demonstrate Relay's distributed computing architecture, live worker telemetry, failure recovery, and empirical scalability in 5 minutes.

---

## Preparation (30 seconds before presentation)
1. In your terminal, run:
   ```bash
   npm run dev
   ```
2. Open your browser at `http://localhost:5173`.
3. Confirm the live connection dot in the upper-right corner reads **Live** in green.

---

## Step 1: The Landing Page (0:00 - 1:00)
- **What to show:**
  - View the landing page hero at `http://localhost:5173/`.
  - Move the mouse across the screen to demonstrate smooth 3D camera parallax.
  - Hover over a worker node to inspect its live simulated metrics (`worker-3 · 128 tasks done`).
- **Interaction (Simulate Crash in 3D):**
  - **Click a worker node.**
  - The node turns red, flickers, and drops its task packets.
  - Show the audience how the central coordinator immediately reroutes the task curves to the surviving nodes.
  - Point out the "Recovered" state when the node automatically revives after 4 seconds.
  - Click the center coordinator to trigger a packet burst.
- **What to say:**
  > *"Relay is a distributed task platform. In 5 seconds this visualization conveys our entire premise: a coordinator splits jobs into tasks, independent workers execute them in parallel, and when any worker crashes, the system recovers and reroutes work automatically without data loss."*
- Click **"Open dashboard"** (or navigate to `/app`).

---

## Step 2: Live Cluster Telemetry (1:00 - 1:45)
- **What to show:**
  - The top metrics strip: **Workers alive (3)**, **Queued tasks (0)**, **Running tasks (0)**, **Completed jobs (0)**.
  - The **Cluster** column showing 3 active managed worker processes (`worker-1`, `worker-2`, `worker-3`).
  - Emphasize that these are **real OS child processes** (`child_process.fork`), running independently and communicating with the coordinator strictly over HTTP.
- **Interaction:**
  - Click **"+ Add worker"**. Watch a 4th worker process (`worker-4`) instantly fork, register over HTTP, and appear live.
- **What to say:**
  > *"Here on the dashboard, we see real-time state hydrated over Server-Sent Events. These aren't simulations—each worker is an isolated operating system process with its own PID. The workers pull tasks atomically from SQLite using serialized transactions, ensuring zero race conditions."*

---

## Step 3: Submitting a Job & The Signature Timeline (1:45 - 3:00)
- **What to show:**
  - Click **"New job"**.
  - Select **"Prime Counter"**, choose **Medium** scale (24 tasks, counting primes up to 10,000,000), set **Priority: High**, and click **"Run job"**.
  - You will be redirected to the **Job Detail** view (`/app/jobs/:id`).
  - Watch the **Task Grid** light up: chips transition from dim (Pending) to pulsing accent (Leased) to green (Done).
  - Direct the audience's attention to the **Execution Timeline**:
    - Horizontal swim lanes representing each worker process.
    - Bars extending across time as workers crunch numbers.
- **What to say:**
  > *"Notice how the workload is partitioned into 24 discrete ranges. The workers pull tasks in parallel. Compute runs inside isolated worker threads, so even when CPU usage spikes to 100%, the worker's HTTP heartbeat loop is never blocked."*

---

## Step 4: Injecting Chaos — Live Hard Crash & Recovery (3:00 - 4:00)
- **Interaction (Deliberate Failure Injection):**
  - Return to the Dashboard in another tab (or navigate back to `/app`), find a worker marked **BUSY**, click its `⋯` options menu, and click **"Kill Process (Crash)"**.
  - Return to the **Job Detail** page.
- **What to show:**
  - In the Timeline swim lane, the killed worker immediately displays a red **"crashed"** indicator.
  - The in-flight attempt turns into a **bad diagonally hatched bar marked "LOST"**.
  - The coordinator sweeper detects heartbeat silence, expires the task's lease, and requeues the task with exponential backoff.
  - A surviving worker picks up the lost task (marked attempt #2) and completes it.
  - The job finishes with **100% completion**, reaching `DONE` with the exact verified result: **664,579 primes ≤ 10,000,000**.
  - Open the bottom **Activity** log drawer to see the exact narrative line:
    `worker-X lost contact → 1 task(s) requeued`.
- **What to say:**
  > *"This diagonal hatched bar is the core proof of fault tolerance. When we sent a SIGKILL to worker-3, it died instantly with zero warning. The coordinator detected the missed heartbeat, marked the attempt LOST, and safely requeued the task. Fencing tokens guaranteed that even if that worker had hung, a stale result could never corrupt the final reduction."*

---

## Step 5: Scalability Benchmark (4:00 - 5:00)
- **What to show:**
  - Click **"Benchmark"** in the top navigation.
  - Keep default worker counts **1, 2, and 4** checked.
  - Click **"Run Benchmark"**.
  - Watch the live orchestration stepper:
    1. Cluster automatically scales to 1 worker, measures execution time.
    2. Cluster automatically scales to 2 workers, measures execution time.
    3. Cluster automatically scales to 4 workers, measures execution time.
    4. Cluster restores original worker count.
  - Inspect the generated Recharts charts:
    - **Time vs Workers** (descending bars).
    - **Speedup vs Workers** (measured line vs dashed ideal linear).
    - Results table showing measured speedup and parallel efficiency %.
    - Read the automated insight aloud: *"4 workers were 3.4x faster (85% efficiency)"*.
- **What to say:**
  > *"To prove scalability with real empirical numbers, our benchmark orchestrates automated cluster scaling and measures wall-clock speedup. We see near-linear scaling up to 4 workers, with slight sublinear dropoff caused by HTTP coordination latency and Amdahl's Law during the final reduce step."*

---

## Conclusion
> *"In summary, Relay proves that robust distributed systems don't require complex external infrastructure like Kafka or Redis. With synchronous atomic transactions in SQLite, non-blocking heartbeats, monotonic fencing tokens, and pull-based scheduling, a system can withstand arbitrary process failures while guaranteeing correctness and high throughput."*
