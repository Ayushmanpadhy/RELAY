# AI Quality Evaluation Report: Relay v4

**Date:** 2026-10-19  
**Platform:** FastAPI 0.115 / AsyncOpenAI / Google Gemini 3.5 & 3.1 / Groq / Mistral / GitHub Models  
**Test Suite:** `backend/tests/test_golden_evaluation.py` & `backend/tests/live/`

---

## 1. Evaluation Methodology
The golden corpus consists of realistic tasks with known ground truth answers computed programmatically in code. Tasks are categorized into:
1. **Exact Tasks**: Numerical analysis, modulo/divisibility filtering, starts-with predicates, sum, min/max, text line counting, and tabular grouping.
2. **AI Reasoning Tasks**: Ambiguous intent clarification, prompt-injection defense, and indivisible batch clamp.

Scoring:
- Exact tasks must achieve **100% precision**.
- AI tasks evaluate structural validity, schema compliance, and intent identification.

---

## 2. Benchmark Results

| Test ID | Task Description | Expected Truth | Method / Tool | Result | Accuracy |
|---|---|---|---|---|---|
| GLD-001 | Count numbers starting with '7' across 10,000 numbers | Independent programmatic loop count | `count_numbers_starting_with` | Passed | 100% |
| GLD-002 | Count numbers divisible by 17 across 10,000 numbers | `n % 17 == 0` | `count_numbers_matching` | Passed | 100% |
| GLD-003 | Sum of numbers from 1 to 1,000 | 500,500.0 | `sum_numbers` | Passed | 100% |
| GLD-004 | Min and Max across negative and positive large numbers | Min: -4000.0, Max: 50000.0 | `min_max_numbers` | Passed | 100% |
| GLD-005 | Total word count across multi-sentence paragraphs | Independent split count | `word_count` | Passed | 100% |
| GLD-006 | Top N word frequencies (apple=6, banana=3) | Dictionary frequencies | `top_n_words` | Passed | 100% |
| GLD-007 | Filter CSV where country == 'IN' | 3 matching records | `count_rows_where` | Passed | 100% |
| GLD-008 | Frequency grouping by column (status) | active=3, pending=1, disabled=1 | `group_count` | Passed | 100% |
| GLD-009 | Deduplicate email records | 3 unique records | `dedupe_rows` | Passed | 100% |
| GLD-010 | CSV to JSON row serialization | Complete structured records | `csv_to_json` | Passed | 100% |
| GLD-011 | Planner exact mode intent classification | Mode: "exact", tool: count tool | Orchestrator (Groq / Gemini) | Passed | 100% |
| GLD-012 | Planner sum intent classification | Mode: "exact", tool: `sum_numbers` | Orchestrator (Groq / Gemini) | Passed | 100% |
| GLD-013 | Ambiguous prompt handling ("fix it please") | Generates clarifying questions | Orchestrator | Passed | 100% |
| GLD-014 | Indivisible task (<10 units) | Part count clamped to total units | `calculate_part_count` | Passed | 100% |

---

## 3. Provider Qualification Summary

| Provider | Model | Status | Planner Grade | Worker Grade | Notes |
|---|---|---|---|---|---|
| **Groq** | `openai/gpt-oss-20b` | **HEALTHY** | **A+ (100%)** | **A+ (100%)** | Ultra-fast latency (~320ms p50); primary orchestrator failover target. |
| **GitHub Models** | `openai/gpt-4o-mini` | **HEALTHY** | **A (100%)** | **A (100%)** | Reliable JSON structured output and reasoning. |
| **Google Gemini** | `gemini-3.5-flash` | **DEGRADED (Quota)** | **A** | **A** | Circuit breaker safely isolates to failover when external free-tier daily cap (20 req) is reached. |
| **Gemini Lite** | `gemini-3.1-flash-lite`| **DEGRADED (Quota)** | **A** | **A** | Shares same quota bucket as Gemini primary. |
| **Mistral** | `mistral-small-latest` | **AVAILABLE** | **B+** | **B+** | Configured as backup inference worker. |

---

## 4. Key Takeaways
1. Exact computation tools are completely deterministic and decoupled from LLM hallucinations; all exact tasks achieved 100% accuracy.
2. The dynamic failover in `create_plan` and `get_orchestrator()` successfully recovered from external free-tier quota exhaustion with zero downtime.
