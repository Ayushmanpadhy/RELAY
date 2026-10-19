import json
import shutil

import pytest

from app.config import settings
from app.models import Manifest
from app.pipeline.intake import _extract_file
from app.pipeline.planner import create_plan
from app.pipeline.scheduler import scheduler
from app.pipeline.splitter import split_job
from app.store.firestore import get_job_public, set_job_internal, set_job_public


@pytest.mark.asyncio
async def test_full_pipeline_fake_providers(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "RELAY_FAKE_PROVIDERS", 1)
    from app.providers.registry import registry

    registry._initialize_providers()

    job_id = "test-job-001"
    job_dir = settings.UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = job_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    extracted_dir = job_dir / "extracted"
    extracted_dir.mkdir(parents=True, exist_ok=True)

    # Generate 1,000 numbers
    numbers = []
    count_9 = 0
    for i in range(1, 1001):
        s = str(i)
        if s.startswith("9"):
            count_9 += 1
        numbers.append(s)

    file_path = raw_dir / "numbers.txt"
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("\n".join(numbers))

    fm, extracted_lines = _extract_file(
        file_path, "numbers.txt", ".txt", "\n".join(numbers).encode("utf-8")
    )
    with open(extracted_dir / "numbers.txt.json", "w", encoding="utf-8") as f:
        json.dump(extracted_lines, f)

    manifest = Manifest(
        files=[fm],
        totalUnits=1000,
        unitKind="numbers",
        summary="1 file, 1,000 numbers",
    )

    # Plan
    plan = await create_plan("count numbers starting with 9", manifest)
    assert plan.mode == "exact"
    assert plan.tool == "count_numbers_starting_with"

    # Split
    parts = await split_job(job_id, plan, manifest)
    assert len(parts) >= 10

    # Store initial jobs
    await set_job_internal(
        job_id,
        {
            "id": job_id,
            "userId": "test-user",
            "fullPrompt": "count numbers starting with 9",
            "plan": plan.model_dump(),
            "status": "working",
            "progress": 20,
            "stepLabel": "Working on it",
            "createdAt": "2026-10-19T00:00:00Z",
        },
    )
    await set_job_public(
        job_id,
        {
            "id": job_id,
            "userId": "test-user",
            "promptPreview": "count numbers starting with 9",
            "status": "working",
            "progress": 20,
            "stepLabel": "Working on it",
            "createdAt": "2026-10-19T00:00:00Z",
        },
    )

    # Run scheduler lifecycle
    await scheduler._run_job_lifecycle(job_id)

    # Verify result
    job_pub = await get_job_public(job_id)
    assert job_pub is not None
    assert job_pub["status"] == "done"
    assert job_pub["progress"] == 100
    assert job_pub["result"] is not None

    headline = job_pub["result"]["headline"]
    explanation = job_pub["result"]["explanation"]
    # Verify the exact ground truth count is in the headline or explanation (Number Guard)
    assert str(count_9) in headline or str(count_9) in explanation

    # Clean up
    shutil.rmtree(job_dir, ignore_errors=True)
