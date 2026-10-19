# Relay v4: Architectural Deviations Log

This document records any necessary deviations from the initial specifications and the technical rationale for each choice, as required by Rule 8 of `SRS_1_FULL_SYSTEM.md`.

## 1. Provider Models & Endpoints Update (October 2026)
- **Deviation:** Gemini 2.5 Flash / 2.5 Flash-Lite were retired on 16 October 2026. Groq retired `llama-3.1-8b-instant`.
- **Resolution:** Configured defaults to current active production models: `gemini-3.5-flash` / `gemini-3.6-flash` / `gemini-3.8-flash` for Gemini orchestrator and worker, `gemini-3.1-flash-lite` for backup worker, `openai/gpt-oss-20b` for Groq, `mistral-small-latest` for Mistral, and `openai/gpt-4o-mini` on GitHub Models (`https://models.github.ai/inference`).
- **Dynamic Safety:** The mandatory startup provider probe dynamically queries models and validates functionality via test completions, automatically excluding retired endpoints without crashing.

## 2. In-Memory Store with Seamless Cloud Firestore Synchronization
- **Deviation:** Firebase Cloud Firestore credentials may initially be local placeholders until manual developer setup is linked.
- **Resolution:** An in-memory store acts as an immediate fallback and high-speed write cache that syncs to Cloud Firestore using a batched and throttled writer whenever valid credentials or the emulator are connected. This enables 100% offline development, testing, and continuous deployment readiness.
