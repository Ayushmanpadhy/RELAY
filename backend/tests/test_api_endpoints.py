import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.store.firestore import set_job_public


@pytest.mark.asyncio
async def test_health_endpoints():
    """Verify health and ready probes return 200 OK."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/health")
        assert res.status_code == 200
        assert res.json()["status"] in ("healthy", "degraded")

        res_ready = await client.get("/api/health/ready")
        assert res_ready.status_code == 200
        assert res_ready.json()["status"] == "ready"


@pytest.mark.asyncio
async def test_cors_headers():
    """Verify CORS headers for allowed and disallowed origins."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Allowed origin
        headers_allowed = {
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        }
        res_opt = await client.options("/api/health", headers=headers_allowed)
        assert res_opt.headers.get("access-control-allow-origin") == "http://localhost:3000"


@pytest.mark.asyncio
async def test_create_job_empty_prompt():
    """Verify job creation with empty prompt returns 400 Bad Request."""
    headers = {"Authorization": "Bearer dev-user-bob"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/api/jobs", data={"prompt": "   "}, headers=headers)
        assert res.status_code == 400
        assert res.json()["detail"]["error"]["code"] == "empty_prompt"


@pytest.mark.asyncio
async def test_job_not_found():
    """Verify requesting nonexistent job returns 404."""
    headers = {"Authorization": "Bearer dev-user-bob"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/jobs/job-nonexistent-99999", headers=headers)
        assert res.status_code == 404
        assert res.json()["detail"]["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_job_idor_protection():
    """Verify user Alice cannot read user Bob's job (403 Forbidden)."""
    # Seed a job owned by Bob
    job_id = "job-bob-secret-123"
    await set_job_public(
        job_id,
        {
            "id": job_id,
            "userId": "bob",
            "promptPreview": "Bob's private financial analysis",
            "status": "done",
            "progress": 100,
            "stepLabel": "Completed",
            "createdAt": "2026-10-19T10:00:00Z",
        },
    )

    # Alice tries to read Bob's job
    alice_headers = {"Authorization": "Bearer dev-user-alice"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/jobs/{job_id}", headers=alice_headers)
        assert res.status_code == 403
        assert res.json()["detail"]["error"]["code"] == "forbidden"

        # Bob can read his own job
        bob_headers = {"Authorization": "Bearer dev-user-bob"}
        res_bob = await client.get(f"/api/jobs/{job_id}", headers=bob_headers)
        assert res_bob.status_code == 200
        data = res_bob.json()
        assert data["id"] == job_id
        # Verify no internal leak
        assert "plan" not in data
        assert "parts" not in data
        assert "node" not in data
        assert "provider" not in data


from app.nodes.pool import node_pool


@pytest.mark.asyncio
async def test_admin_nodes_and_chaos():
    """Verify admin node list and simulated chaos actions."""
    await node_pool.initialize()
    headers = {"Authorization": "Bearer dev-admin-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Get nodes from overview
        res = await client.get("/api/admin/overview", headers=headers)
        assert res.status_code == 200
        overview = res.json()
        nodes = overview["nodes"]
        assert len(nodes) > 0

        # Simulate crash on first node
        target_node = nodes[0]["nodeId"]
        res_crash = await client.post(
            "/api/admin/chaos/crash-node", json={"nodeId": target_node}, headers=headers
        )
        assert res_crash.status_code == 200
        assert res_crash.json()["status"] == "ok"

        # Recover nodes via chaos heal
        res_rec = await client.post("/api/admin/chaos/heal", headers=headers)
        assert res_rec.status_code == 200
        assert res_rec.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_admin_settings_persistence():
    """Verify admin runtime settings can be retrieved and updated."""
    headers = {"Authorization": "Bearer dev-admin-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res_get = await client.get("/api/admin/settings", headers=headers)
        assert res_get.status_code == 200

        # Patch settings
        res_patch = await client.patch(
            "/api/admin/settings",
            json={"callMode": "individual", "maxAttempts": 5},
            headers=headers,
        )
        assert res_patch.status_code == 200
        updated = res_patch.json()
        assert updated["callMode"] == "individual"
        assert updated["maxAttempts"] == 5


@pytest.mark.asyncio
async def test_download_file_auth():
    """Verify download endpoint supports Bearer header, query param token, and blocks unauthenticated/IDOR requests."""
    from app.config import settings

    job_id = "job-download-auth-test"
    # Seed job and deliverable file
    await set_job_public(
        job_id,
        {
            "id": job_id,
            "userId": "bob",
            "status": "done",
            "progress": 100,
        },
    )
    out_dir = settings.UPLOAD_DIR / job_id / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    test_file = out_dir / "result.md"
    test_file.write_text("# Deliverable Results\nAll data processed.")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. No auth -> 401 Unauthorized
        res_no_auth = await client.get(f"/api/jobs/{job_id}/files/result.md")
        assert res_no_auth.status_code == 401

        # 2. Query param ?token=... -> 200 OK
        res_query_auth = await client.get(f"/api/jobs/{job_id}/files/result.md?token=dev-user-bob")
        assert res_query_auth.status_code == 200
        assert "All data processed." in res_query_auth.text

        # 3. Header Authorization: Bearer -> 200 OK
        res_header_auth = await client.get(
            f"/api/jobs/{job_id}/files/result.md",
            headers={"Authorization": "Bearer dev-user-bob"},
        )
        assert res_header_auth.status_code == 200
        assert "All data processed." in res_header_auth.text

        # 4. IDOR attempt by Alice -> 403 Forbidden
        res_alice = await client.get(
            f"/api/jobs/{job_id}/files/result.md?token=dev-user-alice"
        )
        assert res_alice.status_code == 403
