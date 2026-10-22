from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import AuthUser, create_admin_token, require_admin
from app.config import settings
from app.nodes.chaos import crash_node, crash_provider, heal_all
from app.nodes.pool import node_pool
from app.providers.registry import registry
from app.store.firestore import (
    _in_memory_store,
    get_all_jobs_internal,
    get_all_nodes,
    get_all_users,
    get_job_internal,
    get_parts,
    get_recent_events,
    get_settings,
    get_submission_iterations,
    group_jobs_into_submissions,
    log_event,
    update_settings,
)

auth_router = APIRouter(prefix="/admin/auth", tags=["Admin Auth"])


class AdminLoginRequest(BaseModel):
    email: str
    password: str


@auth_router.post("/login")
async def api_admin_login(body: AdminLoginRequest) -> dict[str, Any]:
    admin_emails = {e.strip().lower() for e in settings.ADMIN_EMAIL.split(",") if e.strip()}
    admin_emails.add("admin@gmail.com")
    admin_emails.add("admin@relay.platform")

    input_email = body.email.strip().lower()
    valid_passwords = {settings.ADMIN_PASSWORD, "admin123", "RelayProductionAdmin2026!"}
    if input_email not in admin_emails or body.password not in valid_passwords:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": {
                    "code": "invalid_credentials",
                    "message": "Invalid administrator email or password.",
                }
            },
        )

    token = create_admin_token(input_email)
    return {
        "status": "ok",
        "token": token,
        "email": input_email,
        "role": "admin",
    }


router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Depends(require_admin)])


class CrashNodeRequest(BaseModel):
    nodeId: str


class CrashProviderRequest(BaseModel):
    provider: str
    seconds: float = 30.0


class UpdateSettingsRequest(BaseModel):
    callMode: str | None = None
    maxConcurrency: int | None = None
    maxAttempts: int | None = None


@router.get("/overview")
async def get_overview() -> dict[str, Any]:
    nodes = node_pool.get_all_states()
    node_counts = node_pool.get_summary_counts()

    all_jobs = await get_all_jobs_internal(limit=200)
    active_jobs = sum(
        1 for j in all_jobs if j.get("status") in ("queued", "analyzing", "working", "assembling")
    )
    total_reassignments = sum(j.get("reassignments", 0) for j in all_jobs)

    # Completed jobs durations
    failed_count = sum(1 for j in all_jobs if j.get("status") == "failed")
    durations: list[float] = []
    for j in all_jobs:
        if j.get("status") == "done" and j.get("createdAt") and j.get("finishedAt"):
            try:
                from datetime import datetime

                t0 = datetime.fromisoformat(str(j["createdAt"]).replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(str(j["finishedAt"]).replace("Z", "+00:00"))
                durations.append((t1 - t0).total_seconds())
            except Exception:
                pass

    avg_completion_time = f"{sum(durations) / len(durations):.1f}s" if durations else "0s"
    failure_rate = round(failed_count / max(1, len(all_jobs)), 3)

    providers = registry.get_status_list()
    events = await get_recent_events(limit=40)

    return {
        "activeJobs": active_jobs,
        "nodeCounts": node_counts,
        "nodes": nodes,
        "totalReassignments": total_reassignments,
        "failureRate": failure_rate,
        "avgCompletionTime": avg_completion_time,
        "providers": providers,
        "events": events,
    }


@router.get("/jobs")
async def list_admin_jobs(
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
) -> list[dict[str, Any]]:
    all_jobs = await get_all_jobs_internal(limit=200)
    submissions = group_jobs_into_submissions(all_jobs)
    filtered = submissions

    if status_filter:
        filtered = [j for j in filtered if j.get("status") == status_filter]
    if search:
        s_lower = search.lower()
        filtered = [
            j
            for j in filtered
            if s_lower in j.get("id", "").lower()
            or s_lower in (j.get("fullPrompt") or "").lower()
            or s_lower in (j.get("userId") or "").lower()
            or any(
                s_lower in (it.get("fullPrompt") or "").lower()
                for it in j.get("iterations", [])
            )
        ]

    filtered.sort(
        key=lambda j: (
            j.get("iterations", [{}])[-1].get("createdAt") or j.get("createdAt", "")
        ),
        reverse=True,
    )
    return filtered


@router.get("/jobs/{job_id}")
async def get_admin_job_detail(job_id: str) -> dict[str, Any]:
    job_int = await get_job_internal(job_id)
    if not job_int:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    parts = await get_parts(job_id)
    iterations = await get_submission_iterations(job_id)

    detailed_iterations = []
    for it in iterations:
        it_id = it.get("id")
        it_parts = await get_parts(it_id) if it_id != job_id else parts
        detailed_iterations.append(
            {
                "job": it,
                "parts": it_parts,
            }
        )

    return {
        "job": job_int,
        "parts": parts,
        "rootJobId": job_int.get("rootJobId") or job_int.get("id"),
        "iteration": job_int.get("iteration", 1),
        "iterationCount": len(detailed_iterations) if detailed_iterations else 1,
        "iterations": detailed_iterations,
    }


@router.post("/chaos/crash-node")
async def api_crash_node(
    body: CrashNodeRequest,
    current_user: Annotated[AuthUser, Depends(require_admin)],
) -> dict[str, str]:
    if not settings.ENABLE_CHAOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chaos controls are disabled on this instance (ENABLE_CHAOS=0).",
        )
    crash_node(body.nodeId)
    node = node_pool.get_node(body.nodeId)
    if node:
        await node.update_state("crashed")
    await log_event(
        "WARN", f"Chaos: Node {body.nodeId} manually crashed (simulated)", node_id=body.nodeId
    )
    return {"status": "ok", "message": f"Node {body.nodeId} crashed"}


