import os
import sys
import json
import time
from pathlib import Path
import requests

RENDER_API_KEY = os.environ.get("RENDER_API_KEY", "")
VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN", "")
OWNER_ID = "tea-dbb5vc1jfumc73dbcimg"
VERCEL_PROJECT_ID = "prj_zJwfkYq9rlbAxSUnfczrsBsJpXML"
REPO_URL = "https://github.com/Ayushmanpadhy/RELAY"

RENDER_HEADERS = {
    "Authorization": f"Bearer {RENDER_API_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

VERCEL_HEADERS = {
    "Authorization": f"Bearer {VERCEL_TOKEN}",
    "Content-Type": "application/json",
}


def load_backend_env():
    env_vars = {}
    env_file = Path("backend/.env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env_vars[k.strip()] = v.strip().strip('"').strip("'")

    # Add service account JSON
    sa_file = Path("backend/secrets/firebase-service-account.json")
    if not sa_file.exists():
        sa_file = Path("secrets/firebase-service-account.json")
    if sa_file.exists():
        sa_json = sa_file.read_text(encoding="utf-8").strip()
        env_vars["FIREBASE_SERVICE_ACCOUNT_JSON"] = sa_json

    # Overrides for production
    env_vars["APP_ENV"] = "production"
    env_vars["PORT"] = "8000"
    env_vars["FRONTEND_ORIGIN"] = "https://relay-platform-eta.vercel.app"
    env_vars["ENABLE_CHAOS"] = "0"
    env_vars["RELAY_FAKE_PROVIDERS"] = "0"
    env_vars["RELAY_FIREBASE_EMULATOR"] = "0"
    env_vars["FIREBASE_PROJECT_ID"] = "relay-2c57e"

    # Remove emulator hosts in prod
    env_vars.pop("FIRESTORE_EMULATOR_HOST", None)
    env_vars.pop("FIREBASE_AUTH_EMULATOR_HOST", None)

    return env_vars


def get_service():
    print("Fetching Render services...")
    r = requests.get(
        f"https://api.render.com/v1/services?ownerId={OWNER_ID}",
        headers=RENDER_HEADERS,
    )
    if r.status_code == 200:
        for s in r.json():
            svc = s.get("service", {})
            if svc.get("name") == "relay-api":
                return svc
    return None


def configure_service(svc_id, env_vars):
    print(f"Setting {len(env_vars)} environment variables on Render service {svc_id}...")
    render_env_payload = [{"key": k, "value": v} for k, v in env_vars.items()]
    r = requests.put(
        f"https://api.render.com/v1/services/{svc_id}/env-vars",
        headers=RENDER_HEADERS,
        json=render_env_payload,
    )
    print("Environment variables update status:", r.status_code)
    if r.status_code != 200:
        print("Env vars update response:", r.text)

    # Ensure rootDir is empty string so it uses root Dockerfile or backend/Dockerfile
    r_patch = requests.patch(
        f"https://api.render.com/v1/services/{svc_id}",
        headers=RENDER_HEADERS,
        json={"rootDir": ""},
    )
    print("Service rootDir configuration status:", r_patch.status_code)


def trigger_deploy(svc_id):
    print(f"Triggering fresh deployment for Render service {svc_id}...")
    r = requests.post(
        f"https://api.render.com/v1/services/{svc_id}/deploys",
        headers=RENDER_HEADERS,
        json={"clearCache": "clear"},
    )
    print("Deploy trigger status:", r.status_code)
    if r.status_code in (200, 201):
        dep = r.json()
        print(f"Deployment ID: {dep.get('id')}")
        return dep.get("id")
    else:
        print("Deploy error:", r.text)
        return None


def poll_deploy(svc_id, deploy_id):
    print(f"Monitoring build and deploy progress for deploy {deploy_id}...")
    start_time = time.time()
    while time.time() - start_time < 600:  # 10 minutes timeout
        time.sleep(10)
        r = requests.get(
            f"https://api.render.com/v1/services/{svc_id}/deploys/{deploy_id}",
            headers=RENDER_HEADERS,
        )
        if r.status_code == 200:
            status = r.json().get("status")
            print(f"Current deploy status: {status} ({int(time.time() - start_time)}s)")
            if status == "live":
                print("Deploy SUCCESS! Web service is LIVE!")
                return True
            elif status in ("build_failed", "update_failed", "canceled", "deactivated"):
                print(f"Deploy ended with failure status: {status}")
                return False
        else:
            print("Status fetch error:", r.status_code)
    print("Deploy timed out.")
    return False


def link_vercel_to_backend(backend_url):
    print(f"\nLinking Vercel to backend URL: {backend_url}")
    # Update NEXT_PUBLIC_API_BASE_URL env var on Vercel
    r = requests.get(
        f"https://api.vercel.com/v9/projects/{VERCEL_PROJECT_ID}/env",
        headers=VERCEL_HEADERS,
    )
    env_id = None
    if r.status_code == 200:
        envs = r.json().get("envs", [])
        for e in envs:
            if e.get("key") == "NEXT_PUBLIC_API_BASE_URL":
                env_id = e.get("id")
                break

    payload = {
        "key": "NEXT_PUBLIC_API_BASE_URL",
        "value": backend_url,
        "type": "plain",
        "target": ["production", "preview", "development"],
    }

    if env_id:
        print(f"Updating existing Vercel env var {env_id}...")
        r_update = requests.patch(
            f"https://api.vercel.com/v9/projects/{VERCEL_PROJECT_ID}/env/{env_id}",
            headers=VERCEL_HEADERS,
            json=payload,
        )
        print("Update status:", r_update.status_code)
    else:
        print("Creating new Vercel env var...")
        r_create = requests.post(
            f"https://api.vercel.com/v10/projects/{VERCEL_PROJECT_ID}/env",
            headers=VERCEL_HEADERS,
            json=payload,
        )
        print("Create status:", r_create.status_code)

    # Trigger fresh deployment
    print("Triggering fresh production deployment on Vercel...")
    deploy_payload = {
        "name": "relay-platform",
        "project": VERCEL_PROJECT_ID,
        "gitSource": {
            "type": "github",
            "repo": "Ayushmanpadhy/RELAY",
            "ref": "main",
        },
    }
    r_dep = requests.post(
        "https://api.vercel.com/v13/deployments",
        headers=VERCEL_HEADERS,
        json=deploy_payload,
    )
    print("Deployment triggered:", r_dep.status_code)
    if r_dep.status_code in (200, 201):
        print("Live Frontend URL: https://relay-platform-eta.vercel.app")


def main():
    env_vars = load_backend_env()
    print(f"Loaded {len(env_vars)} backend environment variables.")
    svc = get_service()
    if not svc:
        print("Service relay-api not found on Render!")
        sys.exit(1)

    svc_id = svc.get("id")
    svc_url = svc.get("serviceDetails", {}).get("url")
    print(f"Found service {svc_id} at {svc_url}")

    configure_service(svc_id, env_vars)

    deploy_id = trigger_deploy(svc_id)
    if deploy_id:
        success = poll_deploy(svc_id, deploy_id)
        if success:
            link_vercel_to_backend(svc_url)
        else:
            print("Deploy did not complete cleanly, please inspect Render logs.")
    else:
        # If deploy trigger failed, still link vercel
        link_vercel_to_backend(svc_url)


if __name__ == "__main__":
    main()
