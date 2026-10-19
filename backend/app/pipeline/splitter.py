import json
import logging
import math
import re

from app.config import settings
from app.models import Manifest, Part, Plan
from app.store.firestore import set_part

logger = logging.getLogger("relay.pipeline.splitter")


async def split_job(
    job_id: str, plan: Plan, manifest: Manifest, prompt: str = ""
) -> list[Part]:
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
    part_count = max(10, min(100, plan.partCount))
    parts: list[Part] = []

    # Check for numeric range task (e.g. "from 1 to 10000000")
    m_range = re.search(r"(?:from\s+)?(\d+)\s+(?:to|-)\s+(\d+)", prompt, re.IGNORECASE)
    is_range_task = bool(
        m_range and (plan.tool == "count_range_matching" or total_items == 0)
    )

    if is_range_task and m_range:
        total_start = int(m_range.group(1))
        total_end = int(m_range.group(2))
        if total_start > total_end:
            total_start, total_end = total_end, total_start

        m_start = re.search(r"start(?:s|ing)?\s+with\s+(\d+)", prompt, re.IGNORECASE)
        m_end = re.search(r"end(?:s|ing)?\s+with\s+(\d+)", prompt, re.IGNORECASE)
        prefix = m_start.group(1) if m_start else str(plan.toolArgs.get("prefix", ""))
        suffix = m_end.group(1) if m_end else str(plan.toolArgs.get("suffix", ""))

        total_span = total_end - total_start + 1
        step = math.ceil(total_span / part_count)

        for i in range(part_count):
            part_id = f"part-{i + 1:03d}"
            slice_start = total_start + i * step
            if i == part_count - 1:
                slice_end = total_end
            else:
                slice_end = min(total_end, total_start + (i + 1) * step - 1)

            part_args = {
                "start": slice_start,
                "end": max(slice_start, slice_end),
                "prefix": prefix,
                "suffix": suffix,
            }
            part_file = parts_dir / f"{part_id}.json"
            with open(part_file, "w", encoding="utf-8") as pf:
                json.dump([f"Range: {slice_start} to {slice_end}"], pf)

            part = Part(
                partId=part_id,
                idx=i + 1,
                size=max(0, slice_end - slice_start + 1),
                execution="tool",
                tool="count_range_matching",
                toolArgs=part_args,
                instruction=f"Calculate range {slice_start} to {slice_end} for prefix='{prefix}' suffix='{suffix}'",
                inputRef={
                    "partFile": str(part_file),
                    "range": [slice_start, slice_end],
                    "toolArgs": part_args,
                },
                status="queued",
            )
            parts.append(part)
            await set_part(job_id, part_id, part.model_dump())

        logger.info(
            "Split range [%d, %d] into %d parts across nodes",
            total_start,
            total_end,
            len(parts),
        )
        return parts

    # Prompt-only task without files and without numeric range
    if total_items == 0:
        for i in range(part_count):
            part_id = f"part-{i + 1:03d}"
            part_file = parts_dir / f"{part_id}.json"
            with open(part_file, "w", encoding="utf-8") as pf:
                json.dump([prompt], pf)

            slice_instruction = (
                f"Facet {i + 1} of {part_count}: {plan.instruction or prompt}"
            )
            part = Part(
                partId=part_id,
                idx=i + 1,
                size=1,
                execution="tool" if plan.mode == "exact" and plan.tool else "ai",
                tool=plan.tool if plan.mode == "exact" else None,
                toolArgs=plan.toolArgs if plan.mode == "exact" else {},
                instruction=slice_instruction,
                inputRef={
                    "partFile": str(part_file),
                    "facet": i + 1,
                    "totalParts": part_count,
                },
                status="queued",
            )
            parts.append(part)
            await set_part(job_id, part_id, part.model_dump())

        logger.info(
            "Split prompt task into %d distributed parts (no files)", len(parts)
        )
        return parts

    # File-based partition (all_items > 0)
    chunk_size = math.ceil(total_items / part_count)
    for i in range(part_count):
        part_id = f"part-{i + 1:03d}"
        start_idx = i * chunk_size
        end_idx = min(start_idx + chunk_size, total_items)

        if start_idx < total_items:
            chunk = all_items[start_idx:end_idx]
        else:
            # Distribute wrap-around if items < parts
            chunk = [all_items[i % total_items]]

        if header_line and manifest.unitKind == "rows" and (not chunk or chunk[0] != header_line):
            chunk = [header_line] + chunk

        part_file = parts_dir / f"{part_id}.json"
        with open(part_file, "w", encoding="utf-8") as pf:
            json.dump(chunk, pf)

        part = Part(
            partId=part_id,
            idx=i + 1,
            size=len(chunk),
            execution="tool" if plan.mode == "exact" and plan.tool else "ai",
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

    logger.info("Split job %s into %d parts across nodes", job_id, len(parts))
    return parts

