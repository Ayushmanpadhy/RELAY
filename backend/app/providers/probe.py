import asyncio
import logging
from typing import Any

import openai

from app.config import settings
from app.providers.client import BadOutput, ModelGone, RateLimited

logger = logging.getLogger("relay.providers.probe")


async def probe_provider(provider_client: Any) -> dict[str, Any]:
    if getattr(provider_client, "is_fake", False) or settings.RELAY_FAKE_PROVIDERS:
        return {
            "provider_id": provider_client.provider_id,
            "name": provider_client.name,
            "state": "healthy",
            "model": provider_client.model,
            "reason": "Fake provider active",
            "available_models": [provider_client.model],
        }

    if not provider_client.is_configured:
        return {
            "provider_id": provider_client.provider_id,
            "name": provider_client.name,
            "state": "unavailable",
            "model": provider_client.model,
            "reason": "API key not configured in .env",
            "available_models": [],
        }

    available_models: list[str] = []
    try:
        # Try listing models if supported with 10s timeout
        try:
            client = provider_client.get_client()
            if client is not None:
                models_list = await asyncio.wait_for(client.models.list(), timeout=10.0)
                available_models = [m.id for m in models_list.data]
                logger.info(
                    "Provider %s reports %d models: %s",
                    provider_client.name,
                    len(available_models),
                    available_models[:8],
                )
        except Exception as e:
            logger.debug(
                "Provider %s models.list() not supported or failed: %s", provider_client.name, e
            )

        # 1-token probe test completion with 15s timeout
        await asyncio.wait_for(
            provider_client.complete(
                messages=[{"role": "user", "content": "ping"}],
                temperature=0.0,
            ),
            timeout=15.0,
        )
        logger.info(
            "Probe SUCCESS for provider %s (model: %s)", provider_client.name, provider_client.model
        )
        provider_client.breaker.reset()
        return {
            "provider_id": provider_client.provider_id,
            "name": provider_client.name,
            "state": "healthy",
            "model": provider_client.model,
            "reason": "Active and responding",
            "available_models": available_models,
        }
    except (RateLimited, openai.RateLimitError) as e:
        retry_after = getattr(e, "retry_after", 60.0)
        logger.warning(
            "Probe DEGRADED (429 rate limit) for %s (%s): %s. Marked DEGRADED, retryAfter=%.1fs",
            provider_client.name,
            provider_client.model,
            e,
            retry_after,
        )
        provider_client.breaker.state = "degraded"
        return {
            "provider_id": provider_client.provider_id,
            "name": provider_client.name,
            "state": "degraded",
            "model": provider_client.model,
            "reason": f"Rate limited (429) - key valid, temporary throttle (retry in {retry_after}s)",
            "retry_after": retry_after,
            "available_models": available_models,
        }
    except asyncio.TimeoutError:
        logger.warning(
            "Probe TIMEOUT for %s (%s) after 15s", provider_client.name, provider_client.model
        )
        provider_client.breaker.record_failure(is_fatal=False)
        return {
            "provider_id": provider_client.provider_id,
            "name": provider_client.name,
            "state": "degraded",
            "model": provider_client.model,
            "reason": "Probe call timed out (15s)",
            "available_models": available_models,
        }
    except openai.AuthenticationError as e:
        logger.warning("Probe AUTH ERROR for %s: %s", provider_client.name, e)
        provider_client.breaker.record_failure(is_fatal=True)
        return {
            "provider_id": provider_client.provider_id,
            "name": provider_client.name,
            "state": "unavailable",
            "model": provider_client.model,
            "reason": f"Auth failed (401): {e}",
            "available_models": available_models,
        }
    except openai.NotFoundError as e:
        logger.warning(
            "Probe MODEL GONE for %s (%s): %s", provider_client.name, provider_client.model, e
        )
        provider_client.breaker.record_failure(is_fatal=True)
        return {
            "provider_id": provider_client.provider_id,
            "name": provider_client.name,
            "state": "unavailable",
            "model": provider_client.model,
            "reason": f"Model retired/not found (404): {provider_client.model}",
            "available_models": available_models,
        }
    except (BadOutput, ModelGone) as e:
        logger.warning(
            "Probe UNAVAILABLE for provider %s (%s): %s",
            provider_client.name,
            provider_client.model,
            e,
        )
        provider_client.breaker.record_failure(is_fatal=True)
        return {
            "provider_id": provider_client.provider_id,
            "name": provider_client.name,
            "state": "unavailable",
            "model": provider_client.model,
            "reason": f"Endpoint or model retired/invalid: {e}",
            "available_models": available_models,
        }
    except Exception as e:
        status_code = getattr(e, "status_code", getattr(e, "raw_status_code", None))
        if status_code == 503 or "503" in str(e) or "high demand" in str(e).lower():
            logger.warning(
                "Probe DEGRADED (503 high demand) for %s (%s): %s",
                provider_client.name,
                provider_client.model,
                e,
            )
            provider_client.breaker.state = "degraded"
            return {
                "provider_id": provider_client.provider_id,
                "name": provider_client.name,
                "state": "degraded",
                "model": provider_client.model,
                "reason": f"High demand / temporary unavailable (503): {e}",
                "retry_after": 30.0,
                "available_models": available_models,
            }
        logger.warning("Probe FAILED for %s: %s", provider_client.name, e)
        provider_client.breaker.record_failure(is_fatal=False)
        return {
            "provider_id": provider_client.provider_id,
            "name": provider_client.name,
            "state": "unavailable",
            "model": provider_client.model,
            "reason": f"Connection/Execution error: {e}",
            "available_models": available_models,
        }
