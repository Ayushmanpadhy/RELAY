import asyncio
import json
import logging
import random
from typing import Any

from app.nodes.breaker import CircuitBreaker
from app.nodes.chaos import is_provider_crashed
from app.providers.client import ServerError

logger = logging.getLogger("relay.providers.fake")


class FakeProviderClient:
    def __init__(self, provider_id: str, name: str, model: str) -> None:
        self.provider_id = provider_id
        self.name = name
        self.model = f"fake-{model}"
        self.base_url = "https://fake.relay.local"
        self.breaker = CircuitBreaker()
        self.is_configured = True
        self.total_calls = 0
        self.failed_calls = 0
        self.rolling_latencies: list[int] = [45, 60, 52]

    @property
    def latency_ms(self) -> int:
        return int(sum(self.rolling_latencies) / len(self.rolling_latencies))

    @property
    def error_rate(self) -> float:
        if self.total_calls == 0:
            return 0.0
        return round(self.failed_calls / self.total_calls, 3)

    async def complete(
        self,
        messages: list[dict[str, Any]],
        response_format: dict[str, Any] | None = None,
        temperature: float = 0.2,
    ) -> str:
        self.total_calls += 1
        if is_provider_crashed(self.provider_id):
            self.failed_calls += 1
            self.breaker.record_failure()
            raise ServerError(f"Simulated chaos failure for fake provider {self.provider_id}")

        if not self.breaker.can_attempt():
            self.failed_calls += 1
            raise ServerError(f"Circuit breaker open for fake provider {self.provider_id}")

        # Simulate small latency
        await asyncio.sleep(random.uniform(0.02, 0.08))

        prompt_text = " ".join([m.get("content", "") for m in messages])

        # Planner fake
        if "You are the Relay AI Orchestrator" in prompt_text or "Plan schema" in prompt_text:
            plan_json: dict[str, Any]
            if (
                "start with 9" in prompt_text.lower()
                or "count" in prompt_text.lower()
                or "number" in prompt_text.lower()
            ):
                plan_json = {
                    "intent": "Count numbers starting with the digit 9",
                    "mode": "exact",
                    "tool": "count_numbers_starting_with",
                    "toolArgs": {"prefix": "9"},
                    "instruction": None,
                    "outputSchema": None,
                    "splitStrategy": "lines",
                    "partCountHint": 100,
                    "reduce": "sum",
                    "resultStyle": "exact numeric",
                    "clarifyingQuestions": [],
                }
            else:
                plan_json = {
                    "intent": "Analyze and summarize documents",
                    "mode": "ai",
                    "tool": None,
                    "toolArgs": {},
                    "instruction": "Extract key complaints and sentiments",
                    "outputSchema": {
                        "type": "object",
                        "properties": {
                            "complaints": {"type": "array", "items": {"type": "string"}}
                        },
                    },
                    "splitStrategy": "lines",
                    "partCountHint": 20,
                    "reduce": "llm_synthesis",
                    "resultStyle": "bulleted summary",
                    "clarifyingQuestions": [],
                }
            self.breaker.record_success()
            return json.dumps(plan_json)

        # Assembler fake
        if "You are the Relay Assembler" in prompt_text:
            # Check if there is an exact number in the prompt
            import re

            numbers = re.findall(r"\b\d+\b", prompt_text)
            headline_val = numbers[-1] if numbers else "Complete"
            ans = {
                "headline": f"Found {headline_val} items matching your criteria.",
                "explanation": f"All data was verified and analyzed across worker nodes. The final result is {headline_val}.",
                "files": [],
            }
            self.breaker.record_success()
            return json.dumps(ans)

        # Worker part fake
        if "complaints" in prompt_text.lower():
            out = {"complaints": ["Slow load times", "Missing export option"]}
            self.breaker.record_success()
            return json.dumps(out)

        self.breaker.record_success()
        return json.dumps({"status": "ok", "summary": "Sample slice processed successfully."})
