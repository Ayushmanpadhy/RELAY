import os
import shutil
import time
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.auth import AuthUser, get_current_user, get_current_user_from_header_or_query
from app.config import settings
from app.models import JobInternal, JobPublic
from app.pipeline.intake import IntakeError, process_intake
from app.pipeline.planner import create_plan
from app.pipeline.scheduler import scheduler
from app.pipeline.splitter import split_job
from app.store.firestore import (
    _in_memory_store,
    get_job_internal,
    get_job_public,
    log_event,
    set_job_internal,
    set_job_public,
)

router = APIRouter(prefix="/jobs", tags=["Jobs"])

# User submission rate limiting: uid -> list of timestamps
_user_submissions: dict[str, list[float]] = {}
MAX_JOBS_PER_HOUR = 10


def check_rate_limit(uid: str) -> None:
    now = time.time()
    hour_ago = now - 3600
    times = [t for t in _user_submissions.get(uid, []) if t > hour_ago]
    if len(times) >= MAX_JOBS_PER_HOUR:
        oldest = min(times)
        retry_after = int(3600 - (now - oldest))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": {
                    "code": "rate_limited",
                    "message": f"Rate limit reached. Try again in {retry_after} seconds.",
                }
            },
            headers={"Retry-After": str(retry_after)},
        )
    times.append(now)
    _user_submissions[uid] = times


class ClarifyRequest(BaseModel):
    answers: list[str]


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_job(
    prompt: Annotated[str, Form()],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    files: list[UploadFile] = [],
    parent_job_id: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    check_rate_limit(current_user.uid)

    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "empty_prompt", "message": "Prompt cannot be empty"}},
        )

    job_id = f"job-{int(time.time() * 1000)}-{os.urandom(3).hex()}"
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    prompt_preview = clean_prompt[:120] + ("..." if len(clean_prompt) > 120 else "")

    try:
        manifest = None
        saved_paths: list[str] = []

        # Check if follow-up on existing dataset
        parent_job: JobInternal | None = None
        if parent_job_id:
            parent_raw = await get_job_internal(parent_job_id)
            if parent_raw and parent_raw.get("userId") == current_user.uid:
                try:
                    parent_job = JobInternal.model_validate(parent_raw)
                except Exception:
                    parent_job = None

        if parent_job and not files:
            # Reuse dataset from parent job
            parent_dir = settings.UPLOAD_DIR / parent_job_id
            job_upload_dir = settings.UPLOAD_DIR / job_id
            job_upload_dir.mkdir(parents=True, exist_ok=True)
            if (parent_dir / "raw").exists():
                shutil.copytree(parent_dir / "raw", job_upload_dir / "raw", dirs_exist_ok=True)
            if (parent_dir / "extracted").exists():
                shutil.copytree(
                    parent_dir / "extracted", job_upload_dir / "extracted", dirs_exist_ok=True
                )
            if (parent_dir / "manifest.json").exists():
                shutil.copy2(parent_dir / "manifest.json", job_upload_dir / "manifest.json")
            manifest = parent_job.manifest
            saved_paths = list(parent_job.files)
        else:
            # Step 1: Intake
            manifest, saved_paths = await process_intake(job_id, files)

        # Contextualize prompt if parent job exists
        effective_prompt = clean_prompt
        if parent_job:
            context_header = f"[Context: User follow-up on previous task '{parent_job.fullPrompt}'"
            if parent_job.result and parent_job.result.headline:
                context_header += f" where previous answer was '{parent_job.result.headline}'"
            context_header += "]"
            effective_prompt = f"{context_header}\nRequested Changes / Follow-up: {clean_prompt}"

        # Step 2: Plan
        plan = await create_plan(effective_prompt, manifest)

        # Check clarifying questions
        has_questions = len(plan.clarifyingQuestions) > 0
        initial_status: Literal[
            "queued", "analyzing", "working", "assembling", "done", "failed"
        ] = "analyzing" if has_questions else "working"
        initial_label = "Waiting for clarification" if has_questions else "Working on it"

        # Step 3: Split into parts
        parts = await split_job(job_id, plan, manifest)

        # Step 4: Write records
        job_int = JobInternal(
            id=job_id,
            userId=current_user.uid,
            fullPrompt=clean_prompt,
            files=saved_paths,
            manifest=manifest,
            plan=plan,
            partCount=len(parts),
            mode=plan.mode,
            status=initial_status,
            progress=15,
            stepLabel=initial_label,
            createdAt=created_at,
        )
        await set_job_internal(job_id, job_int.model_dump())

        job_pub = JobPublic(
            id=job_id,
            userId=current_user.uid,
            promptPreview=prompt_preview,
            status=initial_status,
            progress=15,
            stepLabel=initial_label,
            createdAt=created_at,
            clarifyingQuestions=plan.clarifyingQuestions,
            fileCount=len(manifest.files) if manifest else 0,
        )
        await set_job_public(job_id, job_pub.model_dump())

        await log_event(
            "INFO",
            f"Job {job_id} submitted by {current_user.email} ({plan.mode} mode, {len(parts)} parts)",
            job_id=job_id,
        )

        # Start execution if no clarification required
        if not has_questions:
            scheduler.start_job(job_id)

        return {"jobId": job_id, "status": initial_status, "partCount": len(parts)}

    except IntakeError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "intake_error", "message": str(e)}},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": {"code": "pipeline_error", "message": f"Failed to initialize job: {e}"}
            },
        )


