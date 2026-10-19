import logging
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, health, jobs, users
from app.config import settings
from app.nodes.pool import node_pool
from app.pipeline.scheduler import scheduler
from app.providers.registry import registry
from app.store.firestore import (
    _in_memory_store,
    get_all_jobs_internal,
    get_parts,
    init_firestore,
    set_part,
    writer,
)


# Configure logging with secret redaction filter
class SecretRedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = str(record.msg)
        for key in (
            settings.GEMINI_API_KEY,
            settings.GROQ_API_KEY,
            settings.MISTRAL_API_KEY,
            settings.GITHUB_TOKEN,
        ):
            if key and len(key) > 6 and key in msg:
                msg = msg.replace(key, f"***{key[-4:]}")
        record.msg = msg
        return True


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
for handler in logging.root.handlers:
    handler.addFilter(SecretRedactionFilter())

logger = logging.getLogger("relay.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Relay v4 backend starting up...")

    # Initialize store and batch writer
    init_firestore()
    await writer.start()

    # Initialize 100 worker nodes
    await node_pool.initialize()

    # Run startup provider probe
    logger.info("Executing startup provider probe...")
    await registry.run_probe()

    # Resume unfinished jobs
    all_jobs = await get_all_jobs_internal(limit=100)
    logger.info("Loaded %d jobs from Firestore.", len(all_jobs))
    for j in all_jobs:
        job_id = j.get("id")
        status = j.get("status")
        if status in ("working", "analyzing", "queued") and job_id:
            logger.info("Resuming unfinished job %s...", job_id)
            parts = await get_parts(job_id)
            for p in parts:
                if p.get("status") == "running":
                    p["status"] = "queued"
                    await set_part(job_id, p["partId"], p)
            scheduler.start_job(job_id)

    # Start scheduler leader lease maintenance
    await scheduler.start()

    logger.info("Relay v4 backend startup complete.")
    yield

    logger.info("Shutting down Relay v4 backend...")
    await scheduler.stop()
    await writer.stop()
    logger.info("Relay backend shutdown finished.")


app = FastAPI(
    title="Relay: Distributed AI Task Platform",
    version="4.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routers
app.include_router(health.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(admin.auth_router, prefix="/api")
app.include_router(admin.router, prefix="/api")


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "Relay Distributed AI Task Platform API v4.0.0", "docs": "/docs"}
