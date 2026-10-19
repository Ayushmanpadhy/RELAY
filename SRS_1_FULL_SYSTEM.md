# Relay: Distributed AI Task Platform. Full System SRS (v4)

Document 1 of 3. Companions: `SRS_2_FRONTEND.md`, `SRS_3_BACKEND.md`. Where documents disagree, this one wins.

---

## 1. Introduction

### 1.1 Purpose
Relay lets a person describe work in plain language, attach files, and receive a finished, explained result. Behind the scenes an AI orchestrator analyses the request, splits it into 10 to 100 sub-tasks sized to the amount of work, distributes them across many worker nodes backed by different AI providers, recovers automatically from node or provider failure, combines the partial results and delivers one answer.

### 1.2 Scope
Two web interfaces over one backend:
- **User interface** (light theme): sign in, submit prompt + files, see simple progress, read the result.
- **Admin panel** (dark theme): see every submission, how it was split, which node and provider handled each part, live node health (working / idle / crashed / recovering), reassignments and failures.

Out of scope: payments, teams/organisations, mobile apps, running arbitrary user code, geographic placement control.

### 1.3 Definitions
- **Request / Job:** one user submission (prompt + files).
- **Part / Sub-task:** one independent slice of a job.
- **Orchestrator:** the AI call that analyses the job and writes the plan.
- **Node:** a logical worker slot (default 100). A node is bound at run time to one **provider endpoint** (Gemini, Groq, Mistral, GitHub Models, Gemini Lite).
- **Provider:** an OpenAI-compatible AI API.
- **Exact task:** a task solved by a deterministic built-in tool (counting, sums, filtering) instead of a language model.
- **Assembler:** final step that merges part results and writes the user-facing explanation.

### 1.4 Honest design statements (must be reflected in the product)
1. "Servers around the world" means **different providers' infrastructure**. Relay does not claim exact geolocation. The admin panel may show a static, clearly labelled "provider region (approximate)" tag.
2. Language models are unreliable at exact counting and arithmetic. For such tasks (example: "how many of these 100,000 numbers start with 9") the plan uses **Exact tasks** for the computation and uses AI for planning, cross-checking a sample, and explaining the result. The admin panel shows for every part whether it was solved by a tool or by a provider/model.
3. Free-tier AI limits are real. The system must throttle, back off and fail over instead of crashing.

---

## 2. Overall description

### 2.1 Users
| Role | Goal | Sees |
|---|---|---|
| User | Get work done | Prompt box, file drop, friendly progress, result and explanation. **No internals.** |
| Admin | Understand and operate the platform | Everything: submissions, plans, parts, nodes, providers, failures |

### 2.2 System context
```
Browser (Next.js)  --Firebase Auth ID token-->  FastAPI backend  --OpenAI-compatible SDK-->  Gemini / Groq / Mistral / GitHub Models
        ^                                          |
        +------------ Firestore realtime ----------+   (Firebase project "relay": Auth + Firestore)
```
- Firebase Auth: email/password and Google sign-in; admin role by custom claim.
- Firestore: single database; the browser reads live state through listeners; only the backend writes job data.
- Uploaded files are stored on the backend's disk (no separate object store required).

### 2.3 Operating environment
Runs locally without Docker, Redis or message brokers: Python 3.12+ backend, Node 22+ frontend, one Firebase project named **relay**.

### 2.4 Constraints
- Only OpenAI-compatible access to AI providers via the `openai` SDK (`AsyncOpenAI`) with swapped `base_url` and `api_key`. No vendor SDKs.
- API keys exist only in `backend/.env`. They never appear in source, docs, logs, Firestore or the browser.
- Model names and base URLs are configuration, never hard-coded.
- Free-tier friendly: batching mode, per-provider rate limiting, circuit breakers.

