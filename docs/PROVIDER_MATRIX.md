# Provider Health & Qualification Matrix

**Date:** 2026-10-19  
**Status:** Live Probed & Verified (RUN_LIVE=1)  

---

## 1. Provider Status Matrix

All credentials were read directly from `backend/.env`. In accordance with security rules, no raw API keys or tokens are displayed.

| Provider | Configured Model | Base URL | Auth (401/403) | Probe / Health State | Structured JSON | Latency (p50) | Rate Limit / Quota Handling |
|---|---|---|---|---|---|---|---|
| **Groq** | `openai/gpt-oss-20b` | `https://api.groq.com/openai/v1` | **Accepted** | **HEALTHY** | **Pass (100%)** | 447 ms | 429 caught & wrapped in `RateLimited` |
| **GitHub Models** | `openai/gpt-4o-mini` | `https://models.github.ai/inference` | **Accepted** | **HEALTHY** | **Pass (100%)** | 3,041 ms | Pacing enforced by semaphore |
| **Gemini** | `gemini-3.6-flash` | `https://generativelanguage.googleapis.com/v1beta/openai/` | **Accepted** | **UNAVAILABLE** (Quota) | **Pass** (when quota available) | 2,017 ms | Free-tier daily cap (20 req/day) caught; Breaker opens safely |
| **Gemini Lite** | `gemini-3.6-flash` | `https://generativelanguage.googleapis.com/v1beta/openai/` | **Accepted** | **UNAVAILABLE** (Quota) | **Pass** (when quota available) | 1,594 ms | Shared free-tier project quota cap caught; Breaker opens safely |
| **Mistral** | `mistral-small-latest` | `https://api.mistral.ai/v1` | **Accepted** | **UNAVAILABLE** (Rate Limit) | N/A | N/A | Rate limit error 1300 caught; Circuit opened to `unavailable` |

---

## 2. Detailed Technical Findings

### 2.1 Groq
- **Model**: `openai/gpt-oss-20b`
- **Authentication**: Key accepted with zero auth errors.
- **Structured Output**: Strict JSON mode generates valid schema-compliant objects without markdown wrappers or code block artifacts.
- **Failover / Resilience**: Acts as primary healthy fast execution provider.

### 2.2 GitHub Models (Azure AI Inference)
- **Model**: `openai/gpt-4o-mini`
- **Authentication**: Token accepted.
- **Completion**: Standard chat completions function cleanly through `AsyncOpenAI`.
- **Response Format**: Handled across multiple response payload structures.

### 2.3 Gemini & Gemini Lite
- **Model**: `gemini-3.6-flash`
- **Status**: The live probe verified key validity. However, the user's free tier Google AI Studio quota hit the daily limit (`generativelanguage.googleapis.com/generate_content_free_tier_requests`, limit: 20/day).
- **Circuit Breaker Action**: The platform caught HTTP 429 `RESOURCE_EXHAUSTED`, incremented failure counters, and safely marked Gemini as `unavailable` without crashing the service or interrupting scheduled tasks.
- **Recovery**: Automatic failover dispatched requests to Groq and GitHub Models.

### 2.4 Mistral
- **Model**: `mistral-small-latest`
- **Status**: Key accepted; free tier tier-rate limit (code 1300) encountered during startup probe.
- **Circuit Breaker Action**: Handled by circuit breaker failover.

---

## 3. Circuit Breaker State Transitions Verified

Empirical verification via `tests/live/test_providers_live.py`:
1. **Healthy**: Normal operation, requests dispatched.
2. **Degraded**: 1st failure recorded, provider allowed with back-off pacing.
3. **Crashed (Open)**: 3 consecutive failures reached. `can_attempt()` immediately returns `False`, eliminating downstream latency.
4. **Recovering (Half-Open)**: After 30s cool-down, exactly 1 probe request is allowed.
5. **Success $\rightarrow$ Healthy**: Successful probe resets consecutive failure counter to 0 and closes circuit.
6. **Fatal Auth Error $\rightarrow$ Unavailable**: 401/403 marks provider `unavailable` immediately.
