# Relay v4 Architecture Overview

## 1. Monorepo Structure
- `backend/`: FastAPI application (Python 3.12+), virtual node pool (100 nodes), 5-stage pipeline, `AsyncOpenAI` provider clients, exact tools registry, and batched Firestore store.
- `frontend/`: Next.js 16 (App Router, React 19, TypeScript strict), Tailwind CSS v4, Motion, GSAP + ScrollTrigger, Three.js / React Three Fiber, Lenis smooth scrolling, Firebase modular SDK, TanStack Query.

## 2. Distributed Execution Pipeline
```
[User Request + Files]
          │
          ▼
     1. INTAKE (Deterministic validation, size check, unit counting, extraction)
          │
          ▼
     2. PLAN (AI Orchestrator via Gemini: intent, exact/AI mode, tool/instructions)
          │
          ▼
     3. SPLIT (Deterministic partition into 10..100 parts with sizing rule)
          │
          ▼
     4. EXECUTE (Virtual Node Pool: pull-based load balancing, circuit breakers, auto-reassignment)
          │
          ▼
     5. VERIFY (Exact cross-checks and AI sample verification)
          │
          ▼
     6. ASSEMBLE (Hierarchical reduction, number guard, plain-language user explanation)
```

## 3. Security & Isolation
- User-safe view: Users only receive `status`, `progress`, `stepLabel`, `createdAt`, `promptPreview`, and `result`.
- Internal view: Admin only receives plan, parts, node allocations, provider latencies, and circuit breaker states.
- Cloud Firestore security rules strictly deny all direct client writes and deny non-admin access to internal subcollections.
