import asyncio
import json
import logging
import os
import sys
import time
from typing import Any, cast

import firebase_admin
from firebase_admin import credentials, firestore

from app.config import settings

logger = logging.getLogger("relay.store")

_db: Any = None
_db_connected: bool = False
_db_status: str = "NOT_INITIALIZED"
_db_error_reason: str = ""
_db_action_url: str = ""
_db_error_logged: bool = False
_offline_suppressed_count: int = 0
_last_offline_log_time: float = 0.0

_in_memory_store: dict[str, dict[str, Any]] = {
    "users": {},
    "jobs": {},
    "jobs_internal": {},
    "parts": {},  # key: f"{job_id}:{part_id}"
    "nodes": {},
    "providers": {},
    "events": {},
    "settings": {
        "runtime": {
            "callMode": "batched",
            "maxConcurrency": settings.GLOBAL_CONCURRENCY,
            "maxAttempts": settings.MAX_ATTEMPTS,
        }
    },
}


def classify_firestore_error(e: Exception, project_id: str) -> tuple[str, str, str]:
    """
    Classifies a Firestore exception into (status_code, clean_reason, action_url).
    Never returns raw gRPC metadata dumps.
    """
    msg = str(e)
    # Check for SERVICE_DISABLED
    if (
        "SERVICE_DISABLED" in msg
        or "has not been used in project" in msg
        or "it is disabled" in msg
    ):
        url = (
            f"https://console.developers.google.com/apis/api/firestore.googleapis.com/overview"
            f"?project={project_id}"
        )
        reason = (
            f"Cloud Firestore API has not been enabled for Google Cloud project '{project_id}'."
        )
        return ("SERVICE_DISABLED", reason, url)

    # Check for DATABASE_NOT_FOUND
    if (
        "NOT_FOUND" in msg
        or ("database" in msg.lower() and "does not exist" in msg.lower())
    ):
        url = f"https://console.firebase.google.com/project/{project_id}/firestore"
        reason = (
            f"Cloud Firestore database '(default)' was not found in project '{project_id}'."
        )
        return ("DATABASE_NOT_FOUND", reason, url)

    # Check for PERMISSION_DENIED
    if "PERMISSION_DENIED" in msg or "403" in msg or "permission" in msg.lower():
        url = f"https://console.cloud.google.com/iam-admin/iam?project={project_id}"
        reason = (
            f"Service account lacks required permissions (Cloud Datastore User or Firestore Admin) "
            f"in project '{project_id}'."
        )
        return ("PERMISSION_DENIED", reason, url)

    # Check for UNAVAILABLE
    if "UNAVAILABLE" in msg or "503" in msg or "deadline exceeded" in msg.lower():
        return ("UNAVAILABLE", "Firestore service is temporarily unavailable.", "")

    clean_snippet = msg.split("\n")[0][:180]
    return ("UNAVAILABLE", f"Firestore error: {clean_snippet}", "")


def firestore_self_test(client: Any, project_id: str) -> tuple[bool, str, str, str]:
    """
    Startup Firestore self-test: write, read and delete a document _health/ping.
    Returns: (success, status_code, clean_reason, action_url)
    """
    try:
        ping_ref = client.collection("_health").document("ping")
        # 1. Write
        ping_ref.set({"ts": time.time(), "test": "startup_self_test"})
        # 2. Read
        doc = ping_ref.get()
        if not doc.exists:
            return (
                False,
                "UNAVAILABLE",
                "Firestore self-test ping write did not persist.",
                "",
            )
        # 3. Delete
        ping_ref.delete()
        return (True, "ONLINE", "Cloud Firestore connected and self-test passed.", "")
    except Exception as e:
        status, reason, url = classify_firestore_error(e, project_id)
        return (False, status, reason, url)


def is_firestore_connected() -> bool:
    return _db_connected and _db is not None


