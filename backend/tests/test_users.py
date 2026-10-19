import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.store.firestore import set_job_public, set_job_internal, upsert_user


@pytest.mark.asyncio
async def test_admin_users_discovery():
    """Verify /api/admin/users returns users and correctly calculates their total submissions."""
    admin_login_payload = {
        "email": "admin@relay.platform",
        "password": "RelayProductionAdmin2026!",
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Admin login
        login_res = await client.post("/api/admin/auth/login", json=admin_login_payload)
        assert login_res.status_code == 200
        admin_token = login_res.json()["token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Seed test user via upsert_user
        test_uid = "user-discovered-999"
        await upsert_user(
            test_uid,
            {
                "uid": test_uid,
                "email": "tester999@relay.platform",
                "displayName": "Tester NineNineNine",
                "role": "user",
            },
        )

        # 3. Seed 2 jobs submitted by this user
        for i in range(2):
            jid = f"job-test-user-999-{i}"
            record = {
                "id": jid,
                "userId": test_uid,
                "fullPrompt": f"Prompt {i}",
                "status": "done",
                "createdAt": "2026-10-19T14:00:00Z",
            }
            await set_job_public(jid, record)
            await set_job_internal(jid, record)

        # 4. Fetch admin users list
        users_res = await client.get("/api/admin/users", headers=admin_headers)
        assert users_res.status_code == 200
        users = users_res.json()
        assert len(users) >= 1

        target_user = next((u for u in users if u["uid"] == test_uid), None)
        assert target_user is not None
        assert target_user["email"] == "tester999@relay.platform"
        assert target_user["displayName"] == "Tester NineNineNine"
        assert target_user["jobCount"] >= 2


@pytest.mark.asyncio
async def test_user_sync_endpoint():
    """Verify POST /api/users/sync records authenticated user and updates their display name."""
    user_headers = {"Authorization": "Bearer dev-user-ayushman"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Call sync endpoint
        sync_res = await client.post(
            "/api/users/sync",
            json={"displayName": "Ayushman Padhy"},
            headers=user_headers,
        )
        assert sync_res.status_code == 200
        data = sync_res.json()
        assert data["status"] == "ok"
        assert data["user"]["uid"] == "ayushman"
        assert data["user"]["displayName"] == "Ayushman Padhy"

        # 2. Check /api/users/me
        me_res = await client.get("/api/users/me", headers=user_headers)
        assert me_res.status_code == 200
        assert me_res.json()["uid"] == "ayushman"
