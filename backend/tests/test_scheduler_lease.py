import asyncio
import pytest
from app.config import settings
from app.pipeline.scheduler import Scheduler
from app.store.firestore import (
    try_acquire_scheduler_lease,
    renew_scheduler_lease,
    release_scheduler_lease,
    _in_memory_store,
    set_job_internal,
    get_job_internal,
)
from app.models import JobInternal, Manifest, Plan


@pytest.mark.asyncio
async def test_scheduler_lease_mutual_exclusion():
    """Verify distributed lease lock ensures only one instance can lead."""
    _in_memory_store.setdefault("settings", {})["scheduler_lease"] = {}

    inst_a = "instance-node-A"
    inst_b = "instance-node-B"

    # Instance A acquires lease
    acquired_a = await try_acquire_scheduler_lease(inst_a, duration_sec=2.0)
    assert acquired_a is True

    # Instance B cannot acquire while active lease held by A
    acquired_b = await try_acquire_scheduler_lease(inst_b, duration_sec=2.0)
    assert acquired_b is False

    # Instance A renews successfully
    renewed_a = await renew_scheduler_lease(inst_a, duration_sec=2.0)
    assert renewed_a is True

    # Instance A releases lease
    await release_scheduler_lease(inst_a)

    # Now Instance B can acquire
    acquired_b2 = await try_acquire_scheduler_lease(inst_b, duration_sec=2.0)
    assert acquired_b2 is True

    # Clean up
    await release_scheduler_lease(inst_b)


@pytest.mark.asyncio
async def test_scheduler_standby_refusal():
    """Verify scheduler in standby refuses execution and leaves job in queued state."""
    _in_memory_store.setdefault("settings", {})["scheduler_lease"] = {}

    # Leader holds lease
    await try_acquire_scheduler_lease("other-leader", duration_sec=10.0)

    # Secondary scheduler
    sec_scheduler = Scheduler()
    sec_scheduler.instance_id = "standby-worker-1"
    sec_scheduler.is_leader = False

    job_id = "job-test-standby-01"
    job_int = {
        "id": job_id,
        "userId": "user-123",
        "fullPrompt": "Test standby refusal",
        "status": "queued",
        "progress": 0,
        "stepLabel": "Queued",
        "createdAt": "2026-10-19T10:00:00Z",
    }
    await set_job_internal(job_id, job_int)

    # Attempt to start job on standby instance
    await sec_scheduler._run_job_with_watchdog(job_id)

    # Check that job status remained standby/queued without crash
    updated = await get_job_internal(job_id)
    assert updated is not None
    assert updated["status"] == "queued"
    assert "Standby" in updated["stepLabel"]

    # Clean up
    await release_scheduler_lease("other-leader")


@pytest.mark.asyncio
async def test_scheduler_watchdog_timeout(monkeypatch):
    """Verify watchdog terminates hung jobs cleanly with friendly user message."""
    _in_memory_store.setdefault("settings", {})["scheduler_lease"] = {}

    test_scheduler = Scheduler()
    test_scheduler.instance_id = "test-watchdog-leader"
    test_scheduler.is_leader = True

    # Artificially lower watchdog timeout to 0.1s
    monkeypatch.setattr(settings, "JOB_TIMEOUT_SECONDS", 0.1)

    job_id = "job-test-timeout-01"
    job_int = {
        "id": job_id,
        "userId": "user-456",
        "fullPrompt": "Simulated hung task",
        "status": "working",
        "progress": 20,
        "stepLabel": "Working on it",
        "createdAt": "2026-10-19T10:00:00Z",
    }
    await set_job_internal(job_id, job_int)

    # Simulate an infinite loop / stall in _run_job_lifecycle
    async def mock_hung_lifecycle(j_id: str):
        await asyncio.sleep(2.0)

    monkeypatch.setattr(test_scheduler, "_run_job_lifecycle", mock_hung_lifecycle)

    # Run with watchdog
    await test_scheduler._run_job_with_watchdog(job_id)

    # Verify job failed cleanly
    updated = await get_job_internal(job_id)
    assert updated is not None
    assert updated["status"] == "failed"
    assert updated["progress"] == 100
    assert updated["stepLabel"] == "Timed out"
    assert "Job timed out" in updated.get("error", "")

    # Clean up
    await release_scheduler_lease(test_scheduler.instance_id)
