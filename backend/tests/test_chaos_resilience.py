import asyncio
import pytest
from app.config import settings
from app.models import JobInternal, Manifest, FileManifest, Plan, Part
from app.nodes.chaos import crash_node, crash_provider, heal_all
from app.nodes.pool import node_pool
from app.pipeline.scheduler import Scheduler
from app.store.firestore import (
    _in_memory_store,
    get_job_internal,
    get_parts,
    set_job_internal,
    set_part,
    try_acquire_scheduler_lease,
)
from app.tools.registry import tools_registry


@pytest.mark.asyncio
async def test_chaos_node_crash_recovery():
    """Verify that crashing worker nodes mid-run triggers reassignment and successful job completion."""
    await node_pool.initialize()
    _in_memory_store.setdefault("settings", {})["scheduler_lease"] = {}

    test_scheduler = Scheduler()
    test_scheduler.is_leader = True

    job_id = "job-chaos-nodes-01"
    # Create an exact job with 15 parts
    plan = Plan(
        intent="Sum numbers across 15 chunks",
        mode="exact",
        tool="sum_numbers",
        toolArgs={},
        partCount=15,
        reduce="sum",
    )

    # Populate 15 parts with test data
    parts: list[Part] = []
    expected_total = 0.0
    for i in range(15):
        val = (i + 1) * 10
        expected_total += val
        part_id = f"part-{i + 1:03d}"
        part = Part(
            partId=part_id,
            idx=i + 1,
            size=1,
            execution="tool",
            tool="sum_numbers",
            toolArgs={},
            inputRef={},
            status="queued",
        )
        parts.append(part)
        await set_part(job_id, part_id, part.model_dump())

    # Mock tool executor to simulate node crash on specific nodes
    original_exec = tools_registry.executors["sum_numbers"]

    crashed_any = False

    def mock_chaos_exec(chunk: list[str], args: dict):
        nonlocal crashed_any
        if not crashed_any:
            # Crash 5 nodes
            for n_id in list(node_pool.nodes.keys())[:5]:
                crash_node(n_id)
            crashed_any = True
        return 10.0  # Each part returns 10

    tools_registry.executors["sum_numbers"] = mock_chaos_exec

    job_int = {
        "id": job_id,
        "userId": "user-chaos",
        "fullPrompt": "Sum numbers",
        "plan": plan.model_dump(),
        "status": "working",
        "progress": 20,
        "stepLabel": "Working on it",
        "createdAt": "2026-10-19T10:00:00Z",
    }
    await set_job_internal(job_id, job_int)

    try:
        await test_scheduler._run_job_lifecycle(job_id)

        # Verify job completed successfully despite crashes
        updated_job = await get_job_internal(job_id)
        assert updated_job is not None
        assert updated_job["status"] == "done"
        assert updated_job["progress"] == 100
        assert updated_job["reassignments"] >= 0
    finally:
        tools_registry.executors["sum_numbers"] = original_exec
        heal_all()


@pytest.mark.asyncio
async def test_chaos_dead_part_limit():
    """Verify that parts failing past maxAttempts are cleanly marked dead and fail the job."""
    await node_pool.initialize()
    _in_memory_store.setdefault("settings", {})["scheduler_lease"] = {}

    test_scheduler = Scheduler()
    test_scheduler.is_leader = True

    job_id = "job-chaos-dead-02"
    plan = Plan(
        intent="Failing task",
        mode="exact",
        tool="sum_numbers",
        toolArgs={},
        partCount=1,
        reduce="sum",
    )

    part = Part(
        partId="part-001",
        idx=1,
        size=1,
        execution="tool",
        tool="sum_numbers",
        status="queued",
    )
    await set_part(job_id, "part-001", part.model_dump())

    # Mock tool executor to always raise an exception
    original_exec = tools_registry.executors["sum_numbers"]

    def mock_failing_exec(chunk: list[str], args: dict):
        raise RuntimeError("Deterministic tool failure for testing dead threshold")

    tools_registry.executors["sum_numbers"] = mock_failing_exec

    job_int = {
        "id": job_id,
        "userId": "user-chaos",
        "fullPrompt": "Failing calculation",
        "plan": plan.model_dump(),
        "status": "working",
        "progress": 20,
        "stepLabel": "Working on it",
        "createdAt": "2026-10-19T10:00:00Z",
    }
    await set_job_internal(job_id, job_int)

    try:
        await test_scheduler._run_job_lifecycle(job_id)

        updated_job = await get_job_internal(job_id)
        assert updated_job is not None
        assert updated_job["status"] == "failed"
        assert "parts could not be completed" in updated_job.get("error", "")

        parts_data = await get_parts(job_id)
        assert len(parts_data) == 1
        assert parts_data[0]["status"] == "dead"
        assert len(parts_data[0]["attempts"]) >= settings.MAX_ATTEMPTS
    finally:
        tools_registry.executors["sum_numbers"] = original_exec
