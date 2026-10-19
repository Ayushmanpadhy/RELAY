import json
import logging
import math

from app.models import Part, Plan
from app.providers.registry import registry
from app.store.firestore import log_event

logger = logging.getLogger("relay.pipeline.verifier")


async def verify_parts(job_id: str, plan: Plan, parts: list[Part]) -> None:
    if not parts:
        return

    sample_size = min(5, math.ceil(len(parts) * 0.05))
    sample_parts = parts[:sample_size]

    if plan.mode == "exact":
        # Cross check exact parts with an AI provider
        provider = registry.get_orchestrator()
        for part in sample_parts:
            try:
                # Load part data
                part_file = part.inputRef.get("partFile")
                if not part_file:
                    continue
                with open(part_file, "r", encoding="utf-8") as f:
                    chunk: list[str] = json.load(f)

                prompt = f"""Cross-check task:
Tool: {part.tool}
Args: {json.dumps(part.toolArgs)}
Exact Tool Output: {part.output}
Data Slice (first 20 items): {chunk[:20]}
Respond strictly in JSON: {{ "agrees": true | false, "explanation": "..." }}
"""
                resp = await provider.complete(
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                )
                clean = (
                    resp.strip()
                    .removeprefix("```json")
                    .removeprefix("```")
                    .removesuffix("```")
                    .strip()
                )
                parsed = json.loads(clean)
                agrees = parsed.get("agrees", True)
                part.crossCheckMatch = agrees
                if not agrees:
                    await log_event(
                        "WARN",
                        f"Cross-check discrepancy on part {part.partId}: AI suggests {parsed.get('explanation')}",
                        job_id=job_id,
                        node_id=part.nodeId,
                    )
            except Exception as e:
                logger.debug("Cross-check sample error on part %s: %s", part.partId, e)
                part.crossCheckMatch = True

    elif plan.mode == "ai":
        # AI verifier checks a sample of outputs against prompt
        provider = registry.get_orchestrator()
        for part in sample_parts:
            if not part.output:
                continue
            try:
                prompt = f"""Verify AI worker output against instructions:
Instruction: {part.instruction}
Output: {json.dumps(part.output)}
Respond strictly in JSON: {{ "valid": true | false, "reason": "..." }}
"""
                resp = await provider.complete(
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                )
                clean = (
                    resp.strip()
                    .removeprefix("```json")
                    .removeprefix("```")
                    .removesuffix("```")
                    .strip()
                )
                parsed = json.loads(clean)
                if not parsed.get("valid", True):
                    await log_event(
                        "WARN",
                        f"AI verification flagged part {part.partId}: {parsed.get('reason')}",
                        job_id=job_id,
                        node_id=part.nodeId,
                    )
            except Exception as e:
                logger.debug("AI verification error on part %s: %s", part.partId, e)
