import os
import shutil
import sys
from pathlib import Path

# Add backend to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import settings
from app.store import firestore


def delete_collection_recursive(coll_ref, batch_size=100):
    total_deleted = 0
    while True:
        docs = list(coll_ref.limit(batch_size).stream())
        if not docs:
            break
        batch = firestore._db.batch()
        for doc in docs:
            batch.delete(doc.reference)
            total_deleted += 1
        batch.commit()
    return total_deleted


def clear_history() -> dict[str, int]:
    print("Initializing Firestore connection...")
    firestore.init_firestore()
    if not firestore.is_firestore_connected() or firestore._db is None:
        print("ERROR: Firestore could not be connected.")
        sys.exit(1)

    db = firestore._db
    summary = {}

    # 1. Delete parts subcollections from jobs_internal
    print("Deleting nested parts subcollections...")
    parts_deleted = 0
    internal_docs = list(db.collection("jobs_internal").stream())
    for j_doc in internal_docs:
        parts_coll = j_doc.reference.collection("parts")
        p_docs = list(parts_coll.stream())
        if p_docs:
            batch = db.batch()
            for p in p_docs:
                batch.delete(p.reference)
                parts_deleted += 1
            batch.commit()
    summary["parts_subcollections"] = parts_deleted
    print(f"  -> Deleted {parts_deleted} part documents.")

    # 2. Delete jobs_internal
    print("Deleting jobs_internal documents...")
    summary["jobs_internal"] = delete_collection_recursive(db.collection("jobs_internal"))
    print(f"  -> Deleted {summary['jobs_internal']} jobs_internal documents.")

    # 3. Delete jobs
    print("Deleting public jobs documents...")
    summary["jobs"] = delete_collection_recursive(db.collection("jobs"))
    print(f"  -> Deleted {summary['jobs']} public jobs documents.")

    # 4. Delete events
    print("Deleting events log documents...")
    summary["events"] = delete_collection_recursive(db.collection("events"))
    print(f"  -> Deleted {summary['events']} event documents.")

    # 5. Clean local uploads directory
    uploads_dir = Path(settings.UPLOAD_DIR)
    cleaned_uploads = 0
    if uploads_dir.exists():
        for item in uploads_dir.iterdir():
            try:
                if item.is_file():
                    item.unlink()
                    cleaned_uploads += 1
                elif item.is_dir():
                    shutil.rmtree(item)
                    cleaned_uploads += 1
            except Exception as e:
                print(f"Warning: could not delete {item}: {e}")
    summary["uploads_cleaned"] = cleaned_uploads
    print(f"  -> Cleaned {cleaned_uploads} items from uploads directory.")

    print("\nVerification check:")
    for coll in ["jobs", "jobs_internal", "events"]:
        remaining = len(list(db.collection(coll).limit(10).stream()))
        print(f"  - {coll} remaining: {remaining}")

    users_count = len(list(db.collection("users").stream()))
    print(f"  - users preserved: {users_count}")

    print("\nDatabase history successfully cleared! Platform is fresh for presentation.")
    return summary


if __name__ == "__main__":
    clear_history()
