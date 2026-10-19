import os
import sys
from pathlib import Path

# Add backend to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import settings
from app.store.firestore import init_firestore, set_user

try:
    import firebase_admin
    from firebase_admin import auth
except ImportError:
    firebase_admin = None
    auth = None


def seed_admin() -> None:
    email = settings.ADMIN_EMAIL
    password = settings.ADMIN_PASSWORD
    print(f"Seeding admin user: {email}...")

    if password == "admin123":
        print("WARNING: Using development default password 'admin123'. Change before production deployment.")

    init_firestore()

    if auth is not None and firebase_admin._apps:
        try:
            try:
                user = auth.get_user_by_email(email)
                print(f"Admin user {email} exists (UID: {user.uid}). Updating custom claims...")
                auth.set_custom_user_claims(user.uid, {"admin": True})
            except auth.UserNotFoundError:
                user = auth.create_user(
                    email=email,
                    password=password,
                    display_name="Admin",
                )
                print(f"Created admin user {email} (UID: {user.uid}). Setting admin claim...")
                auth.set_custom_user_claims(user.uid, {"admin": True})

            print(f"SUCCESS: Admin {email} configured with claim {{'admin': True}}.")
            return
        except Exception as e:
            print(f"Firebase Admin SDK call note: {e}")

    # Fallback to local user record in store
    import asyncio
    asyncio.run(set_user("admin-uid", {
        "uid": "admin-uid",
        "email": email,
        "displayName": "Admin",
        "role": "admin",
        "createdAt": "2026-10-19T00:00:00Z",
    }))
    print(f"Admin record {email} registered in store.")


if __name__ == "__main__":
    seed_admin()
