# Relay v4: Requirements Traceability Matrix

This document maps every Functional Requirement (FR) and Non-Functional Requirement (NFR) from `SRS_1_FULL_SYSTEM.md`, `SRS_2_FRONTEND.md`, and `SRS_3_BACKEND.md` to the implementing source code files and automated tests.

---

## 1. Authentication & Role-Based Access Control

| Requirement ID | Description | Source Implementation | Test / Verification |
|---|---|---|---|
| **FR-A1** | Email/Password Sign Up & Sign In | `frontend/src/context/AuthContext.tsx`, `frontend/src/app/auth/page.tsx` | Manual & Cypress/Playwright auth flow |
| **FR-A2** | Google Sign In (Firebase popup) | `frontend/src/context/AuthContext.tsx`, `frontend/src/lib/firebase.ts` | Manual Google OAuth popup verification |
| **FR-A3** | Seeded admin account with `admin: true` custom claim | `backend/scripts/seed_admin.py`, `backend/app/auth.py` | Executed `seed_admin.py`; verified claims |
| **FR-A4** | Role redirection: admin to `/admin` (dark), user to `/app` (light) | `frontend/src/app/auth/page.tsx` | Client-side role routing tests |
| **FR-A5** | Server-side Firebase ID token verification and admin claim check | `backend/app/auth.py` (`get_current_user`, `require_admin`) | Automated integration tests in `backend/tests/` |
| **FR-A6** | Sign out returns to dark landing page with reverse transition | `frontend/src/app/app/page.tsx`, `frontend/src/components/ThemeTransition.ts` | Circular reverse View Transition |

---

## 2. User Submission & Workspace

| Requirement ID | Description | Source Implementation | Test / Verification |
|---|---|---|---|
| **FR-S1** | Composer with prompt + multiple file dropzone | `frontend/src/app/app/page.tsx` | UI validation & file drag-and-drop test |
| **FR-S2** | File upload validation: max 25MB/file, 10 files, 50MB total, safe types | `backend/app/pipeline/intake.py` | Intake unit tests with oversized files |
| **FR-S3** | Immediate 202 response with `{ jobId }` & live progress tracking | `backend/app/api/jobs.py`, `frontend/src/app/app/r/[id]/page.tsx` | `test_integration.py` |
| **FR-S4** | Clarifying questions (max 2 if ambiguous, else empty) | `backend/app/pipeline/planner.py`, `frontend/src/app/app/r/[id]/page.tsx` | Schema validation and test prompts |
| **FR-S5** | User can list past requests and reopen results | `backend/app/api/jobs.py` (`GET /api/jobs`), `frontend/src/app/app/page.tsx` | User isolation queries test |

---

## 3. Analysis & Planning

| Requirement ID | Description | Source Implementation | Test / Verification |
|---|---|---|---|
| **FR-P1** | Intake manifest generation with units, unitKind, and preview | `backend/app/pipeline/intake.py` | `test_integration.py` |
| **FR-P2** | AI Orchestrator JSON plan (intent, exact/ai mode, tool, instructions) | `backend/app/pipeline/planner.py` | `test_integration.py` |
| **FR-P3** | Sizing rule: 10..100 clamped partitions based on workload | `backend/app/pipeline/planner.py` | `backend/tests/test_sizing.py` (4 unit tests passed) |
| **FR-P4** | Invalid plan automatic retry once with error appended | `backend/app/pipeline/planner.py` | Error retry branch in `create_plan` |

---

## 4. Distributed Execution & Virtual Node Pool

| Requirement ID | Description | Source Implementation | Test / Verification |
|---|---|---|---|
| **FR-D1** | Pull-based load balancing where free nodes pull queued parts | `backend/app/pipeline/scheduler.py` | `test_integration.py` |
| **FR-D2** | Round-robin node binding across healthy providers | `backend/app/nodes/pool.py`, `backend/app/providers/registry.py` | Live provider probe & node binding tests |
| **FR-D3** | Failure back-off, retry up to 4 attempts on alternative node/provider | `backend/app/pipeline/scheduler.py` | Retry loop and attempt logging in `scheduler.py` |
| **FR-D4** | Per-provider circuit breaker (3 failures -> crashed for 30s -> recovering) | `backend/app/nodes/breaker.py` | `backend/tests/test_breaker.py` (unit tests passed) |
| **FR-D5** | Call mode toggle: Batched vs Individual | `backend/app/pipeline/scheduler.py`, `backend/app/api/admin.py` | Settings API read/write test |
| **FR-D6** | Exact tasks run deterministic Python tools with verification sample | `backend/app/tools/registry.py`, `backend/app/pipeline/verifier.py` | `backend/tests/test_tools.py` (7 unit tests passed) |

