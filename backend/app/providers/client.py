import asyncio
import logging
import time
from typing import Any

import openai
from openai import AsyncOpenAI

from app.nodes.breaker import CircuitBreaker
from app.nodes.chaos import is_provider_crashed

logger = logging.getLogger("relay.providers.client")


class RelayProviderError(Exception):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class RateLimited(RelayProviderError):
    def __init__(self, retry_after: float = 1.5, message: str = "Rate limited") -> None:
        super().__init__(message, status_code=429)
        self.retry_after = retry_after


class AuthError(RelayProviderError):
    def __init__(self, message: str = "Authentication error") -> None:
        super().__init__(message, status_code=401)


class ModelGone(RelayProviderError):
    def __init__(self, message: str = "Model deprecated or not found") -> None:
        super().__init__(message, status_code=404)


class ServerError(RelayProviderError):
    def __init__(self, message: str = "Provider internal server error") -> None:
        super().__init__(message, status_code=500)


class Timeout(RelayProviderError):
    def __init__(self, message: str = "Provider call timed out") -> None:
        super().__init__(message, status_code=408)


class BadOutput(RelayProviderError):
    def __init__(self, message: str = "Malformed provider output") -> None:
        super().__init__(message)


class ProviderClient:
    def __init__(
        self,
        provider_id: str,
        name: str,
        base_url: str,
        api_key: str,
        model: str,
        concurrency: int = 3,
        min_interval_seconds: float = 0.5,
        rpm_limit: int = 60,
    ) -> None:
        self.provider_id = provider_id
        self.name = name
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self.breaker = CircuitBreaker()
        self.semaphore = asyncio.Semaphore(concurrency)
        self.concurrency = concurrency
        self.min_interval = min_interval_seconds
        self.rpm_limit = rpm_limit
        self.last_call_time = 0.0
        self.call_lock = asyncio.Lock()

        # Metrics
        self.total_calls = 0
        self.failed_calls = 0
        self.rolling_latencies: list[int] = []

        self._client: AsyncOpenAI | None = None
        self._bound_loop: Any = None

    def get_client(self) -> AsyncOpenAI | None:
        if not self.api_key:
            return None
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        if self._client is None or (current_loop and self._bound_loop is not current_loop):
            self._client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=45.0,
                max_retries=0,
            )
            self._bound_loop = current_loop
        return self._client

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.get_client() is not None)

    @property
    def latency_ms(self) -> int:
        if not self.rolling_latencies:
            return 0
        return int(sum(self.rolling_latencies) / len(self.rolling_latencies))

    @property
    def error_rate(self) -> float:
        if self.total_calls == 0:
            return 0.0
        return round(self.failed_calls / self.total_calls, 3)

    def record_latency(self, ms: int) -> None:
        self.rolling_latencies.append(ms)
        if len(self.rolling_latencies) > 20:
            self.rolling_latencies.pop(0)

    async def complete(
        self,
        messages: list[dict[str, Any]],
        response_format: dict[str, Any] | None = None,
        temperature: float = 0.2,
    ) -> str:
        if is_provider_crashed(self.provider_id):
            raise ServerError(f"Simulated chaos failure for provider {self.provider_id}")

        if not self.is_configured:
            raise AuthError(f"Provider {self.provider_id} has no API key configured")

        if not self.breaker.can_attempt():
            raise ServerError(
                f"Circuit breaker open for provider {self.provider_id} ({self.breaker.state})"
            )

        async with self.semaphore:
            # Respect minimum interval rate limit
            async with self.call_lock:
                now = time.time()
                elapsed = now - self.last_call_time
                if elapsed < self.min_interval:
                    await asyncio.sleep(self.min_interval - elapsed)
                self.last_call_time = time.time()

            start_t = time.time()
            self.total_calls += 1
            try:
                client = self.get_client()
                assert client is not None
                kwargs: dict[str, Any] = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": temperature,
                }
                if response_format:
                    kwargs["response_format"] = response_format

                resp = await client.chat.completions.create(**kwargs)
                duration_ms = int((time.time() - start_t) * 1000)
                self.record_latency(duration_ms)
                self.breaker.record_success()

                if hasattr(resp, "choices") and resp.choices:
                    choice = resp.choices[0]
                    content = choice.message.content or ""
                    return content
                elif isinstance(resp, dict) and "choices" in resp and resp["choices"]:
                    content = resp["choices"][0].get("message", {}).get("content", "")
                    return content
                else:
                    raw_val = str(resp).strip()
                    raise BadOutput(
                        f"Provider {self.provider_id} returned non-completion response (service may be retired or endpoint invalid): {raw_val[:100]}"
                    )

            except openai.RateLimitError as e:
                self.failed_calls += 1
                self.breaker.record_failure()
                # Parse Retry-After if available from headers
                retry_after = 60.0
                try:
                    if hasattr(e, "response") and e.response is not None:
                        ra = e.response.headers.get("retry-after")
                        if ra:
                            retry_after = float(ra)
                except Exception:
                    pass
                raise RateLimited(retry_after=retry_after, message=str(e))
            except openai.AuthenticationError as e:
                self.failed_calls += 1
                self.breaker.record_failure(is_fatal=True)
                raise AuthError(str(e))
            except openai.NotFoundError as e:
                self.failed_calls += 1
                self.breaker.record_failure(is_fatal=True)
                raise ModelGone(str(e))
            except openai.APITimeoutError as e:
                self.failed_calls += 1
                self.breaker.record_failure()
                raise Timeout(str(e))
            except openai.APIError as e:
                self.failed_calls += 1
                status_code = getattr(e, "status_code", 500)
                if status_code in (401, 403):
                    self.breaker.record_failure(is_fatal=True)
                    raise AuthError(str(e))
                elif status_code == 404:
                    self.breaker.record_failure(is_fatal=True)
                    raise ModelGone(str(e))
                else:
                    self.breaker.record_failure()
                    raise ServerError(str(e))
            except Exception as e:
                self.failed_calls += 1
                self.breaker.record_failure()
                raise ServerError(f"Unexpected provider error: {e}")
