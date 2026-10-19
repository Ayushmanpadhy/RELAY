import asyncio
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.config import Settings
from app.providers.client import ProviderClient, RateLimited
from app.providers.probe import probe_provider
from app.store.firestore import (
    BatchedFirestoreWriter,
    classify_firestore_error,
    firestore_self_test,
    get_firestore_diagnostic,
    is_firestore_connected,
    try_acquire_scheduler_lease,
)


@pytest.mark.asyncio
async def test_firestore_error_classification():
    # 1. SERVICE_DISABLED
    err_msg = Exception("403 Cloud Firestore API has not been used in project relay before or it is disabled [SERVICE_DISABLED]")
    code, reason, url = classify_firestore_error(err_msg, "relay")
    assert code == "SERVICE_DISABLED"
    assert "relay" in url
    assert "https://console.developers.google.com" in url

    # 2. DATABASE_NOT_FOUND
    err_msg = Exception("404 Database (default) does not exist [NOT_FOUND]")
    code, reason, url = classify_firestore_error(err_msg, "relay")
    assert code == "DATABASE_NOT_FOUND"
    assert "https://console.firebase.google.com/project/relay/firestore" in url

    # 3. PERMISSION_DENIED
    err_msg = Exception("403 Missing permissions [PERMISSION_DENIED]")
    code, reason, url = classify_firestore_error(err_msg, "relay")
    assert code == "PERMISSION_DENIED"
    assert "iam" in url


@pytest.mark.asyncio
async def test_firestore_self_test_mocked():
    # Mock firestore client that succeeds
    mock_client = MagicMock()
    mock_doc = MagicMock()
    mock_client.collection.return_value.document.return_value = mock_doc
    mock_snapshot = MagicMock()
    mock_snapshot.exists = True
    mock_doc.get.return_value = mock_snapshot

    success, code, reason, url = firestore_self_test(mock_client, "relay")
    assert success is True
    assert code == "ONLINE"
    mock_doc.set.assert_called_once()
    mock_doc.delete.assert_called_once()


@pytest.mark.asyncio
async def test_bounded_firestore_writer_queue():
    writer = BatchedFirestoreWriter()
    # Fill writer queue with 500 events
    for i in range(500):
        await writer.enqueue("events", f"evt-{i}", {"ts": i, "val": i}, merge=False)
    assert len(writer.queue) == 500

    # Add core job state
    await writer.enqueue("jobs", "job-core-1", {"status": "working"}, merge=True)
    # Queue length remains 500 (bounded)
    assert len(writer.queue) == 500
    # Oldest event evt-0 was dropped, while job-core-1 is present
    queue_cols = [item[0] for item in writer.queue]
    assert "jobs" in queue_cols
    assert writer.queue[-1][1] == "job-core-1"


@pytest.mark.asyncio
async def test_atomic_lease_fallback_offline():
    # Test lease acquire operates seamlessly when Firestore is offline
    instance_id = "test-worker-node-1"
    acquired = await try_acquire_scheduler_lease(instance_id, duration_sec=5.0)
    assert acquired is True

    # Another instance cannot acquire while active
    acquired_other = await try_acquire_scheduler_lease("other-node-2", duration_sec=5.0)
    assert acquired_other is False

    # Same instance can renew
    acquired_same = await try_acquire_scheduler_lease(instance_id, duration_sec=5.0)
    assert acquired_same is True


@pytest.mark.asyncio
async def test_provider_client_max_retries_and_rate_limit():
    client = ProviderClient(
        provider_id="test_mistral",
        name="Test Mistral",
        base_url="https://api.mistral.ai/v1",
        api_key="test_key",
        model="mistral-small-latest",
        concurrency=1,
        min_interval_seconds=1.1,
        rpm_limit=60,
    )
    # Verify AsyncOpenAI created with max_retries=0
    oa_client = client.get_client()
    assert oa_client.max_retries == 0

    # Verify 429 classified as degraded in probe
    with patch.object(client, "complete", side_effect=RateLimited(retry_after=45.0, message="Rate limit exceeded")):
        res = await probe_provider(client)
        assert res["state"] == "degraded"
        assert res["retry_after"] == 45.0
        assert client.breaker.state == "degraded"


def test_gemini_models_distinct_validation():
    # Fails if identical
    with pytest.raises(ValueError, match="GEMINI_MODEL and GEMINI_LITE_MODEL must be distinct models"):
        Settings(
            GEMINI_API_KEY="test_key",
            GEMINI_MODEL="gemini-3.6-flash",
            GEMINI_LITE_MODEL="gemini-3.6-flash",
        )

    # Passes if distinct
    s = Settings(
        GEMINI_API_KEY="test_key",
        GEMINI_MODEL="gemini-3.6-flash",
        GEMINI_LITE_MODEL="gemini-3.5-flash-lite",
    )
    assert s.GEMINI_MODEL != s.GEMINI_LITE_MODEL