---

## 5. Assembly & Delivery

| Requirement ID | Description | Source Implementation | Test / Verification |
|---|---|---|---|
| **FR-R1** | Partial results validated and reduced (sum, merge, concat, synthesis) | `backend/app/pipeline/assembler.py` | `test_integration.py` |
| **FR-R2** | Exact numeric answers strictly preserved (Number Guard) | `backend/app/pipeline/assembler.py` | `test_integration.py` (verified exact ground truth in headline) |
| **FR-R3** | Plain-language user result with headline and explanation; NO internals | `backend/app/pipeline/assembler.py` | Verification of absence of node/provider keywords |
| **FR-R4** | Result displayed instantly in user result window with deliverable downloads | `frontend/src/app/app/r/[id]/page.tsx` | Result window rendering and download link tests |

---

## 6. Admin Panel & Chaos Engineering

| Requirement ID | Description | Source Implementation | Test / Verification |
|---|---|---|---|
| **FR-M1** | Admin overview: live counters, 100-node grid, provider health strip, events | `frontend/src/app/admin/page.tsx`, `backend/app/api/admin.py` | Live polling and state rendering |
| **FR-M2** | Submissions table with search, status filters, duration, and link to detail | `frontend/src/app/admin/submissions/page.tsx` | Search and filter rendering |
| **FR-M3** | Job detail: full prompt, files, plan, split table, reassignment trails | `frontend/src/app/admin/jobs/[id]/page.tsx` | Reassignment trail accordion verification |
| **FR-M4** | Chaos controls: crash node, crash provider (15/30/60s), heal all | `backend/app/nodes/chaos.py`, `frontend/src/app/admin/nodes/page.tsx` | Chaos simulation integration |
| **FR-M5** | Runtime settings (call mode, concurrency, retry limits, provider probe) | `frontend/src/app/admin/settings/page.tsx`, `backend/app/api/admin.py` | Runtime settings persistence |
| **FR-M6** | Registered users list with submission counts | `frontend/src/app/admin/users/page.tsx`, `backend/app/api/admin.py` | User query endpoint |

---

## 7. Theming & Motion

| Requirement ID | Description | Source Implementation | Test / Verification |
|---|---|---|---|
| **FR-T1** | Dark theme for Landing/Auth/Admin; Light theme for User area `/app` | `frontend/src/app/globals.css` | Role-based CSS variables validation |
| **FR-T2** | Circular reveal View Transition (`document.startViewTransition`, 900ms) | `frontend/src/components/ThemeTransition.ts`, `globals.css` | View transition clip-path execution |

---

## 8. Non-Functional Requirements (NFR)

| Requirement ID | Description | Verification Method |
|---|---|---|
| **NFR-1** | Performance: 60 fps 100-node grid rendering, fast page load | Memoized node components, lightweight CSS transitions |
| **NFR-2** | Reliability: automatic failover; unfinished jobs resume on restart | Startup resume loop in `app/main.py`; circuit breakers |
| **NFR-3** | Security: no keys in client/git/logs; strict Firestore rules; rate limiting | Redaction log filter in `main.py`, rate limiter in `jobs.py`, `firestore.rules` |
| **NFR-4** | Privacy: user isolation; users cannot access `jobs_internal` or others' jobs | Firestore rules + FastAPI token owner validation |
| **NFR-5** | Accessibility: WCAG 2.2 contrast, visible focus, `prefers-reduced-motion` | Fallback animations and high-contrast color tokens |
| **NFR-8** | Offline demo: `RELAY_FAKE_PROVIDERS=1` works end-to-end | Validated via `tests/test_integration.py` |