@router.get("")
async def list_my_jobs(
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> list[dict[str, Any]]:
    # Read from in-memory / Firestore store user-safe jobs
    all_jobs = list(_in_memory_store.get("jobs", {}).values())
    user_jobs = [j for j in all_jobs if j.get("userId") == current_user.uid]
    user_jobs.sort(key=lambda j: j.get("createdAt", ""), reverse=True)
    return user_jobs


@router.get("/{job_id}")
async def get_job(
    job_id: str, current_user: Annotated[AuthUser, Depends(get_current_user)]
) -> dict[str, Any]:
    job_pub = await get_job_public(job_id)
    if not job_pub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": "Job not found"}},
        )

    # Security check: User can only read their own job unless admin
    if job_pub.get("userId") != current_user.uid and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "forbidden", "message": "Access denied"}},
        )

    # Return USER-SAFE view only: never contain plan, parts, nodes, providers, tools or raw errors
    return {
        "id": job_pub.get("id"),
        "status": job_pub.get("status"),
        "progress": job_pub.get("progress", 0),
        "stepLabel": job_pub.get("stepLabel", ""),
        "createdAt": job_pub.get("createdAt"),
        "finishedAt": job_pub.get("finishedAt"),
        "result": job_pub.get("result"),
        "promptPreview": job_pub.get("promptPreview"),
        "clarifyingQuestions": job_pub.get("clarifyingQuestions", []),
    }


@router.post("/{job_id}/clarify")
async def answer_clarification(
    job_id: str,
    body: ClarifyRequest,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    job_int = await get_job_internal(job_id)
    if not job_int:
        raise HTTPException(status_code=404, detail="Job not found")

    if job_int.get("userId") != current_user.uid and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")

    # Resume execution with answers incorporated
    job_int["clarifyingAnswers"] = body.answers
    job_int["status"] = "working"
    job_int["stepLabel"] = "Working on it"
    await set_job_internal(job_id, job_int)

    pub = await get_job_public(job_id) or {}
    pub["status"] = "working"
    pub["stepLabel"] = "Working on it"
    pub["clarifyingQuestions"] = []
    await set_job_public(job_id, pub)

    scheduler.start_job(job_id)
    return {"status": "working"}


@router.get("/{job_id}/files/{file_name}")
async def download_file(
    job_id: str,
    file_name: str,
    current_user: Annotated[AuthUser, Depends(get_current_user_from_header_or_query)],
) -> Response:
    job_pub = await get_job_public(job_id)
    if not job_pub:
        raise HTTPException(status_code=404, detail="Job not found")

    if job_pub.get("userId") != current_user.uid and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")

    # Prevent directory traversal
    clean_name = os.path.basename(file_name)
    target_path = settings.UPLOAD_DIR / job_id / "out" / clean_name

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(path=target_path, filename=clean_name)