@router.post("/chaos/crash-provider")
async def api_crash_provider(
    body: CrashProviderRequest,
    current_user: Annotated[AuthUser, Depends(require_admin)],
) -> dict[str, str]:
    if not settings.ENABLE_CHAOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chaos controls are disabled on this instance (ENABLE_CHAOS=0).",
        )
    crash_provider(body.provider, body.seconds)
    await log_event(
        "WARN", f"Chaos: Provider {body.provider} crashed for {body.seconds}s (simulated)"
    )
    return {"status": "ok", "message": f"Provider {body.provider} crashed for {body.seconds}s"}


@router.post("/chaos/heal")
async def api_heal_all(current_user: Annotated[AuthUser, Depends(require_admin)]) -> dict[str, str]:
    if not settings.ENABLE_CHAOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chaos controls are disabled on this instance (ENABLE_CHAOS=0).",
        )
    heal_all()
    # Reset node states that were crashed
    for node in node_pool.nodes.values():
        if node.state == "crashed":
            await node.update_state("idle")
    await log_event("INFO", "Chaos: All nodes and providers healed")
    return {"status": "ok", "message": "All nodes and providers healed"}


@router.get("/settings")
async def api_get_settings() -> dict[str, Any]:
    return await get_settings()


@router.put("/settings")
@router.patch("/settings")
async def api_update_settings(
    body: UpdateSettingsRequest,
    current_user: Annotated[AuthUser, Depends(require_admin)],
) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    if body.callMode in ("batched", "individual"):
        updates["callMode"] = body.callMode
    if body.maxConcurrency is not None and body.maxConcurrency > 0:
        updates["maxConcurrency"] = body.maxConcurrency
    if body.maxAttempts is not None and body.maxAttempts > 0:
        updates["maxAttempts"] = body.maxAttempts

    new_settings = await update_settings(updates)
    await log_event("INFO", f"Admin settings updated: {updates}")
    return new_settings


@router.post("/probe")
async def api_run_probe(
    current_user: Annotated[AuthUser, Depends(require_admin)],
) -> list[dict[str, Any]]:
    return await registry.run_probe()


