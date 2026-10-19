import json
import logging
import re
from typing import Any

from app.config import settings
from app.models import JobResult, Part, Plan, ResultFile
from app.providers.registry import registry
from app.tools.registry import tools_registry

logger = logging.getLogger("relay.pipeline.assembler")

ASSEMBLER_SYSTEM_PROMPT = """You are the Relay Assembler.
Your job is to take the reduced partial results from distributed computation and generate a clear, polished, human-friendly response for the user.

CRITICAL RULES:
1. Explain the answer in plain language that directly addresses the user's prompt.
2. NEVER mention technical internals: DO NOT mention nodes, worker pool, providers, models, parts, partitions, tools, splits, or system architecture.
3. If this is an exact numeric computation, you MUST include the exact computed number in the headline and explanation without rounding or changing it.
4. Return ONLY a valid JSON object matching the schema below:

{{
  "headline": "A short, direct headline answer (1 sentence)",
  "explanation": "A clear, helpful explanation of the findings and context (1-3 paragraphs)"
}}
"""


async def assemble_result(job_id: str, prompt: str, plan: Plan, parts: list[Part]) -> JobResult:
    job_upload_dir = settings.UPLOAD_DIR / job_id
    out_dir = job_upload_dir / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    part_outputs = [p.output for p in parts if p.output is not None]

    # Step 1: Reduce
    reduced_data: Any = None
    if plan.mode == "exact" and plan.tool:
        reduced_data = tools_registry.merge(plan.tool, part_outputs)
    elif plan.reduce == "sum":
        total_sum: float = 0.0
        for x in part_outputs:
            if x is None:
                continue
            if isinstance(x, (int, float)):
                total_sum += float(x)
            elif isinstance(x, dict):
                val = x.get("count") or x.get("sum") or x.get("result") or (list(x.values())[0] if x else 0)
                try:
                    total_sum += float(val)
                except Exception:
                    pass
            elif isinstance(x, str):
                nums = re.findall(r"[-+]?\d*\.\d+|\d+", x)
                if nums:
                    total_sum += float(nums[0])
        reduced_data = int(total_sum) if total_sum.is_integer() else round(total_sum, 4)
    elif plan.reduce == "concat":
        reduced_data = "\n".join(str(x) for x in part_outputs if x is not None)
    elif plan.reduce == "merge_counts":
        merged: dict[str, int] = {}
        for r in part_outputs:
            if isinstance(r, dict):
                for k, v in r.items():
                    merged[k] = merged.get(k, 0) + int(v)
        reduced_data = merged
    elif plan.reduce == "llm_synthesis":
        reduced_data = await _hierarchical_synthesis(part_outputs, prompt)
    else:
        reduced_data = part_outputs

    # Convert whole float numbers to clean int
    if isinstance(reduced_data, float) and reduced_data.is_integer():
        reduced_data = int(reduced_data)

    # Step 2: Final Assembler call
    assembler = registry.get_orchestrator()
    exact_str = str(reduced_data)
    exact_formatted = f"{reduced_data:,}" if isinstance(reduced_data, int) else exact_str

    user_msg = f"""User Request: {prompt}
Computed / Reduced Data:
{json.dumps(reduced_data, indent=2) if not isinstance(reduced_data, str) else reduced_data}

Result Style Desired: {plan.resultStyle}
"""
    if plan.mode == "exact":
        user_msg += f"\nIMPORTANT: The exact computed answer is: {exact_str} ({exact_formatted}). You MUST include this exact number ({exact_str} or {exact_formatted}) directly in the headline."

    messages = [
        {"role": "system", "content": ASSEMBLER_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    headline = ""
    explanation = ""
    failed_providers: set[str] = set()

    for attempt in range(len(registry.providers)):
        assembler = registry.get_orchestrator(exclude_providers=failed_providers)
        try:
            resp = await assembler.complete(messages=messages, temperature=0.1)
            clean = (
                resp.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            )
            parsed = json.loads(clean)
            headline = parsed.get("headline", "")
            explanation = parsed.get("explanation", "")

            # Number guard check
            if plan.mode == "exact":
                # Check if exact number appears in headline or explanation (with or without commas)
                if (
                    exact_str in headline
                    or exact_str in explanation
                    or exact_formatted in headline
                    or exact_formatted in explanation
                ):
                    break  # Passed number guard!
                else:
                    logger.warning(
                        "Number guard failed on attempt %d (%s): '%s' not in output",
                        attempt + 1,
                        assembler.name,
                        exact_str,
                    )
                    messages.append({"role": "assistant", "content": resp})
                    messages.append(
                        {
                            "role": "user",
                            "content": f"Correction required: You omitted the exact computed number '{exact_str}' (or {exact_formatted}). Please rewrite including '{exact_str}'.",
                        }
                    )
            else:
                break
        except Exception as e:
            logger.warning("Assembler attempt %d failed on %s: %s", attempt + 1, assembler.name, e)
            failed_providers.add(assembler.provider_id)


    # Fallback if number guard still failed or generation failed
    if plan.mode == "exact" and (
        exact_str not in headline
        and exact_str not in explanation
        and exact_formatted not in headline
        and exact_formatted not in explanation
    ):
        headline = f"The result is {exact_formatted}."
        explanation = (
            f"Analysis completed across your input data. The final computed value is {exact_formatted}."
        )


    if not headline:
        headline = "Task Completed"
        explanation = str(reduced_data)

    # Step 3: Optional report file generation
    result_files: list[ResultFile] = []
    report_file_path = out_dir / "result.md"
    with open(report_file_path, "w", encoding="utf-8") as f:
        f.write(
            f"# Relay Result\n\n## {headline}\n\n{explanation}\n\n### Summary Data\n```json\n{json.dumps(reduced_data, indent=2)}\n```\n"
        )

    result_files.append(
        ResultFile(
            name="result.md",
            size=report_file_path.stat().st_size,
            downloadUrl=f"/api/jobs/{job_id}/files/result.md",
        )
    )

    return JobResult(
        headline=headline,
        explanation=explanation,
        files=result_files,
    )


async def _hierarchical_synthesis(chunks: list[Any], user_prompt: str) -> str:
    if not chunks:
        return ""
    provider = registry.get_orchestrator()
    current_level = [str(c) for c in chunks]

    while len(current_level) > 1:
        next_level = []
        # Batch by 20
        batch_size = 20
        for i in range(0, len(current_level), batch_size):
            batch = current_level[i : i + batch_size]
            prompt = (
                f"Synthesize these findings concisely for the prompt: '{user_prompt}':\n"
                + "\n---\n".join(batch)
            )
            try:
                summary = await provider.complete(
                    [{"role": "user", "content": prompt}], temperature=0.2
                )
                next_level.append(summary)
            except Exception:
                next_level.append("\n".join(batch))
        current_level = next_level

    return current_level[0]
