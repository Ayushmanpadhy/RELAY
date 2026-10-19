import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.config import settings


@pytest.mark.asyncio
async def test_auth_missing_token():
    """Verify protected endpoints return 401 without authorization header."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # User endpoint
        res = await client.get("/api/jobs")
        assert res.status_code == 401
        assert res.json()["detail"]["error"]["code"] == "unauthorized"

        # Admin endpoint
        res_admin = await client.get("/api/admin/overview")
        assert res_admin.status_code == 401
        assert res_admin.json()["detail"]["error"]["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_auth_garbage_token():
    """Verify malformed or invalid token returns 401."""
    headers = {"Authorization": "Bearer not-a-real-jwt-token-12345"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/jobs", headers=headers)
        assert res.status_code == 401
        assert res.json()["detail"]["error"]["code"] == "invalid_token"


@pytest.mark.asyncio
async def test_auth_user_forbidden_on_admin():
    """Verify regular user receives 403 Forbidden on admin endpoints."""
    headers = {"Authorization": "Bearer dev-user-alice"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/admin/overview", headers=headers)
        assert res.status_code == 403
        assert res.json()["detail"]["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_auth_admin_allowed_on_admin():
    """Verify admin role succeeds on admin endpoints."""
    headers = {"Authorization": "Bearer dev-admin-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/admin/overview", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "nodes" in data
        assert "providers" in data


@pytest.mark.asyncio
async def test_auth_dev_tokens_rejected_in_production(monkeypatch):
    """Verify dev fallback tokens are rejected when APP_ENV is production."""
    monkeypatch.setattr(settings, "APP_ENV", "production")
    headers = {"Authorization": "Bearer dev-admin-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/admin/overview", headers=headers)
        assert res.status_code == 401
        assert res.json()["detail"]["error"]["code"] == "invalid_token"


@pytest.mark.asyncio
async def test_admin_auth_login_isolated():
    """Verify dedicated admin login endpoint and HMAC admin token work in both dev and production."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Invalid credentials
        res_bad = await client.post(
            "/api/admin/auth/login",
            json={"email": "admin@gmail.com", "password": "wrongpassword"},
        )
        assert res_bad.status_code == 401
        assert res_bad.json()["detail"]["error"]["code"] == "invalid_credentials"

        # Valid credentials
        res_good = await client.post(
            "/api/admin/auth/login",
            json={"email": "admin@gmail.com", "password": settings.ADMIN_PASSWORD},
        )
        assert res_good.status_code == 200
        data = res_good.json()
        assert data["status"] == "ok"
        token = data["token"]
        assert token.startswith("relay-adm.")

        # Access admin endpoint with this isolated token
        res_admin = await client.get(
            "/api/admin/overview", headers={"Authorization": f"Bearer {token}"}
        )
        assert res_admin.status_code == 200
        assert "nodes" in res_admin.json()

