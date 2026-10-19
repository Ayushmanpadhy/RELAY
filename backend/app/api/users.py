from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import AuthUser, get_current_user
from app.store.firestore import upsert_user

router = APIRouter(prefix="/users", tags=["Users"])


class SyncUserRequest(BaseModel):
    displayName: str | None = None
    photoURL: str | None = None


@router.post("/sync")
async def sync_user_profile(
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    body: SyncUserRequest | None = None,
) -> dict[str, Any]:
    name = (body.displayName if body and body.displayName else None) or current_user.name
    if not name and current_user.email:
        name = current_user.email.split("@")[0]

    user_record = await upsert_user(
        current_user.uid,
        {
            "uid": current_user.uid,
            "email": current_user.email,
            "displayName": name or f"User {current_user.uid[:6]}",
            "role": "admin" if current_user.is_admin else "user",
        },
    )
    return {"status": "ok", "user": user_record}


@router.get("/me")
async def get_my_profile(
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, Any]:
    return {
        "uid": current_user.uid,
        "email": current_user.email,
        "displayName": current_user.name,
        "role": "admin" if current_user.is_admin else "user",
    }