def get_firestore_diagnostic() -> dict[str, Any]:
    return {
        "connected": is_firestore_connected(),
        "mode": "firestore" if is_firestore_connected() else "in_memory",
        "status": _db_status,
        "reason": _db_error_reason,
        "action_url": _db_action_url,
    }


def _log_offline_suppressed(action: str = "write") -> None:
    global _offline_suppressed_count, _last_offline_log_time
    _offline_suppressed_count += 1
    now = time.time()
    if now - _last_offline_log_time >= 60.0:
        logger.warning(
            "Firestore offline (%d retries/skips); skipping %s",
            _offline_suppressed_count,
            action,
        )
        _offline_suppressed_count = 0
        _last_offline_log_time = now


def init_firestore() -> Any:
    global _db, _db_connected, _db_status, _db_error_reason, _db_action_url, _db_error_logged
    if _db is not None and _db_connected:
        return _db

    if (
        _db_status
        in (
            "SERVICE_DISABLED",
            "DATABASE_NOT_FOUND",
            "PERMISSION_DENIED",
            "PROJECT_MISMATCH",
            "CREDENTIALS_INVALID",
        )
        and not _db_connected
    ):
        return None

    cred_path = os.path.abspath(settings.GOOGLE_APPLICATION_CREDENTIALS)

    if settings.RELAY_FIREBASE_EMULATOR:
        logger.info("Initializing Firestore with Firebase Emulator")
        try:
            if not firebase_admin._apps:
                firebase_admin.initialize_app()
            _db = firestore.client()
            _db_connected = True
            _db_status = "ONLINE"
            return _db
        except Exception as e:
            logger.warning("Failed to connect to Firebase emulator: %s. Using in-memory store.", e)
            _db_connected = False
            _db_status = "UNAVAILABLE"
            return None

    if not os.path.exists(cred_path):
        _db_status = "CREDENTIALS_INVALID"
        _db_error_reason = f"Firebase credentials file not found at {cred_path}"
        if not _db_error_logged:
            logger.warning("%s. Operating with in-memory fallback.", _db_error_reason)
            _db_error_logged = True
        return None

    try:
        with open(cred_path, "r", encoding="utf-8") as f:
            sa_data = json.load(f)
    except Exception as e:
        _db_status = "CREDENTIALS_INVALID"
        _db_error_reason = f"Failed to parse Firebase credentials JSON: {e}"
        if not _db_error_logged:
            logger.warning("%s. Operating with in-memory fallback.", _db_error_reason)
            _db_error_logged = True
        return None

    # Check for dummy placeholder
    if (
        "placeholder_private_key_id" in str(sa_data)
        or "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6..." in str(sa_data)
    ):
        _db_status = "CREDENTIALS_INVALID"
        _db_error_reason = "Placeholder Firebase service account detected."
        if not _db_error_logged:
            logger.warning("%s Operating with in-memory fallback.", _db_error_reason)
            _db_error_logged = True
        return None

    # Check for PROJECT_MISMATCH
    sa_project = sa_data.get("project_id", "")
    if sa_project and settings.FIREBASE_PROJECT_ID and sa_project != settings.FIREBASE_PROJECT_ID:
        _db_status = "PROJECT_MISMATCH"
        _db_error_reason = (
            f"Service account project_id ('{sa_project}') does not match "
            f"FIREBASE_PROJECT_ID ('{settings.FIREBASE_PROJECT_ID}')."
        )
        if not _db_error_logged:
            logger.error("\n" + "=" * 70 + f"\nFIRESTORE CONFIGURATION ERROR [{_db_status}]\n{_db_error_reason}\n" + "=" * 70)
            _db_error_logged = True
        if settings.APP_ENV == "production":
            sys.exit(1)
        return None

    try:
        cred = credentials.Certificate(cred_path)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred, {"projectId": settings.FIREBASE_PROJECT_ID})
        client = firestore.client()
    except Exception as e:
        status, reason, url = classify_firestore_error(e, settings.FIREBASE_PROJECT_ID)
        _db_status = status
        _db_error_reason = reason
        _db_action_url = url
        if not _db_error_logged:
            logger.error("Could not initialize Firestore client: %s", reason)
            if url:
                logger.error("Action URL: %s", url)
            _db_error_logged = True
        if settings.APP_ENV == "production":
            sys.exit(1)
        return None

    # Run startup self-test ping
    success, status, reason, url = firestore_self_test(client, settings.FIREBASE_PROJECT_ID)
    if success:
        _db = client
        _db_connected = True
        _db_status = "ONLINE"
        _db_error_reason = ""
        _db_action_url = ""
        logger.info("Connected to real Firestore project: %s (Self-test passed)", settings.FIREBASE_PROJECT_ID)
        return _db
    else:
        _db = None
        _db_connected = False
        _db_status = status
        _db_error_reason = reason
        _db_action_url = url
        if not _db_error_logged:
            banner = [
                "=" * 70,
                f"FIRESTORE SELF-TEST FAILED [{status}]",
                f"Reason: {reason}",
            ]
            if url:
                banner.append(f"Activation / Configuration URL:\n  {url}")
            banner.append("Operating in explicit 'database not connected' mode (in-memory store).")
            banner.append("=" * 70)
            logger.warning("\n" + "\n".join(banner))
            _db_error_logged = True

        if settings.APP_ENV == "production":
            logger.critical("Cloud Firestore is required in production. Exiting non-zero.")
            sys.exit(1)
        return None


