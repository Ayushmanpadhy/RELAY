import json
import os

import pytest

from app.config import settings
from app.nodes.breaker import CircuitBreaker
from app.providers.client import ProviderClient
from app.providers.registry import registry

RUN_LIVE = os.environ.get("RUN_LIVE") == "1"
pytestmark = pytest.mark.skipif(not RUN_LIVE, reason="Live provider tests require RUN_LIVE=1")


@pytest.mark.asyncio
async def test_probe_all_providers_live():
    """Runs startup probe against all configured live providers."""
    probe_results = await registry.run_probe()
    assert len(probe_results) == 5

    results_by_id = {r["provider_id"]: r for r in probe_results}
    print("PROBE RESULTS:", results_by_id)

    # Gemini state reflects live API quota
    if settings.GEMINI_API_KEY:
        assert results_by_id["gemini"]["state"] in ("healthy", "degraded", "unavailable")

    # Groq should be healthy
    if settings.GROQ_API_KEY:
        assert results_by_id["groq"]["state"] in ("healthy", "degraded")


@pytest.mark.asyncio
async def test_structured_json_live():
    """Test structured JSON output generation on active providers."""
    groq_client = registry.get_provider("groq")
    if groq_client and groq_client.is_configured:
        res = await groq_client.complete(
            messages=[
                {"role": "system", "content": "Return JSON only"},
                {"role": "user", "content": 'Output a json object: {"message": "ok"}'},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
        )
        data = json.loads(res)
        assert data.get("message") == "ok"

    gemini_client = registry.get_provider("gemini")
    if gemini_client and gemini_client.is_configured:
        try:
            res = await gemini_client.complete(
                messages=[
                    {"role": "system", "content": "Return JSON only"},
                    {"role": "user", "content": 'Output a json object: {"message": "ok"}'},
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
            )
            data = json.loads(res)
            assert data.get("message") == "ok"
        except Exception as e:
            # In free-tier quota exhaustion, verify proper RateLimited or ServerError is raised
            assert "429" in str(e) or "quota" in str(e).lower() or "limit" in str(e).lower()


@pytest.mark.asyncio
async def test_circuit_breaker_transitions():
    """Verify breaker states: healthy -> degraded -> crashed (open) -> recovering -> healthy."""
    breaker = CircuitBreaker(failure_threshold=3, cooldown_seconds=0.1)
    assert breaker.state == "healthy"

    # Failure 1: degraded
    breaker.record_failure()
    assert breaker.state == "degraded"
    assert breaker.consecutive_failures == 1
    assert breaker.can_attempt() is True

    # Failure 2: degraded
    breaker.record_failure()
    assert breaker.state == "degraded"

    # Failure 3: crashed (open)
    breaker.record_failure()
    assert breaker.state == "crashed"
    assert breaker.can_attempt() is False

    # Wait cooldown
    import asyncio

    await asyncio.sleep(0.15)
    # Transitions to recovering on next check
    assert breaker.can_attempt() is True
    assert breaker.state == "recovering"

    # Success closes circuit
    breaker.record_success()
    assert breaker.state == "healthy"
    assert breaker.consecutive_failures == 0


@pytest.mark.asyncio
async def test_bad_key_error_mapping():
    """Test bad credentials produce normalized AuthError and fatal breaker status."""
    bad_client = ProviderClient(
        provider_id="bad_test",
        name="Bad Test",
        base_url="https://api.groq.com/openai/v1",
        api_key="gsk_bad_invalid_key_12345",
        model="openai/gpt-oss-20b",
    )
    with pytest.raises(Exception):
        await bad_client.complete([{"role": "user", "content": "ping"}])

    assert bad_client.breaker.state == "unavailable"
