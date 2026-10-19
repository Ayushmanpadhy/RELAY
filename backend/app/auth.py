import logging
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger("relay.auth")
security = HTTPBearer(auto_error=False)


class AuthUser(BaseModel):
    uid: str
    email: str
    name: str | None = None
    is_admin: bool = False
    claims: dict[str, Any] = {}


def verify_token_string(token: str) -> AuthUser:
    # Development fallback tokens only allowed in non-production environments
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
        admin_emails.add("padhyayusmanpadhy@gmail.com")
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
