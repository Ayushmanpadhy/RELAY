# Capacity & Resource Planning: Relay v4

**Date:** 2026-10-19  
**Platform:** FastAPI 0.115 / Firestore / Multi-Provider AI Engine

---

## 1. Firestore Free Tier Capacity Model

Google Cloud Firestore Spark (Free) Tier limits:
- **Document Reads:** 50,000 / day
- **Document Writes:** 20,000 / day
- **Document Deletes:** 20,000 / day
- **Storage:** 1 GiB total

### 1.1 Write Amplification Analysis
For a standard job split into $N$ parts:
- **Intake & Plan Creation:** 2 writes (`jobs/{id}`, `jobs_internal/{id}`).
- **Part Execution:** Batched via `BatchedFirestoreWriter` flush buffer. Rather than 1 write per state change, writes are buffered and batched in 400-document transactions.
- **Assembler & Completion:** 2 writes (`jobs/{id}`, `jobs_internal/{id}`).
- **Total writes per job:** $\approx 4 + N$ writes.

### 1.2 Daily Job Limits on Free Plan

| Part Count per Job ($N$) | Writes per Job | Max Jobs / Day (at 20k writes/day) | Bottleneck |
|---|---|---|---|
| **1 Part** (Indivisible) | 5 | 4,000 jobs/day | Firestore writes |
| **10 Parts** (Minimum batch) | 14 | 1,428 jobs/day | Firestore writes |
| **25 Parts** (Medium job) | 29 | 689 jobs/day | Firestore writes |
| **100 Parts** (Maximum clamp) | 104 | 192 jobs/day | Firestore writes |

---

## 2. AI Provider Rate Limits & Throughput

| Provider | Model | Free Tier RPM | Daily Free Limit | Relay Concurrency | Max Jobs / Day (AI Mode) |
|---|---|---|---|---|---|
| **Groq** | `openai/gpt-oss-20b` | 30 RPM | ~14,400 calls/day | 3 concurrent | ~1,400 jobs/day (10 parts) |
| **GitHub Models** | `openai/gpt-4o-mini` | 15 RPM | 150 calls/day | 3 concurrent | ~15 jobs/day (10 parts) |
| **Google Gemini** | `gemini-3.5-flash` | 15 RPM | 20 calls/day (Free Tier) | 3 concurrent | ~2 jobs/day (Free tier project) |
| **Mistral** | `mistral-small-latest` | 1 RPS | ~500 calls/day | 3 concurrent | ~50 jobs/day (10 parts) |

> [!NOTE]
> The primary throughput driver in production is **Groq** and **GitHub Models**. Upgrading Google Gemini to pay-as-you-go lifts the 20 req/day limit to 1,000 RPM.

---

## 3. Server Resource Requirements

- **Backend CPU & Memory:**
  - Idle: ~65 MB RAM, <0.5% CPU
  - Under load (100 concurrent worker tasks): ~140 MB RAM, ~8-12% CPU (async I/O bound)
  - Recommended minimum VPS: 1 vCPU, 512 MB RAM (e.g. Fly.io `shared-cpu-1x` 256MB or Render starter)
- **Disk Space (Persistent Volume):**
  - Ephemeral uploads stored in `data/uploads/`
  - Retention policy cleans raw files after 7 days
  - Recommended volume size: 5 GB to 10 GB