class BatchedFirestoreWriter:
    def __init__(self) -> None:
        self.queue: list[
            tuple[str, str, dict[str, Any], bool]
        ] = []  # (collection, doc_id, data, merge)
        self.lock = asyncio.Lock()
        self.last_flush = time.time()
        self._flush_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._flush_task is None:
            self._flush_task = asyncio.create_task(self._periodic_flush())

    async def stop(self) -> None:
        if self._flush_task is not None:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
        await self.flush()

    async def _periodic_flush(self) -> None:
        while True:
            await asyncio.sleep(0.5)
            await self.flush()

    async def enqueue(
        self, collection: str, doc_id: str, data: dict[str, Any], merge: bool = True
    ) -> None:
        # Always update memory store immediately for fast reads
        col_map = _in_memory_store.setdefault(collection, {})
        if merge and doc_id in col_map and isinstance(col_map[doc_id], dict):
            col_map[doc_id].update(data)
        else:
            col_map[doc_id] = dict(data)

        async with self.lock:
            # Resilient bounded queue: cap at 500 items
            if len(self.queue) >= 500:
                # Drop oldest telemetry event first
                dropped = False
                for idx, (col, _, _, _) in enumerate(self.queue):
                    if col == "events":
                        self.queue.pop(idx)
                        dropped = True
                        break
                if not dropped:
                    self.queue.pop(0)
                logger.warning("BatchedFirestoreWriter queue full (cap: 500). Dropped oldest telemetry event.")

            self.queue.append((collection, doc_id, data, merge))

    async def flush(self) -> None:
        async with self.lock:
            if not self.queue:
                return
            items = list(self.queue)
            self.queue.clear()
            self.last_flush = time.time()

        if not is_firestore_connected():
            init_firestore()
            if not is_firestore_connected():
                _log_offline_suppressed("batch flush")
                return

        db = _db
        if db is None:
            return

        try:
            # Batch writes into Firestore batches of max 400
            for i in range(0, len(items), 400):
                batch = db.batch()
                chunk = items[i : i + 400]
                for col, doc_id, data, merge in chunk:
                    doc_ref = db.collection(col).document(doc_id)
                    batch.set(doc_ref, data, merge=merge)
                batch.commit()
        except Exception as e:
            _log_offline_suppressed("batch commit")


writer = BatchedFirestoreWriter()


