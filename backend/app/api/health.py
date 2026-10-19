from typing import Any

from fastapi import APIRouter

from app.pipeline.scheduler import scheduler
from app.providers.registry import registry
from app.store.firestore import get_all_nodes, get_firestore_diagnostic

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("")
async def get_health() -> dict[str, Any]:
    providers_status = registry.get_status_list()
    any_healthy = any(p.get("state") in ("healthy", "recovering") for p in providers_status)
    db_diag = get_firestore_diagnostic()

    all_nodes = await get_all_nodes()
    idle_count = sum(1 for n in all_nodes if n.get("status") == "idle")
    working_count = sum(1 for n in all_nodes if n.get("status") == "working")
    crashed_count = sum(1 for n in all_nodes if n.get("status") == "crashed")

    overall_status = "healthy" if (any_healthy and db_diag.get("connected")) else "degraded"

    return {
        "status": overall_status,
        "version": "4.0.0",
        "database": db_diag,
        "providers": providers_status,
        "nodes": {
            "total": len(all_nodes),
            "idle": idle_count,
            "working": working_count,
            "crashed": crashed_count,
        },
        "scheduler": {
            "isLeader": scheduler.is_leader,
            "instanceId": scheduler.instance_id,
        },
    }


@router.get("/ready")
async def get_ready() -> dict[str, Any]:
    return {"status": "ready", "version": "4.0.0"}
