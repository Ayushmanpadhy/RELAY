import json
import logging
import math

from app.config import settings
from app.models import Manifest, Part, Plan
from app.store.firestore import set_part

logger = logging.getLogger("relay.pipeline.splitter")


async def split_job(job_id: str, plan: Plan, manifest: Manifest) -> list[Part]:
    job_upload_dir = settings.UPLOAD_DIR / job_id
    extracted_dir = job_upload_dir / "extracted"
    parts_dir = job_upload_dir / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)

    # Collect all extracted items from all files
    all_items: list[str] = []
    header_line: str | None = None

    for f in manifest.files:
        safe_name = f.name
        f_path = extracted_dir / f"{safe_name}.json"
        if f_path.exists():
            with open(f_path, "r", encoding="utf-8") as file:
                lines: list[str] = json.load(file)
                if f.unitKind == "rows" and lines:
                    if header_line is None:
                        header_line = lines[0]
                    # Data rows
                    all_items.extend(lines[1:] if len(lines) > 1 else lines)
                else:
                    all_items.extend(lines)

    total_items = len(all_items)
    part_count = plan.partCount
    if total_items == 0:
        total_items = 1
        all_items = [""]

    chunk_size = math.ceil(total_items / part_count)
    parts: list[Part] = []

    for i in range(part_count):
        part_id = f"part-{i + 1:03d}"
        start_idx = i * chunk_size
        end_idx = min(start_idx + chunk_size, total_items)

        if start_idx >= total_items:
            break

        chunk = all_items[start_idx:end_idx]
        # If rows, prepend the header line for CSV tools
        if header_line and manifest.unitKind == "rows" and (not chunk or chunk[0] != header_line):
            chunk = [header_line] + chunk

        # Save slice to disk
        part_file = parts_dir / f"{part_id}.json"
        with open(part_file, "w", encoding="utf-8") as pf:
            json.dump(chunk, pf)

        part = Part(
            partId=part_id,
            idx=i + 1,
            size=len(chunk),
            execution="tool" if plan.mode == "exact" else "ai",
            tool=plan.tool if plan.mode == "exact" else None,
            toolArgs=plan.toolArgs if plan.mode == "exact" else {},
            instruction=plan.instruction if plan.mode == "ai" else None,
            inputRef={
                "partFile": str(part_file),
                "itemCount": len(chunk),
                "range": [start_idx, end_idx],
            },
            status="queued",
        )
        parts.append(part)
        await set_part(job_id, part_id, part.model_dump())

    logger.info("Split job %s into %d parts (items per part ~%d)", job_id, len(parts), chunk_size)
    return parts
