import asyncio
import logging
from typing import Any

from app.config import settings
from app.providers.client import ProviderClient
from app.providers.fake import FakeProviderClient
from app.providers.probe import probe_provider
from app.store.firestore import log_event, set_provider

logger = logging.getLogger("relay.providers.registry")


class ProviderRegistry:
    def __init__(self) -> None:
        self.providers: dict[str, Any] = {}
        self.round_robin_idx = 0
        self.lock = asyncio.Lock()
        self._initialize_providers()

    def _initialize_providers(self) -> None:
        if settings.RELAY_FAKE_PROVIDERS:
            logger.info("RELAY_FAKE_PROVIDERS enabled. Initializing fake clients.")
            self.providers = {
                "gemini": FakeProviderClient("gemini", "Gemini", settings.GEMINI_MODEL),
                "groq": FakeProviderClient("groq", "Groq", settings.GROQ_MODEL),
                "mistral": FakeProviderClient("mistral", "Mistral", settings.MISTRAL_MODEL),
                "github": FakeProviderClient("github", "GitHub Models", settings.GITHUB_MODEL),
                "gemini_lite": FakeProviderClient(
                    "gemini_lite", "Gemini Lite", settings.GEMINI_LITE_MODEL
                ),
            }
            return

        self.providers = {
            "gemini": ProviderClient(
                provider_id="gemini",
                name="Gemini",
                base_url=settings.GEMINI_BASE_URL,
                api_key=settings.GEMINI_API_KEY,
                model=settings.GEMINI_MODEL,
                concurrency=3,
                min_interval_seconds=0.5,
                rpm_limit=60,
            ),
            "groq": ProviderClient(
                provider_id="groq",
                name="Groq",
                base_url=settings.GROQ_BASE_URL,
                api_key=settings.GROQ_API_KEY,
                model=settings.GROQ_MODEL,
                concurrency=3,
                min_interval_seconds=0.2,
                rpm_limit=30,
            ),
            "gemini_lite": ProviderClient(
                provider_id="gemini_lite",
                name="Gemini Lite",
                base_url=settings.GEMINI_BASE_URL,
                api_key=settings.GEMINI_API_KEY,
                model=settings.GEMINI_LITE_MODEL,
                concurrency=3,
                min_interval_seconds=0.5,
                rpm_limit=60,
            ),
        }
        if getattr(settings, "OPENROUTER_API_KEY", ""):
            self.providers["openrouter"] = ProviderClient(
                provider_id="openrouter",
                name="OpenRouter",
                base_url=settings.OPENROUTER_BASE_URL,
                api_key=settings.OPENROUTER_API_KEY,
                model=settings.OPENROUTER_MODEL,
                concurrency=3,
                min_interval_seconds=0.5,
                rpm_limit=60,
            )
        if settings.MISTRAL_API_KEY:
            self.providers["mistral"] = ProviderClient(
                provider_id="mistral",
                name="Mistral",
                base_url=settings.MISTRAL_BASE_URL,
                api_key=settings.MISTRAL_API_KEY,
                model=settings.MISTRAL_MODEL,
                concurrency=1,
                min_interval_seconds=1.1,
                rpm_limit=60,
            )
        if settings.GITHUB_TOKEN:
            self.providers["github"] = ProviderClient(
                provider_id="github",
                name="GitHub Models",
                base_url=settings.GITHUB_BASE_URL,
                api_key=settings.GITHUB_TOKEN,
                model=settings.GITHUB_MODEL,
                concurrency=2,
                min_interval_seconds=0.5,
                rpm_limit=60,
            )

    def get_provider(self, provider_id: str) -> Any | None:
        return self.providers.get(provider_id)

    def get_orchestrator(self, exclude_providers: set[str] | list[str] | None = None) -> Any:
        excluded = set(exclude_providers or [])
        gemini = self.providers.get("gemini")
        if gemini and gemini.breaker.state == "healthy" and gemini.provider_id not in excluded:
            return gemini

        # If gemini is not fully healthy or excluded, choose any configured healthy provider
        for p in self.providers.values():
            if p.breaker.state == "healthy" and p.is_configured and p.provider_id not in excluded:
                return p

        # Fallback to degraded if no healthy provider exists
        if gemini and gemini.provider_id not in excluded and (
            gemini.breaker.state in ("recovering", "degraded") or settings.RELAY_FAKE_PROVIDERS
        ):
            return gemini
        for p in self.providers.values():
            if (
                p.provider_id not in excluded
                and p.breaker.state in ("recovering", "degraded")
                and p.is_configured
            ):
                return p

        # If all candidates excluded, fallback to any configured provider that can attempt
        for p in self.providers.values():
            if p.is_configured and p.breaker.can_attempt():
                return p

        return gemini or next(iter(self.providers.values()))

    def get_healthy_providers(self) -> list[Any]:
        healthy = []
        for p in self.providers.values():
            if not p.is_configured and not settings.RELAY_FAKE_PROVIDERS:
                continue
            if p.breaker.can_attempt():
                healthy.append(p)
        return healthy

    async def get_next_worker_provider(self, exclude_provider: str | None = None) -> Any | None:
        async with self.lock:
            healthy = self.get_healthy_providers()
            if not healthy:
                return None

            if exclude_provider and len(healthy) > 1:
                candidate_pool = [p for p in healthy if p.provider_id != exclude_provider]
                if candidate_pool:
                    healthy = candidate_pool

            self.round_robin_idx = (self.round_robin_idx + 1) % len(healthy)
            return healthy[self.round_robin_idx]

    async def run_probe(self) -> list[dict[str, Any]]:
        results = []
        for pid, client in self.providers.items():
            res = await probe_provider(client)
            results.append(res)
            # Sync to Firestore
            await set_provider(
                pid,
                {
                    "id": pid,
                    "name": client.name,
                    "model": client.model,
                    "state": res["state"],
                    "reason": res.get("reason", ""),
                    "latencyMs": client.latency_ms,
                    "errorRate": client.error_rate,
                    "circuit": client.breaker.state,
                },
            )
            if res["state"] == "unavailable":
                await log_event(
                    "WARN", f"Provider {client.name} is unavailable: {res.get('reason')}"
                )
            else:
                await log_event("INFO", f"Provider {client.name} is online and healthy")

        # Format and log single clean startup summary table
        border = "+" + "-" * 17 + "+" + "-" * 25 + "+" + "-" * 12 + "+" + "-" * 11 + "+" + "-" * 11 + "+"
        lines = [
            border,
            f"| {'Provider':<15} | {'Model':<23} | {'Status':<10} | {'Latency':<9} | {'RPM Limit':<9} |",
            border,
        ]
        for res in results:
            client = self.providers[res["provider_id"]]
            status = "ONLINE"
            if res["state"] == "degraded":
                status = "DEGRADED"
            elif res["state"] == "unavailable":
                if "not configured" in res.get("reason", "").lower():
                    status = "DISABLED"
                else:
                    status = "FAILED"
            lat = f"{client.latency_ms}ms" if client.latency_ms > 0 else "-"
            rpm = f"{getattr(client, 'rpm_limit', 60)}"
            lines.append(
                f"| {client.name:<15} | {client.model:<23} | {status:<10} | {lat:<9} | {rpm:<9} |"
            )
        lines.append(border)
        logger.info("\nAI Provider Probe Summary:\n%s", "\n".join(lines))

        return results

    def get_status_list(self) -> list[dict[str, Any]]:
        return [
            {
                "id": p.provider_id,
                "name": p.name,
                "model": p.model,
                "state": "unavailable" if not p.is_configured else p.breaker.state,
                "latencyMs": p.latency_ms,
                "errorRate": p.error_rate,
                "circuit": p.breaker.state,
                "rpmLimit": getattr(p, "rpm_limit", 60),
                "concurrency": getattr(p, "concurrency", 3),
            }
            for p in self.providers.values()
        ]


registry = ProviderRegistry()
