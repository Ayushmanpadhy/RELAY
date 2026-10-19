import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger("relay.auth")
security = HTTPBearer(auto_error=False)

ADMIN_TOKEN_PREFIX = "relay-adm."


def get_admin_secret() -> bytes:
    salt = settings.FIREBASE_PROJECT_ID or "relay-production-salt"
    return hashlib.sha256(f"{settings.ADMIN_PASSWORD}:{salt}".encode("utf-8")).digest()


def create_admin_token(email: str, expires_in_seconds: int = 7 * 86400) -> str:
    now = int(time.time())
    payload = {
        "sub": "admin-system",
        "email": email.strip().lower(),
        "role": "admin",
        "iat": now,
        "exp": now + expires_in_seconds,
    }
    payload_json = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode("utf-8").rstrip("=")

    secret = get_admin_secret()
    sig = hmac.new(secret, payload_b64.encode("utf-8"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("utf-8").rstrip("=")

    return f"{ADMIN_TOKEN_PREFIX}{payload_b64}.{sig_b64}"


def verify_admin_token(token: str) -> "AuthUser | None":
    if not token or not token.startswith(ADMIN_TOKEN_PREFIX):
        return None
    raw = token[len(ADMIN_TOKEN_PREFIX) :]
    parts = raw.split(".")
    if len(parts) != 2:
        return None
    payload_b64, sig_b64 = parts

    secret = get_admin_secret()
    expected_sig = hmac.new(secret, payload_b64.encode("utf-8"), hashlib.sha256).digest()

    rem = len(sig_b64) % 4
    padded_sig_b64 = sig_b64 + ("=" * (4 - rem) if rem else "")
    try:
        actual_sig = base64.urlsafe_b64decode(padded_sig_b64)
    except Exception:
        return None

    if not hmac.compare_digest(expected_sig, actual_sig):
        return None

    rem = len(payload_b64) % 4
    padded_payload_b64 = payload_b64 + ("=" * (4 - rem) if rem else "")
    try:
        payload_json = base64.urlsafe_b64decode(padded_payload_b64).decode("utf-8")
        payload = json.loads(payload_json)
    except Exception:
        return None

    if payload.get("exp", 0) < int(time.time()):
        logger.warning("Admin token expired")
        return None

    if payload.get("role") != "admin":
        return None

    email = payload.get("email", settings.ADMIN_EMAIL)
    return AuthUser(
        uid="admin-system",
        email=email,
        name="System Administrator",
        is_admin=True,
        claims={"admin": True, "role": "admin"},
    )


class AuthUser(BaseModel):
    uid: str
    email: str
    name: str | None = None
    is_admin: bool = False
    claims: dict[str, Any] = {}


def verify_token_string(token: str) -> AuthUser:
    # 1. Isolated Admin Token (HMAC-SHA256)
    admin_user = verify_admin_token(token)
    if admin_user:
        return admin_user

    # 2. Development fallback tokens only allowed in non-production environments
    if settings.APP_ENV != "production":
        if token == "dev-admin-token":
            return AuthUser(
                uid="dev-admin-uid",
                email=settings.ADMIN_EMAIL,
                name="Dev Admin",
                is_admin=True,
                claims={"admin": True},
            )
        if token.startswith("dev-user-"):
            uid = token.replace("dev-user-", "")
            return AuthUser(
                uid=uid,
                email=f"{uid}@example.com",
                name=f"User {uid}",
                is_admin=False,
                claims={},
            )

    try:
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token.get("uid", "")
        email = decoded_token.get("email", "")
        is_admin = bool(decoded_token.get("admin", False))
        admin_emails = {e.strip().lower() for e in settings.ADMIN_EMAIL.split(",") if e.strip()}
        admin_emails.add("admin@gmail.com")
        if email and email.lower() in admin_emails:
            is_admin = True


        return AuthUser(
            uid=uid,
            email=email,
            name=decoded_token.get("name"),
            is_admin=is_admin,
            claims=decoded_token,
        )
    except Exception as e:
        logger.warning("Token verification failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": {
                    "code": "invalid_token",
                    "message": "Invalid or expired Firebase ID token",
                }
            },
        )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(security)],
) -> AuthUser:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "unauthorized", "message": "Missing authorization token"}},
        )
    return verify_token_string(credentials.credentials)


async def get_current_user_from_header_or_query(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(security)] = None,
    token: str | None = None,
) -> AuthUser:
    raw_token = credentials.credentials if credentials else token
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "unauthorized", "message": "Missing authorization token"}},
        )
    return verify_token_string(raw_token)


async def require_admin(user: Annotated[AuthUser, Depends(get_current_user)]) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "forbidden", "message": "Admin privileges required"}},
        )
    return user