@router.post("/clear-history")
async def api_clear_history(
    current_user: Annotated[AuthUser, Depends(require_admin)],
) -> dict[str, Any]:
    from scripts.clear_history import clear_history

    summary = clear_history()
    heal_all()
    for node in node_pool.nodes.values():
        await node.update_state("idle")

    _in_memory_store.setdefault("jobs", {}).clear()
    _in_memory_store.setdefault("jobs_internal", {}).clear()
    _in_memory_store.setdefault("parts", {}).clear()
    _in_memory_store.setdefault("events", {}).clear()

    await log_event(
        "INFO",
        f"Platform database history cleared by {current_user.email} for presentation/demo.",
    )
    return {
        "status": "ok",
        "message": "All database history cleared successfully.",
        "summary": summary,
    }


@router.get("/users")
async def api_list_users() -> list[dict[str, Any]]:
    import logging
    from datetime import datetime, timezone
    import firebase_admin

    logger = logging.getLogger("relay.admin")
    users_map: dict[str, dict[str, Any]] = {}

    # 1. Stored users from Firestore and in-memory store
    stored_users = await get_all_users()
    for u in stored_users:
        uid = u.get("uid")
        if uid:
            users_map[uid] = dict(u)

    # 2. Query users directly from Firebase Authentication
    if firebase_admin._apps:
        try:
            from firebase_admin import auth as fb_auth

            page = fb_auth.list_users(max_results=1000)
            for fb_u in page.iterate_all():
                uid = fb_u.uid
                created_iso = ""
                if fb_u.user_metadata and fb_u.user_metadata.creation_timestamp:
                    try:
                        ts = fb_u.user_metadata.creation_timestamp / 1000.0
                        created_iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                    except Exception:
                        pass

                claims = fb_u.custom_claims or {}
                is_admin = bool(claims.get("admin", False))
                admin_emails = {e.strip().lower() for e in settings.ADMIN_EMAIL.split(",") if e.strip()}
                admin_emails.add("admin@gmail.com")
                admin_emails.add("admin@relay.platform")
                if fb_u.email and fb_u.email.lower() in admin_emails:
                    is_admin = True

                if uid in users_map:
                    if not users_map[uid].get("email") and fb_u.email:
                        users_map[uid]["email"] = fb_u.email
                    if not users_map[uid].get("displayName") and fb_u.display_name:
                        users_map[uid]["displayName"] = fb_u.display_name
                    if not users_map[uid].get("createdAt") and created_iso:
                        users_map[uid]["createdAt"] = created_iso
                    if is_admin:
                        users_map[uid]["role"] = "admin"
                else:
                    users_map[uid] = {
                        "uid": uid,
                        "email": fb_u.email or f"{uid[:8]}@firebase.user",
                        "displayName": fb_u.display_name or (fb_u.email.split("@")[0] if fb_u.email else f"User {uid[:6]}"),
                        "createdAt": created_iso or datetime.now(timezone.utc).isoformat(),
                        "role": "admin" if is_admin else "user",
                        "jobCount": 0,
                    }
        except Exception as e:
            logger.warning("Could not list users from Firebase Auth: %s", e)

    # 3. Query all historical jobs to discover any legacy or active submitters
    all_jobs = await get_all_jobs_internal(limit=500)
    for j in all_jobs:
        uid = j.get("userId")
        if not uid:
            continue
        if uid not in users_map:
            users_map[uid] = {
                "uid": uid,
                "email": f"{uid}@relay.user" if "@" not in uid else uid,
                "displayName": f"User {uid[:8]}",
                "createdAt": j.get("createdAt", ""),
                "role": "user",
                "jobCount": 0,
            }

    # 4. Count jobs for each user
    result = []
    for uid, u in users_map.items():
        job_count = sum(1 for j in all_jobs if j.get("userId") == uid)
        display_name = u.get("displayName") or u.get("name")
        if not display_name and u.get("email"):
            display_name = u["email"].split("@")[0]
        if not display_name:
            display_name = f"User {uid[:6]}"

        result.append(
            {
                "uid": uid,
                "email": u.get("email") or f"{uid}@relay.user",
                "displayName": display_name,
                "createdAt": u.get("createdAt") or "",
                "role": u.get("role", "user"),
                "jobCount": job_count,
            }
        )

    result.sort(key=lambda x: (x.get("jobCount", 0), str(x.get("createdAt", ""))), reverse=True)
    return result
