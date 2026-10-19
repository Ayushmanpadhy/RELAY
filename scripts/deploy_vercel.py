import os
import requests
import json
from pathlib import Path

VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN", "")
HEADERS = {
    "Authorization": f"Bearer {VERCEL_TOKEN}",
    "Content-Type": "application/json",
}

# 1. Read frontend env variables
env_path = Path("frontend/.env.local")
env_vars = {}
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip()

print(f"Loaded {len(env_vars)} frontend environment variables.")

# 2. Format env vars for Vercel API
vercel_envs = []
for k, v in env_vars.items():
    vercel_envs.append({
        "key": k,
        "value": v,
        "type": "plain",
        "target": ["production", "preview", "development"]
    })

# 3. Create or update Project on Vercel
project_payload = {
    "name": "relay-platform",
    "framework": "nextjs",
    "rootDirectory": "frontend",
    "gitRepository": {
        "type": "github",
        "repo": "Ayushmanpadhy/RELAY"
    },
    "environmentVariables": vercel_envs
}

print("Creating/linking project on Vercel...")
r = requests.post("https://api.vercel.com/v10/projects", headers=HEADERS, json=project_payload)
print("Project creation status:", r.status_code)
proj_data = r.json()

if r.status_code not in (200, 201):
    print("Project response:", proj_data.get("error", proj_data))
    # If project already exists, fetch it
    r2 = requests.get("https://api.vercel.com/v9/projects/relay-platform", headers=HEADERS)
    if r2.status_code == 200:
        proj_data = r2.json()
        print("Fetched existing project:", proj_data.get("name"))

project_id = proj_data.get("id")
print("Project ID:", project_id)

# 4. Trigger Deployment
deploy_payload = {
    "name": "relay-platform",
    "project": project_id or "relay-platform",
    "gitSource": {
        "type": "github",
        "repo": "Ayushmanpadhy/RELAY",
        "ref": "main"
    }
}

print("Triggering deployment on Vercel...")
r_dep = requests.post("https://api.vercel.com/v13/deployments", headers=HEADERS, json=deploy_payload)
print("Deployment status:", r_dep.status_code)
dep_data = r_dep.json()

if r_dep.status_code in (200, 201):
    url = dep_data.get("url")
    print(f"Deployment triggered successfully!")
    print(f"Deployment URL: https://{url}")
    print(f"Production Alias: https://relay-platform.vercel.app")
else:
    print("Deployment response:", dep_data.get("error", dep_data))