# High-level store operations
async def set_user(uid: str, data: dict[str, Any]) -> None:
    await writer.enqueue("users", uid, data, merge=True)


async def get_user(uid: str) -> dict[str, Any] | None:
    if is_firestore_connected() and _db is not None:
        try:
            doc = _db.collection("users").document(uid).get()
            if doc.exists:
                return cast(dict[str, Any] | None, doc.to_dict())
        except Exception:
            _log_offline_suppressed("get user")
    return cast(dict[str, Any] | None, _in_memory_store.get("users", {}).get(uid))


async def set_job_public(job_id: str, data: dict[str, Any]) -> None:
    await writer.enqueue("jobs", job_id, data, merge=True)


async def set_job_internal(job_id: str, data: dict[str, Any]) -> None:
    await writer.enqueue("jobs_internal", job_id, data, merge=True)


async def get_job_public(job_id: str) -> dict[str, Any] | None:
    if is_firestore_connected() and _db is not None:
        try:
            doc = _db.collection("jobs").document(job_id).get()
            if doc.exists:
                return cast(dict[str, Any] | None, doc.to_dict())
        except Exception:
            _log_offline_suppressed("get public job")
    return cast(dict[str, Any] | None, _in_memory_store.get("jobs", {}).get(job_id))


async def get_job_internal(job_id: str) -> dict[str, Any] | None:
    if is_firestore_connected() and _db is not None:
        try:
            doc = _db.collection("jobs_internal").document(job_id).get()
            if doc.exists:
                return cast(dict[str, Any] | None, doc.to_dict())
        except Exception:
            _log_offline_suppressed("get internal job")
    return cast(dict[str, Any] | None, _in_memory_store.get("jobs_internal", {}).get(job_id))


async def set_part(job_id: str, part_id: str, data: dict[str, Any]) -> None:
    key = f"{job_id}:{part_id}"
    _in_memory_store.setdefault("parts", {})[key] = dict(data)
    if is_firestore_connected() and _db is not None:
        try:
            _db.collection("jobs_internal").document(job_id).collection("parts").document(
                part_id
            ).set(data, merge=True)
        except Exception:
            _log_offline_suppressed("set part")


async def get_parts(job_id: str) -> list[dict[str, Any]]:
    if is_firestore_connected() and _db is not None:
        try:
            docs = (
                _db.collection("jobs_internal")
                .document(job_id)
                .collection("parts")
                .order_by("idx")
                .stream()
            )
            res = [d.to_dict() for d in docs]
            if res:
                return res
        except Exception:
            _log_offline_suppressed("stream parts")
    prefix = f"{job_id}:"
    matching = [v for k, v in _in_memory_store.get("parts", {}).items() if k.startswith(prefix)]
    matching.sort(key=lambda p: p.get("idx", 0))
    return matching


async def set_node(node_id: str, data: dict[str, Any]) -> None:
    await writer.enqueue("nodes", node_id, data, merge=True)


async def get_all_nodes() -> list[dict[str, Any]]:
    if is_firestore_connected() and _db is not None:
        try:
            docs = _db.collection("nodes").stream()
            res = [d.to_dict() for d in docs]
            if res:
                return res
        except Exception:
            _log_offline_suppressed("stream nodes")
    nodes = list(_in_memory_store.get("nodes", {}).values())
    nodes.sort(key=lambda n: n.get("nodeId", ""))
    return nodes


async def set_provider(provider_id: str, data: dict[str, Any]) -> None:
    await writer.enqueue("providers", provider_id, data, merge=True)


async def get_all_providers() -> list[dict[str, Any]]:
    if is_firestore_connected() and _db is not None:
        try:
            docs = _db.collection("providers").stream()
            res = [d.to_dict() for d in docs]
            if res:
                return res
        except Exception:
            _log_offline_suppressed("stream providers")
    return list(_in_memory_store.get("providers", {}).values())


