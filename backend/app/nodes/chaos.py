import logging
import time

logger = logging.getLogger("relay.chaos")

_crashed_nodes: set[str] = set()
_crashed_providers: dict[str, float] = {}  # provider_id -> until_ts


def is_node_crashed(node_id: str) -> bool:
    return node_id in _crashed_nodes


def is_provider_crashed(provider_id: str) -> bool:
    until = _crashed_providers.get(provider_id)
    if until is None:
        return False
    if time.time() > until:
        del _crashed_providers[provider_id]
        return False
    return True


def crash_node(node_id: str) -> None:
    logger.info("Chaos: Crashing node %s (simulated)", node_id)
    _crashed_nodes.add(node_id)


def heal_node(node_id: str) -> None:
    _crashed_nodes.discard(node_id)


def crash_provider(provider_id: str, seconds: float) -> None:
    logger.info("Chaos: Crashing provider %s for %.1f seconds (simulated)", provider_id, seconds)
    _crashed_providers[provider_id] = time.time() + seconds


def heal_all() -> None:
    logger.info("Chaos: Healing all nodes and providers")
    _crashed_nodes.clear()
    _crashed_providers.clear()
