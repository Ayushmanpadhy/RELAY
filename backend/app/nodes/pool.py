import asyncio
import logging
import time
from typing import Any, Literal

from app.config import settings
from app.nodes.chaos import is_node_crashed
from app.providers.registry import registry
from app.store.firestore import set_node

logger = logging.getLogger("relay.nodes.pool")

NodeState = Literal["idle", "working", "crashed", "recovering"]


class WorkerNode:
    def __init__(self, node_id: str) -> None:
        self.node_id = node_id
        self.state: NodeState = "idle"
        self.provider_id: str = "gemini"
        self.current_job_id: str | None = None
        self.current_part_id: str | None = None
        self.completed_count = 0
        self.failed_count = 0
        self.last_change = time.time()
        self.lock = asyncio.Lock()

    async def update_state(
        self,
        new_state: NodeState,
        provider_id: str | None = None,
        job_id: str | None = None,
        part_id: str | None = None,
    ) -> None:
        async with self.lock:
            self.state = new_state
            if provider_id is not None:
                self.provider_id = provider_id
            self.current_job_id = job_id
            self.current_part_id = part_id
            self.last_change = time.time()

            await set_node(self.node_id, self.to_dict())

    def to_dict(self) -> dict[str, Any]:
        # If node or its provider is crashed in chaos, reflect in state
        effective_state = self.state
        if is_node_crashed(self.node_id):
            effective_state = "crashed"

        return {
            "nodeId": self.node_id,
            "state": effective_state,
            "provider": self.provider_id,
            "currentJobId": self.current_job_id,
            "currentPartId": self.current_part_id,
            "completed": self.completed_count,
            "failed": self.failed_count,
            "lastChange": self.last_change,
        }


class NodePool:
    def __init__(self, node_count: int = settings.WORKER_NODE_COUNT) -> None:
        self.node_count = node_count
        self.nodes: dict[str, WorkerNode] = {
            f"node-{i + 1:03d}": WorkerNode(f"node-{i + 1:03d}") for i in range(node_count)
        }
        self.lock = asyncio.Lock()

    async def initialize(self) -> None:
        logger.info("Initializing pool with %d worker nodes", self.node_count)
        for node in self.nodes.values():
            await set_node(node.node_id, node.to_dict())

    async def acquire_idle_node(
        self, exclude_provider: str | None = None
    ) -> tuple[WorkerNode | None, Any | None]:
        async with self.lock:
            provider = await registry.get_next_worker_provider(exclude_provider=exclude_provider)
            if not provider:
                return None, None

            for node in self.nodes.values():
                if node.state == "idle" and not is_node_crashed(node.node_id):
                    # Bind node to this provider
                    node.state = "working"
                    node.provider_id = provider.provider_id
                    return node, provider

            return None, None

    def get_node(self, node_id: str) -> WorkerNode | None:
        return self.nodes.get(node_id)

    def get_all_states(self) -> list[dict[str, Any]]:
        return [node.to_dict() for node in self.nodes.values()]

    def get_summary_counts(self) -> dict[str, int]:
        counts = {"working": 0, "idle": 0, "crashed": 0, "recovering": 0}
        for node in self.nodes.values():
            st = "crashed" if is_node_crashed(node.node_id) else node.state
            counts[st] = counts.get(st, 0) + 1
        return counts


node_pool = NodePool()