### 2.5 Assumptions and verified facts (as of 19 Oct 2026)
- Gemini 2.5 Flash and 2.5 Flash-Lite were scheduled to shut down on 16 Oct 2026. Defaults are `gemini-3.5-flash` and `gemini-3.1-flash-lite`.
- Groq's `llama-3.1-8b-instant` was scheduled for deprecation on 16 Aug 2026 (suggested replacement `openai/gpt-oss-20b`).
- GitHub Models now uses `https://models.github.ai/inference` and model ids of the form `openai/gpt-4o-mini`; the token needs the `models: read` permission.
- Because providers change names often, the backend runs a **startup model probe** (calls each provider's models list or a 1-token test) and reports which providers are usable. A provider that fails the probe is excluded and shown as unavailable in the admin panel.

---

## 3. System features and functional requirements

### 3.1 Authentication and roles
- FR-A1: Sign up and sign in with email + password (Firebase Auth).
- FR-A2: Sign in with Google (Firebase Auth).
- FR-A3: A seeded admin account (`admin@gmail.com`, password from `ADMIN_PASSWORD` env, default `admin123` for development) carries the custom claim `admin: true`.
- FR-A4: After sign-in the app redirects by role: admin to `/admin` (dark), everyone else to `/app` (light).
- FR-A5: Every backend call except health requires a valid Firebase ID token. Admin endpoints additionally require the admin claim, verified server-side.
- FR-A6: Sign out returns to the dark landing page with the reverse theme transition.

### 3.2 Submitting work (user)
- FR-S1: One composer: free-text prompt (required) + optional files (drag and drop, multiple).
- FR-S2: Accepted files: txt, md, csv, json, pdf, docx, xlsx, png, jpg, webp. Max 25 MB per file, 10 files, 50 MB total. Clear error messages for violations.
- FR-S3: Submission returns immediately with a job id; the user sees live, simple progress.
- FR-S4: If the request is genuinely ambiguous the orchestrator may return at most 2 short clarifying questions; the user answers inline; processing continues. Otherwise no questions.
- FR-S5: User can list past requests and reopen results.

### 3.3 Analysis and planning
- FR-P1: Intake extracts text/rows/pages from every file and builds a manifest (name, type, size, item counts, preview).
- FR-P2: One orchestrator call (Gemini) receives prompt + manifest and returns a validated JSON plan: intent, execution mode (`exact` or `ai`), tool or instruction, split strategy, part count, reduce strategy, result style.
- FR-P3: Part count is chosen by work size and clamped to **10..100** (fewer only when the input has fewer than 10 items). Sizing rule in `SRS_3_BACKEND.md`.
- FR-P4: Invalid plans are retried once with the validation error; then the job fails with a friendly message.

### 3.4 Distributed execution
- FR-D1: Parts are placed in a queue; free nodes **pull** parts (pull-based load balancing).
- FR-D2: Each node is bound to a healthy provider by round-robin; concurrency is limited globally and per provider.
- FR-D3: Failure handling: HTTP 429, 5xx, 401/403/404, timeouts, malformed output or simulated crash mark the attempt failed. The part is requeued and given to a **different node, preferring a different provider**, after a short back-off (honour `Retry-After`). Up to 4 attempts.
- FR-D4: A per-provider circuit breaker opens after 3 consecutive failures, marks the provider's nodes "crashed", and half-opens after a cool-down ("recovering").
- FR-D5: Call mode toggle (admin setting): **Batched** (group up to 10 parts per provider call, default for `ai` mode) or **Individual** (one call per part).
- FR-D6: Exact parts run a deterministic tool on the node runtime with no provider call. A sample of exact parts is cross-checked by a provider and discrepancies are logged.

### 3.5 Assembly and delivery
- FR-R1: Part results are validated against the plan's schema, then reduced (sum, merge, concat, or AI synthesis).
- FR-R2: Numeric answers from exact tasks are never altered by AI; the narrative must contain the exact computed value (validated by code).
- FR-R3: The assembler (Gemini) writes a plain-language result: headline answer, short explanation of what was done in user terms, optional downloadable file (md/csv/xlsx). It never mentions nodes, providers or internals.
- FR-R4: Result is stored on the job and shown instantly in the user's result window.

### 3.6 Admin panel
- FR-M1: **Overview:** live counts (active jobs, nodes working / idle / crashed / recovering, total reassignments, failure rate, average completion time), a live grid of all nodes colour-coded by state with provider badge, provider health strip (state, latency, error rate, circuit state), and a live event feed.
- FR-M2: **Submissions:** table of all jobs with user, prompt excerpt, file count, status, part count, duration; filters and search.
- FR-M3: **Job detail:** the user's full prompt and files, the plan in readable form, the split table (part, size, execution type, node, provider, attempts, status), the **reassignment trail** per part (e.g. "node 12 / Groq crashed, then node 47 / Mistral completed"), a swim-lane timeline by node or provider, raw part outputs, and the final result.
- FR-M4: **Nodes and providers:** per-node history, per-provider metrics, **chaos controls** (crash node, crash provider for N seconds, heal all) to demonstrate fault tolerance.
- FR-M5: **Settings:** call mode, concurrency, retry limits (read/write, validated).
- FR-M6: **Users:** list of registered users with job counts.

### 3.7 Theming and transitions
- FR-T1: Landing, auth and admin are dark. The user interface is light.
- FR-T2: Successful sign-in as a user triggers a calm dark-to-light transition (circular reveal from the sign-in button, about 900 ms). Sign-out reverses it. Admin sign-in keeps dark with a soft entrance. Reduced-motion users get a simple cross-fade.

---

## 4. Non-functional requirements
- NFR-1 Performance: first meaningful render under 2 s on broadband; admin live grid stays at 60 fps with 100 nodes.
- NFR-2 Reliability: one failing provider or node never fails a job while at least one provider is healthy. Backend restart: unfinished jobs resume (parts in `running` are requeued).
- NFR-3 Security: keys only server-side; Firestore rules deny all client writes to job data and deny users access to internals; admin role by claim; uploads validated by size, type and magic bytes; prompt-injection hardening (uploaded content wrapped in delimiters and treated as data); per-user rate limit (default 10 jobs/hour).
- NFR-4 Privacy: users see only their own jobs; uploaded files auto-deleted after 7 days.
- NFR-5 Accessibility: WCAG 2.2 AA contrast, keyboard navigation, visible focus, `prefers-reduced-motion` honoured, `prefers-color-scheme` ignored by design (themes are role-based).
- NFR-6 Usability: user flow completes in three steps (describe, upload, read result).
- NFR-7 Maintainability: strict typing (TypeScript strict, Pydantic v2), modular providers, lint and tests pass.
- NFR-8 Offline demo: `RELAY_FAKE_PROVIDERS=1` simulates providers (latency, failures) so the whole product can be demoed and tested without keys or cost.

---

## 5. Data model (Firestore, project "relay")
```
users/{uid}                  displayName, email, createdAt, role
jobs/{jobId}                 USER-SAFE: userId, promptPreview, status (queued|analyzing|working|assembling|done|failed),
                             progress (0-100), stepLabel, createdAt, finishedAt, result{headline, explanation, files[]}
jobs_internal/{jobId}        ADMIN-ONLY: fullPrompt, files[], manifest, plan, partCount, mode, callMode, stats, reassignments
jobs_internal/{jobId}/parts/{partId}   idx, size, execution (tool|ai), tool?, nodeId, provider, model, attempts[], status, output, error
nodes/{nodeId}               state, provider, currentJobId, currentPartId, completed, failed, lastChange
providers/{id}               name, model, state (healthy|degraded|crashed|recovering|unavailable), latencyMs, errorRate, circuit
events/{eventId}             ts, level, message, jobId?, nodeId?     (rolling window)
settings/runtime             callMode, maxConcurrency, maxAttempts
```
Security rules (summary): users read only `jobs` where `userId == auth.uid` and their own `users` doc; admins (token claim) read everything; **no client writes** to jobs, nodes, providers, events or settings.

---

## 6. External interfaces
- Firebase Auth and Firestore (project "relay").
- AI providers via OpenAI-compatible Chat Completions: Gemini (`https://generativelanguage.googleapis.com/v1beta/openai/`), Groq (`https://api.groq.com/openai/v1`), Mistral (`https://api.mistral.ai/v1`), GitHub Models (`https://models.github.ai/inference`).
- REST API of the backend (see `SRS_3_BACKEND.md`).

---

## 7. Acceptance scenarios (all must pass)
1. **Numbers:** upload a 100,000-number file, ask "count how many numbers start with 9". The plan uses 100 parts of exact tasks. The answer equals the ground truth printed by `samples/gen_numbers.py`. Admin sees 100 parts across nodes.
2. **Documents (AI mode):** upload 40 reviews, ask for top complaints and a one-page summary. Plan splits into 10 to 40 parts, results merged, readable result, no internals shown to the user.
3. **Chaos:** during scenario 1 or 2 the admin crashes 10 nodes and one provider. The job still completes with the identical answer; admin shows the reassignment trails and counters.
4. **Missing key:** removing one provider key excludes it cleanly; the job completes on the others.
5. **Isolation:** user A cannot read user B's job; a non-admin calling an admin endpoint gets 403; Firestore rules block direct client reads of `jobs_internal`.
6. **Auth:** email sign-up, Google sign-in and the seeded admin all work; role redirect is correct.
7. **Transitions:** dark to light after user sign-in; no flash of wrong theme; reduced-motion respected.
8. **Offline demo:** scenarios 1 to 3 pass with `RELAY_FAKE_PROVIDERS=1`.
9. Lint, type-check and automated tests pass in both apps.

## 8. Traceability
Each FR above must map to at least one automated test or documented manual check in `docs/TRACEABILITY.md` generated at the end of the build.
