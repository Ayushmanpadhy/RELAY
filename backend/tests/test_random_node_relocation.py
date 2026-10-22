import pytest
from app.nodes.pool import NodePool
from app.nodes.chaos import crash_node, heal_all


@pytest.mark.asyncio
async def test_randomized_node_acquisition():
    """Verify nodes are picked randomly across the 100-node cluster rather than sequentially node-001..010."""
    pool = NodePool()
    await pool.initialize()

    acquired_node_ids = []
    for _ in range(10):
        node, provider = await pool.acquire_idle_node()
        assert node is not None
        assert provider is not None
        acquired_node_ids.append(node.node_id)

    # All 10 acquired nodes must be unique and marked working
    assert len(set(acquired_node_ids)) == 10

    # Ensure they are not strictly sequential node-001 to node-010
    sequential_ten = [f"node-{i:03d}" for i in range(1, 11)]
    assert acquired_node_ids != sequential_ten, "Nodes should be randomly distributed, not sequentially node-001..node-010"


@pytest.mark.asyncio
async def test_failed_node_exclusion_and_relocation():
    """Verify that when a node fails, it is excluded from reassignment and relocated to another node."""
    pool = NodePool()
    await pool.initialize()

    # Suppose node-005 failed on this part
    failed_node_id = "node-005"
    exclude_set = {failed_node_id}

    # Acquire an idle node excluding the failed node
    node, provider = await pool.acquire_idle_node(exclude_nodes=exclude_set)
    assert node is not None
    assert node.node_id != failed_node_id
    assert node.node_id not in exclude_set


@pytest.mark.asyncio
async def test_fallback_when_all_idle_excluded():
    """Verify fallback if all available idle nodes are excluded in edge cases."""
    pool = NodePool()
    await pool.initialize()

    # Exclude all 100 nodes
    all_node_ids = {node.node_id for node in pool.nodes.values()}

    # Should gracefully fallback to any idle node instead of deadlocking
    node, provider = await pool.acquire_idle_node(exclude_nodes=all_node_ids)
    assert node is not None
    assert node.state == "working"


@pytest.mark.asyncio
async def test_crashed_nodes_are_skipped():
    """Verify crashed nodes are never acquired."""
    pool = NodePool()
    await pool.initialize()

    try:
        crash_node("node-010")
        for _ in range(20):
            node, _ = await pool.acquire_idle_node()
            assert node is not None
            assert node.node_id != "node-010"
    finally:
        heal_all()
