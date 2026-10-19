# Relay v4: End-to-End Demo Script & Acceptance Verification

This guide walks through verifying all 8 acceptance scenarios defined in Section 7 of `SRS_1_FULL_SYSTEM.md`.

---

## 0. Quick Start & Startup Verification

1. Start both backend and frontend servers with a single command from the root directory:
   ```bash
   npm run dev
   ```
2. The terminal output will show:
   - Backend running on `http://localhost:8000` with CORS enabled for `http://localhost:3000`.
   - 100 virtual worker nodes initialized in memory.
   - Startup provider probe results confirming active models (`gemini-3.6-flash`, `groq`, etc.).
   - Frontend running on `http://localhost:3000`.

---

## Scenario 1: Exact Numeric Computation (100,000 Numbers)

1. Generate the test dataset and print ground truth:
   ```bash
   npm run gen:numbers
   ```
   *Output note: Saves 100,000 numbers to `data/numbers_100k.txt` and prints the exact count of numbers starting with '9'.*
2. Visit `http://localhost:3000/auth`. Click **"Sign in as User"**.
3. In the user composer at `/app`:
   - Enter prompt: `"Count how many numbers start with 9 in this dataset"`.
   - Drop the generated file `data/numbers_100k.txt`.
   - Click **Start**.
4. The user sees the progress view at `/app/r/[jobId]` with a percentage ring and calm step labels ("Working on it").
5. In another tab, open `http://localhost:3000/admin`.
   - Observe the 100-node live grid turning accent color as worker slots pull and compute the 100 sub-tasks.
6. When completed:
   - The user receives the exact computed ground truth count in the headline and explanation (verified by the Number Guard).
   - The user interface reveals **NO technical internals** (no mentions of nodes, providers, or tools).

---

## Scenario 2: Document Intelligence (AI Mode)

1. Open `/app`.
2. Type: `"Summarize these customer feedback reviews and extract the top 5 complaints"`.
3. Attach customer reviews text or markdown file.
4. Click **Start**.
5. The AI Orchestrator classifies the request as `mode: "ai"`, divides into 10 to 40 parts, workers run AI synthesis, and the user receives a structured summary and downloadable report.

---

## Scenario 3: Chaos Engineering & Fault Tolerance

1. Submit a job from `/app`.
2. While the job is running, navigate to `http://localhost:3000/admin/nodes`.
3. In the **Simulated Failure Injection Controls**:
   - Click **Crash Node** on `node-005`.
   - Select `groq` and click **Simulate Provider Outage (30 seconds)**.
4. Observe:
   - `node-005` immediately turns red (`crashed`).
   - Groq provider circuit breaker opens.
   - In-flight tasks automatically re-route to alternative nodes and providers (e.g. Gemini).
   - In `/admin/jobs/[id]`, inspect the **Reassignment Trail** showing the failure and successful retry.
   - The job completes with 100% ground-truth accuracy.
5. Click **Heal All Nodes & Circuits** to restore all systems.

---

## Scenario 4: Missing Provider Key Handling

1. Remove or leave empty any provider key (e.g. `MISTRAL_API_KEY=""`) in `backend/.env`.
2. Restart backend or trigger manual probe from `/admin/settings`.
3. Notice:
   - That provider is marked `unavailable` with reason `"API key not configured in .env"`.
   - All jobs continue seamlessly on the remaining healthy providers without errors or downtime.

---

## Scenario 5: Security & Role Isolation

1. Non-admin access check:
   - Sign in as a regular user and attempt to navigate to `/admin`.
   - The route guard prevents access.
   - Calling `/api/admin/overview` with a user token returns `403 Forbidden`.
2. User isolation check:
   - User A cannot access `/api/jobs/{jobId}` belonging to User B.
   - Firestore security rules in `firestore.rules` deny direct client writes to job data and deny reading `jobs_internal`.

---

## Scenario 6: Role Redirection & Theme Transitions

1. Sign in as user (`user@example.com`):
   - Triggers the 900ms circular reveal transition from the button coordinate, transforming dark auth into calm light `/app`.
2. Sign in as admin (`admin@gmail.com`):
   - Stays in high-contrast dark theme, landing directly on `/admin`.
3. Sign out:
   - Reverses the circular transition back to the dark landing page.

---

## Scenario 7: Offline Demo Mode (`RELAY_FAKE_PROVIDERS=1`)

1. Set `RELAY_FAKE_PROVIDERS=1` in `backend/.env`.
2. Run automated integration test suite:
   ```bash
   backend\.venv\Scripts\python -m pytest backend/tests
   ```
3. All 14 tests pass completely offline with simulated provider latency, deterministic tools, and verified reassignments!