async def log_event(
    level: str, message: str, job_id: str | None = None, node_id: str | None = None
) -> None:
    event_id = f"evt-{int(time.time() * 1000)}-{os.urandom(3).hex()}"
    event_data = {
        "eventId": event_id,
        "ts": time.time(),
        "level": level,
        "message": message,
        "jobId": job_id,
        "nodeId": node_id,
    }
    # Maintain rolling window of 500 in memory
    events = _in_memory_store.setdefault("events", {})
    events[event_id] = event_data
    if len(events) > 500:
        oldest_key = min(events.keys(), key=lambda k: events[k]["ts"])
        del events[oldest_key]

    await writer.enqueue("events", event_id, event_data, merge=False)


async def get_recent_events(limit: int = 50) -> list[dict[str, Any]]:
    evts = list(_in_memory_store.get("events", {}).values())
    evts.sort(key=lambda e: e.get("ts", 0), reverse=True)
    return evts[:limit]


async def get_settings() -> dict[str, Any]:
    return cast(
        dict[str, Any],
        _in_memory_store.get("settings", {}).get(
            "runtime",
            {
                "callMode": "batched",
                "maxConcurrency": settings.GLOBAL_CONCURRENCY,
                "maxAttempts": settings.MAX_ATTEMPTS,
            },
        ),
    )


async def update_settings(data: dict[str, Any]) -> dict[str, Any]:
    current = await get_settings()
    current.update(data)
    _in_memory_store.setdefault("settings", {})["runtime"] = current
    await writer.enqueue("settings", "runtime", current, merge=True)
    return current


def _acquire_in_memory_lease(instance_id: str, duration_sec: float, now: float) -> bool:
    lease = _in_memory_store.setdefault("settings", {}).setdefault("scheduler_lease", {})
    holder = lease.get("holder")
    expires_at = lease.get("expiresAt", 0.0)
    if holder and holder != instance_id and now < expires_at:
        return False
    lease["holder"] = instance_id
    lease["expiresAt"] = now + duration_sec
    lease["heartbeat"] = now
    return True


async def try_acquire_scheduler_lease(instance_id: str, duration_sec: float = 15.0) -> bool:
    now = time.time()
    if not is_firestore_connected():
        # Firestore is not connected; use in-memory lease directly without throwing errors
        return _acquire_in_memory_lease(instance_id, duration_sec, now)

    db = _db
    if db is not None:
        try:
            doc_ref = db.collection("settings").document("scheduler_lease")
            snapshot = doc_ref.get()
            if snapshot.exists:
                data = snapshot.to_dict() or {}
                holder = data.get("holder")
                expires_at = data.get("expiresAt", 0.0)
                if holder and holder != instance_id and now < expires_at:
                    return False
            doc_ref.set(
                {"holder": instance_id, "expiresAt": now + duration_sec, "heartbeat": now},
                merge=True,
            )
            return True
        except Exception:
            _log_offline_suppressed("lease acquire")

    return _acquire_in_memory_lease(instance_id, duration_sec, now)


async def renew_scheduler_lease(instance_id: str, duration_sec: float = 15.0) -> bool:
    return await try_acquire_scheduler_lease(instance_id, duration_sec)


async def release_scheduler_lease(instance_id: str) -> None:
    now = time.time()
    if is_firestore_connected() and _db is not None:
        try:
            doc_ref = _db.collection("settings").document("scheduler_lease")
            snapshot = doc_ref.get()
            if snapshot.exists and (snapshot.to_dict() or {}).get("holder") == instance_id:
                doc_ref.set({"holder": None, "expiresAt": 0.0, "heartbeat": now}, merge=True)
        except Exception:
            _log_offline_suppressed("lease release")

    lease = _in_memory_store.setdefault("settings", {}).setdefault("scheduler_lease", {})
    if lease.get("holder") == instance_id:
        lease["holder"] = None
        lease["expiresAt"] = 0.0
