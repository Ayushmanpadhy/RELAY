import pytest

from app.config import Settings


def test_missing_provider_keys():
    with pytest.raises(ValueError, match="No AI provider keys configured"):
        Settings(
            GEMINI_API_KEY="",
            GROQ_API_KEY="",
            MISTRAL_API_KEY="",
            GITHUB_TOKEN="",
            OPENROUTER_API_KEY="",
            RELAY_FAKE_PROVIDERS=0,
        )


def test_invalid_url():
    with pytest.raises(ValueError, match="must be a valid HTTP or HTTPS URL"):
        Settings(
            GEMINI_API_KEY="test_key",
            GEMINI_BASE_URL="ftp://invalid.url",
        )


def test_invalid_limits():
    with pytest.raises(ValueError, match="WORKER_NODE_COUNT must be positive"):
        Settings(
            GEMINI_API_KEY="test_key",
            WORKER_NODE_COUNT=0,
        )

    with pytest.raises(ValueError, match="GLOBAL_CONCURRENCY must be positive"):
        Settings(
            GEMINI_API_KEY="test_key",
            GLOBAL_CONCURRENCY=-1,
        )


def test_production_default_admin_password():
    with pytest.raises(ValueError, match="ADMIN_PASSWORD must be changed"):
        Settings(
            APP_ENV="production",
            GEMINI_API_KEY="test_key",
            ADMIN_PASSWORD="admin123",
        )


def test_production_fake_providers_forbidden():
    with pytest.raises(ValueError, match="RELAY_FAKE_PROVIDERS cannot be enabled in production"):
        Settings(
            APP_ENV="production",
            GEMINI_API_KEY="test_key",
            ADMIN_PASSWORD="StrongNewPassword!2026",
            RELAY_FAKE_PROVIDERS=1,
        )


def test_production_missing_firebase_credentials():
    with pytest.raises(ValueError, match="Missing Firebase service account credentials file"):
        Settings(
            APP_ENV="production",
            GEMINI_API_KEY="test_key",
            ADMIN_PASSWORD="StrongNewPassword!2026",
            RELAY_FAKE_PROVIDERS=0,
            GOOGLE_APPLICATION_CREDENTIALS="./non_existent_path.json",
        )
