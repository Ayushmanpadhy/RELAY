import uuid
import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from app.models import FileManifest, Manifest, Plan
from app.pipeline.splitter import split_job


@settings(deadline=None, max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    st.lists(
        st.text(alphabet=st.characters(blacklist_categories=("Cs",)), min_size=1, max_size=50),
        min_size=1,
        max_size=200,
    )
)
@pytest.mark.asyncio
async def test_splitter_property_lines_union_equals_input(lines):
    """Property test: Union of all parts must exactly reconstruct original lines in order."""
    import json
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.config import settings as app_settings

    with tempfile.TemporaryDirectory() as tmp_str:
        tmp_path = Path(tmp_str)
        job_id = f"test-job-prop-{uuid.uuid4().hex[:6]}"
        job_dir = tmp_path / job_id
        parts_dir = job_dir / "parts"
        parts_dir.mkdir(parents=True, exist_ok=True)
        extracted_dir = job_dir / "extracted"
        extracted_dir.mkdir(parents=True, exist_ok=True)

        with open(extracted_dir / "test.txt.json", "w", encoding="utf-8") as f:
            json.dump(lines, f)

        manifest = Manifest(
            files=[
                FileManifest(
                    name="test.txt",
                    type="txt",
                    bytes=sum(len(line_item.encode("utf-8")) for line_item in lines),
                    units=len(lines),
                    unitKind="lines",
                    preview="",
                )
            ],
            totalUnits=len(lines),
            unitKind="lines",
            summary=f"1 file, {len(lines)} lines",
        )

        plan = Plan(
            intent="Summarize lines",
            mode="ai",
            tool=None,
            toolArgs={},
            instruction="Summarize",
            outputSchema=None,
            splitStrategy="lines",
            partCountHint=25,
            reduce="llm_synthesis",
            resultStyle="bulleted",
            clarifyingQuestions=[],
        )

        with patch.object(app_settings, "UPLOAD_DIR", tmp_path):
            parts = await split_job(job_id, plan, manifest)

        assert 1 <= len(parts) <= 100

        # Reconstruct lines from all parts
        reconstructed: list[str] = []
        for p in parts:
            part_file = p.inputRef.get("partFile")
            assert part_file is not None
            with open(part_file, "r", encoding="utf-8") as pf:
                part_lines = json.load(pf)
                reconstructed.extend(part_lines)

        # Invariant: Reconstructed lines equal original lines exactly
        assert reconstructed == lines
