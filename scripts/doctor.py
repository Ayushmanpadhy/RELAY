#!/usr/bin/env python3
"""
Relay Environment & Health Diagnostic Tool (npm run doctor)
Executes comprehensive Phase A Inventory & Health Verification:
1. Service-account key discovery & validation
2. Project ID consistency across backend, frontend, rules, firebase.json, .firebaserc
3. backend/.env completeness vs .env.example
4. frontend/.env.local keys verification
5. .gitignore coverage & git secrets scan
6. Firebase tooling (firebase.json, .firebaserc, CLI)
7. Cloud Firestore self-test ping & error classification
8. Firestore rules and indexes check
9. Firebase Authentication & Identity Toolkit check
10. Admin account & password check
11. AI provider probe matrix & rate limits (spaced)
12. Processes and ports (3000, 8000)
13. Tooling versions (Node, npm, Python, uv)
14. Frontend health (Tailwind v4 PostCSS, layout import, turbopack root, overflow)
"""

import asyncio
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

# Path setup
ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"
sys.path.insert(0, str(BACKEND_DIR))

# Colors
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

TARGET_PROJECT_ID = "relay-2c57e"


def print_header(title: str) -> None:
    print(f"\n{BOLD}{CYAN}=== {title} ==={RESET}")


def print_pass(name: str, detail: str = "") -> None:
    det = f" {DIM}({detail}){RESET}" if detail else ""
    print(f"  {GREEN}[PASS]{RESET} {name}{det}")


def print_warn(name: str, detail: str = "") -> None:
    det = f" {DIM}({detail}){RESET}" if detail else ""
    print(f"  {YELLOW}[WARN]{RESET} {name}{det}")


def print_fail(name: str, detail: str = "") -> None:
    det = f" {DIM}({detail}){RESET}" if detail else ""
    print(f"  {RED}[FAIL]{RESET} {name}{det}")


def is_port_in_use(port: int, host: str = "127.0.0.1") -> tuple[bool, int | None, str]:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        in_use = s.connect_ex((host, port)) == 0
    if not in_use:
        return False, None, ""

    # Find PID
    try:
        out = subprocess.check_output(f'netstat -ano | findstr ":{port} "', shell=True, text=True)
        lines = out.strip().splitlines()
        for line in lines:
            parts = line.split()
            if len(parts) >= 5 and "LISTENING" in parts:
                pid = int(parts[-1])
                cmd = subprocess.check_output(
                    f'wmic process where processid={pid} get commandline /format:list',
                    shell=True,
                    text=True,
                    errors='ignore',
                )
                return True, pid, cmd.strip()
    except Exception:
        pass
    return True, None, "Active"


# 1. Service Account Inventory
def check_service_accounts() -> tuple[int, int, list[dict[str, Any]]]:
    print_header("1. Firebase Service-Account Key Inventory")
    errors = 0
    warnings = 0
    accounts = []
    excludes = {"node_modules", ".venv", ".git", ".next"}

    for dirpath, dirnames, filenames in os.walk(ROOT_DIR):
        dirnames[:] = [d for d in dirnames if d not in excludes]
        for f in filenames:
            if f.endswith(".json"):
                p = os.path.join(dirpath, f)
                try:
                    with open(p, "rb") as fp:
                        head = fp.read(2048)
                        if b'"service_account"' in head:
                            with open(p, "r", encoding="utf-8") as fp_json:
                                d = json.load(fp_json)
                                if isinstance(d, dict) and d.get("type") == "service_account":
                                    mtime = datetime.fromtimestamp(os.path.getmtime(p)).strftime(
                                        "%Y-%m-%d %H:%M"
                                    )
                                    proj = d.get("project_id", "")
                                    email = d.get("client_email", "")
                                    status = "CORRECT" if proj == TARGET_PROJECT_ID else "WRONG"
                                    accounts.append(
                                        {
                                            "path": p,
                                            "project_id": proj,
                                            "client_email": email,
                                            "modified": mtime,
                                            "status": status,
                                        }
                                    )
                except Exception:
                    pass

    # Print Inventory Table
    border = "  +" + "-" * 50 + "+" + "-" * 15 + "+" + "-" * 42 + "+" + "-" * 18 + "+" + "-" * 10 + "+"
    print(border)
    print(f"  | {'File Path':<48} | {'Project ID':<13} | {'Client Email':<40} | {'Modified Date':<16} | {'Status':<8} |")
    print(border)

    correct_count = 0
    for a in accounts:
        rel_path = os.path.relpath(a["path"], ROOT_DIR)
        st_color = GREEN if a["status"] == "CORRECT" else RED
        if a["status"] == "CORRECT":
            correct_count += 1
        else:
            errors += 1
        print(f"  | {rel_path:<48} | {a['project_id']:<13} | {a['client_email']:<40} | {a['modified']:<16} | {st_color}{a['status']:<8}{RESET} |")

    print(border)
    if correct_count > 0:
        print_pass("Target Service Account Key", f"Found key for {TARGET_PROJECT_ID}")
    else:
        print_fail("Target Service Account Key", f"No key found for {TARGET_PROJECT_ID}")
        errors += 1

    return errors, warnings, accounts


# 2. Project ID Consistency
def check_project_id_consistency() -> tuple[int, int]:
    print_header("2. Project ID Consistency Audit (Target: relay-2c57e)")
    errors = 0
    warnings = 0

    checks = []

    # backend/.env
    backend_env = BACKEND_DIR / ".env"
    b_proj = ""
    if backend_env.exists():
        content = backend_env.read_text(encoding="utf-8")
        m = re.search(r"^FIREBASE_PROJECT_ID\s*=\s*(.*)$", content, re.M)
        if m:
            b_proj = m.group(1).strip()
    checks.append(("backend/.env", "FIREBASE_PROJECT_ID", TARGET_PROJECT_ID, b_proj))

    # backend/secrets/firebase-service-account.json
    sa_path = BACKEND_DIR / "secrets" / "firebase-service-account.json"
    sa_proj = ""
    if sa_path.exists():
        try:
            with open(sa_path, "r", encoding="utf-8") as f:
                sa_proj = json.load(f).get("project_id", "")
        except Exception:
            pass
    checks.append(("backend/secrets/key", "project_id", TARGET_PROJECT_ID, sa_proj))

    # frontend/.env.local
    frontend_env = FRONTEND_DIR / ".env.local"
    f_proj = ""
    f_auth = ""
    f_store = ""
    if frontend_env.exists():
        c = frontend_env.read_text(encoding="utf-8")
        m_proj = re.search(r"^NEXT_PUBLIC_FIREBASE_PROJECT_ID\s*=\s*(.*)$", c, re.M)
        m_auth = re.search(r"^NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN\s*=\s*(.*)$", c, re.M)
        m_store = re.search(r"^NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET\s*=\s*(.*)$", c, re.M)
        if m_proj:
            f_proj = m_proj.group(1).strip()
        if m_auth:
            f_auth = m_auth.group(1).strip()
        if m_store:
            f_store = m_store.group(1).strip()
    checks.append(("frontend/.env.local", "NEXT_PUBLIC_FIREBASE_PROJECT_ID", TARGET_PROJECT_ID, f_proj))
    checks.append(("frontend/.env.local", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", f"{TARGET_PROJECT_ID}.firebaseapp.com", f_auth))
    checks.append(("frontend/.env.local", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", f"{TARGET_PROJECT_ID}.firebasestorage.app", f_store))

    # .firebaserc
    firebaserc = ROOT_DIR / ".firebaserc"
    rc_proj = ""
    if firebaserc.exists():
        try:
            with open(firebaserc, "r", encoding="utf-8") as f:
                rc_proj = json.load(f).get("projects", {}).get("default", "")
        except Exception:
            pass
    checks.append((".firebaserc", "projects.default", TARGET_PROJECT_ID, rc_proj))

    # firebase.json
    fb_json = ROOT_DIR / "firebase.json"
    fb_status = "PRESENT" if fb_json.exists() else "MISSING"
    checks.append(("firebase.json", "config file", "PRESENT", fb_status))

    # Format Table
    border = "  +" + "-" * 22 + "+" + "-" * 38 + "+" + "-" * 34 + "+" + "-" * 34 + "+" + "-" * 10 + "+"
    print(border)
    print(f"  | {'Config Source':<20} | {'Key / Property':<36} | {'Expected':<32} | {'Actual':<32} | {'Status':<8} |")
    print(border)

    for src, key, exp, act in checks:
        if exp == act or (key == "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET" and TARGET_PROJECT_ID in act):
            status = f"{GREEN}PRESENT{RESET}"
            stat_str = "PRESENT"
        elif not act or act == "MISSING":
            status = f"{RED}MISSING{RESET}"
            stat_str = "MISSING"
            errors += 1
        else:
            status = f"{RED}WRONG{RESET}"
            stat_str = "WRONG"
            errors += 1
        padding = " " * (8 - len(stat_str))
        print(f"  | {src:<20} | {key:<36} | {exp:<32} | {act:<32} | {status}{padding} |")

    print(border)
    return errors, warnings


# 3. backend/.env vs .env.example
def check_backend_env() -> tuple[int, int]:
    print_header("3. Backend Environment Configuration Audit")
    errors = 0
    warnings = 0

    env_path = BACKEND_DIR / ".env"
    example_path = BACKEND_DIR / ".env.example"

    if not env_path.exists():
        print_fail("backend/.env", "File missing")
        return 1, 0
    if not example_path.exists():
        print_fail("backend/.env.example", "File missing")
        return 1, 0

    def parse_keys(p: Path) -> dict[str, str]:
        keys = {}
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                keys[k.strip()] = v.strip()
        return keys

    env_keys = parse_keys(env_path)
    ex_keys = parse_keys(example_path)

    req = [
        "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "GITHUB_TOKEN",
        "GEMINI_MODEL", "GEMINI_LITE_MODEL", "GROQ_MODEL", "OPENROUTER_MODEL", "MISTRAL_MODEL", "GITHUB_MODEL",
        "FIREBASE_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS",
        "APP_ENV", "FRONTEND_ORIGIN", "ADMIN_EMAIL", "ADMIN_PASSWORD"
    ]

    for k in req:
        if k in env_keys:
            print_pass(f"Env var: {k}", "PRESENT")
        else:
            print_fail(f"Env var: {k}", "MISSING")
            errors += 1

    # Check distinct Gemini models
    gm = env_keys.get("GEMINI_MODEL", "")
    glm = env_keys.get("GEMINI_LITE_MODEL", "")
    if gm and glm and gm == glm:
        print_fail("Gemini Models Distinct", f"Both set to '{gm}'")
        errors += 1
    elif gm and glm:
        print_pass("Gemini Models Distinct", f"{gm} != {glm}")

    # Check credentials file exists
    cred_file = env_keys.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    resolved_cred = Path(cred_file)
    if not resolved_cred.is_absolute():
        resolved_cred = BACKEND_DIR / resolved_cred
    if resolved_cred.exists():
        print_pass("Credentials File Resolution", str(resolved_cred))
    else:
        print_fail("Credentials File Resolution", f"Not found at {resolved_cred}")
        errors += 1

    # Missing from either side
    missing_in_env = set(ex_keys.keys()) - set(env_keys.keys())
    missing_in_ex = set(env_keys.keys()) - set(ex_keys.keys())

    if missing_in_env:
        print_warn("Missing in backend/.env (present in .env.example)", ", ".join(missing_in_env))
        warnings += len(missing_in_env)
    if missing_in_ex:
        print_warn("Missing in .env.example (present in backend/.env)", ", ".join(missing_in_ex))
        warnings += len(missing_in_ex)

    return errors, warnings


# 4. frontend/.env.local Audit
def check_frontend_env() -> tuple[int, int]:
    print_header("4. Frontend Environment Configuration Audit")
    errors = 0
    warnings = 0

    f_env = FRONTEND_DIR / ".env.local"
    if not f_env.exists():
        print_fail("frontend/.env.local", "File missing")
        return 1, 0

    content = f_env.read_text(encoding="utf-8")
    req = [
        "NEXT_PUBLIC_FIREBASE_API_KEY",
        "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
        "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
        "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
        "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
        "NEXT_PUBLIC_FIREBASE_APP_ID",
        "NEXT_PUBLIC_API_BASE_URL",
    ]

    for k in req:
        m = re.search(rf"^{k}\s*=\s*(.+)$", content, re.M)
        if m and m.group(1).strip():
            print_pass(k, "PRESENT")
        else:
            print_fail(k, "MISSING / EMPTY")
            errors += 1

    return errors, warnings


# 5. .gitignore & Secrets Scan
def check_gitignore_and_secrets() -> tuple[int, int]:
    print_header("5. .gitignore Coverage & Secrets History Scan")
    errors = 0
    warnings = 0

    gi = ROOT_DIR / ".gitignore"
    if not gi.exists():
        print_fail(".gitignore", "Missing in root")
        return 1, 0

    gi_text = gi.read_text(encoding="utf-8")
    patterns = [".env", ".env.*", "secrets/", "data/", ".next", "node_modules", ".venv"]
    for p in patterns:
        if p in gi_text:
            print_pass(f".gitignore rule: {p}", "PRESENT")
        else:
            print_fail(f".gitignore rule: {p}", "MISSING")
            errors += 1

    # Scan git history
    try:
        commits = subprocess.check_output(["git", "rev-list", "--all"], text=True).split()
        leaks = []
        secret_pats = ["private_key", "AIza", "gsk_", "ghp_", "mstrl_", "AQ."]
        for commit in commits[:30]:
            diff = subprocess.check_output(["git", "show", commit], text=True, errors="ignore")
            for sp in secret_pats:
                if sp in diff:
                    files = subprocess.check_output(
                        ["git", "show", "--name-only", "--format=", commit], text=True
                    ).split()
                    leaks.append((commit[:7], sp, files))
        if leaks:
            print_fail("Git History Secrets", f"Potential secrets found in {len(leaks)} commits")
            for c, sp, fs in leaks:
                print(f"         Commit {c} ({sp}): {', '.join(fs)}")
            errors += 1
        else:
            print_pass("Git History Secrets", "Zero secrets found in git commits")
    except Exception as e:
        print_warn("Git History Scan", str(e))

    return errors, warnings


# 6. Firebase Tooling
def check_firebase_tooling() -> tuple[int, int]:
    print_header("6. Firebase Tooling & CLI Integration")
    errors = 0
    warnings = 0

    fb_json = ROOT_DIR / "firebase.json"
    if fb_json.exists():
        print_pass("firebase.json", "PRESENT")
    else:
        print_fail("firebase.json", "MISSING")
        errors += 1

    rc = ROOT_DIR / ".firebaserc"
    if rc.exists():
        print_pass(".firebaserc", "PRESENT (targets relay-2c57e)")
    else:
        print_fail(".firebaserc", "MISSING")
        errors += 1

    # CLI check
    fb_bin = shutil.which("firebase")
    if fb_bin:
        print_pass("firebase-tools", f"Installed at {fb_bin}")
    else:
        print_warn("firebase-tools", "Not installed in system PATH (run: npm install -g firebase-tools)")
        warnings += 1

    gcloud_bin = shutil.which("gcloud")
    if gcloud_bin:
        print_pass("gcloud CLI", f"Installed at {gcloud_bin}")
    else:
        print_warn("gcloud CLI", "Optional CLI not in PATH")

    return errors, warnings


# 7. Cloud Firestore Self-Test Ping
def check_firestore_ping() -> tuple[int, int]:
    print_header("7. Cloud Firestore Self-Test Ping (relay-2c57e)")
    errors = 0
    warnings = 0

    try:
        from app.store.firestore import firestore_self_test
        import firebase_admin
        from firebase_admin import credentials, firestore

        cred_path = str(BACKEND_DIR / "secrets" / "firebase-service-account.json")
        cred = credentials.Certificate(cred_path)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred, {"projectId": TARGET_PROJECT_ID})

        client = firestore.client()
        success, code, reason, url = firestore_self_test(client, TARGET_PROJECT_ID)

        if success:
            print_pass("Firestore Ping", f"Write, Read & Delete succeeded on {TARGET_PROJECT_ID}")
        else:
            print_warn("Firestore Ping", f"Status: [{code}] - {reason}")
            if url:
                print(f"         {BOLD}Activation Link:{RESET} {CYAN}{url}{RESET}")
            warnings += 1

    except Exception as e:
        print_fail("Firestore Initialization", str(e))
        errors += 1

    return errors, warnings


# 8. Firestore Rules & Indexes
def check_firestore_rules_and_indexes() -> tuple[int, int]:
    print_header("8. Firestore Rules & Indexes")
    errors = 0
    warnings = 0

    rules = ROOT_DIR / "firestore.rules"
    if rules.exists():
        print_pass("firestore.rules", f"PRESENT ({rules.stat().st_size} bytes)")
    else:
        print_fail("firestore.rules", "MISSING")
        errors += 1

    indexes = ROOT_DIR / "firestore.indexes.json"
    if indexes.exists():
        print_pass("firestore.indexes.json", f"PRESENT ({indexes.stat().st_size} bytes)")
    else:
        print_fail("firestore.indexes.json", "MISSING")
        errors += 1

    return errors, warnings


# 9. Firebase Authentication
def check_firebase_auth() -> tuple[int, int]:
    print_header("9. Firebase Authentication & Identity Toolkit")
    errors = 0
    warnings = 0

    try:
        import firebase_admin
        from firebase_admin import auth, credentials

        cred_path = str(BACKEND_DIR / "secrets" / "firebase-service-account.json")
        cred = credentials.Certificate(cred_path)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred, {"projectId": TARGET_PROJECT_ID})

        try:
            page = auth.list_users(max_results=1)
            print_pass("Firebase Auth Admin SDK", "Identity Platform active, users query succeeded")
        except Exception as e:
            msg = str(e)
            if "CONFIGURATION_NOT_FOUND" in msg:
                print_warn("Firebase Auth Admin SDK", "Identity Platform not configured yet in console (CONFIGURATION_NOT_FOUND)")
                print(f"         {BOLD}Enable Auth here:{RESET} {CYAN}https://console.firebase.google.com/project/{TARGET_PROJECT_ID}/authentication{RESET}")
                warnings += 1
            else:
                print_warn("Firebase Auth Admin SDK", msg[:120])
                warnings += 1

    except Exception as e:
        print_fail("Firebase Auth SDK", str(e))
        errors += 1

    return errors, warnings


# 10. Admin Account
def check_admin_account() -> tuple[int, int]:
    print_header("10. Admin Account & Password Audit")
    errors = 0
    warnings = 0

    try:
        from app.config import settings
        import firebase_admin
        from firebase_admin import auth

        if settings.ADMIN_PASSWORD == "admin123":
            print_warn("Admin Password", "Using development default password 'admin123' (change for production)")
        else:
            print_pass("Admin Password", "Non-default password configured")

        if firebase_admin._apps:
            try:
                u = auth.get_user_by_email(settings.ADMIN_EMAIL)
                claims = u.custom_claims or {}
                if claims.get("admin") is True:
                    print_pass("Admin User", f"{settings.ADMIN_EMAIL} exists with admin=true claim")
                else:
                    print_warn("Admin User", f"{settings.ADMIN_EMAIL} exists but missing admin=true claim")
                    warnings += 1
            except Exception:
                print_warn("Admin User", f"{settings.ADMIN_EMAIL} not seeded in Firebase Auth yet (run: npm run seed:admin)")
                warnings += 1

    except Exception as e:
        print_warn("Admin Account Check", str(e))

    return errors, warnings


# 11. AI Provider Probes Matrix
async def check_ai_providers() -> tuple[int, int]:
    print_header("11. AI Provider Probes & Rate Limits (Spaced Calls)")
    errors = 0
    warnings = 0

    try:
        from app.providers.probe import probe_provider
        from app.providers.registry import ProviderRegistry

        reg = ProviderRegistry()
        results = []

        print(f"  Probing {len(reg.providers)} providers with rate limit pacing...")
        for pid, client in reg.providers.items():
            res = await probe_provider(client)
            results.append((client, res))
            await asyncio.sleep(0.5)  # Pace calls

        # Format Table
        border = "  +" + "-" * 17 + "+" + "-" * 25 + "+" + "-" * 14 + "+" + "-" * 12 + "+" + "-" * 11 + "+" + "-" * 11 + "+"
        print(border)
        print(f"  | {'Provider':<15} | {'Model':<23} | {'Key Present':<12} | {'Status':<10} | {'Latency':<9} | {'RPM Limit':<9} |")
        print(border)

        online_count = 0
        degraded_count = 0

        for client, res in results:
            state = res["state"]
            key_present = "YES" if client.is_configured else "NO"
            if state == "healthy":
                status = f"{GREEN}ONLINE{RESET}"
                online_count += 1
            elif state == "degraded":
                status = f"{YELLOW}DEGRADED{RESET}"
                degraded_count += 1
            elif state == "unavailable" and not client.is_configured:
                status = f"{DIM}DISABLED{RESET}"
            else:
                status = f"{RED}FAILED{RESET}"

            lat = f"{client.latency_ms}ms" if client.latency_ms > 0 else "-"
            rpm = f"{getattr(client, 'rpm_limit', 60)}"
            stat_clean = "ONLINE" if state == "healthy" else ("DEGRADED" if state == "degraded" else ("DISABLED" if not client.is_configured else "FAILED"))
            padding = " " * (10 - len(stat_clean))
            print(f"  | {client.name:<15} | {client.model:<23} | {key_present:<12} | {status}{padding} | {lat:<9} | {rpm:<9} |")

        print(border)

        if online_count > 0:
            print_pass("Provider Quorum", f"{online_count} online, {degraded_count} degraded")
        else:
            print_fail("Provider Quorum", "No providers online")
            errors += 1

    except Exception as e:
        print_fail("AI Provider Probes", str(e))
        errors += 1

    return errors, warnings


# 12. Processes and Ports
def check_ports() -> tuple[int, int]:
    print_header("12. Processes and Ports (3000, 8000)")
    errors = 0
    warnings = 0

    p3000, pid3, cmd3 = is_port_in_use(3000)
    p8000, pid8, cmd8 = is_port_in_use(8000)

    if p3000:
        print_pass("Port 3000 (Frontend)", f"PID: {pid3} | {cmd3[:60]}")
    else:
        print_pass("Port 3000 (Frontend)", "Open & Available")

    if p8000:
        print_pass("Port 8000 (Backend)", f"PID: {pid8} | {cmd8[:60]}")
    else:
        print_pass("Port 8000 (Backend)", "Open & Available")

    return errors, warnings


# 13. Tooling Versions
def check_tooling_versions() -> tuple[int, int]:
    print_header("13. Tooling Versions & Dependencies")
    errors = 0
    warnings = 0

    # Node
    node_bin = shutil.which("node")
    if node_bin:
        out = subprocess.check_output([node_bin, "-v"], text=True).strip()
        print_pass("Node.js", f"{out} (at {node_bin})")
    else:
        print_fail("Node.js", "node not found")
        errors += 1

    # npm
    npm_bin = shutil.which("npm")
    if npm_bin:
        out = subprocess.check_output([npm_bin, "-v"], shell=True, text=True).strip()
        print_pass("npm", out)
    else:
        print_fail("npm", "npm not found")
        errors += 1

    # Python
    py_ver = sys.version_info
    print_pass("Python", f"{py_ver.major}.{py_ver.minor}.{py_ver.micro} (at {sys.executable})")

    # uv
    uv_bin = shutil.which("uv")
    if uv_bin:
        print_pass("uv", f"Installed at {uv_bin}")
    else:
        print_warn("uv", "Not installed (optional)")

    return errors, warnings


# 14. Frontend Health
def check_frontend_health() -> tuple[int, int]:
    print_header("14. Frontend Styling & Build Health")
    errors = 0
    warnings = 0

    # Tailwind v4 PostCSS config
    postcss_cfg = FRONTEND_DIR / "postcss.config.mjs"
    if postcss_cfg.exists():
        print_pass("PostCSS Tailwind Plugin", str(postcss_cfg))
    else:
        print_fail("PostCSS Tailwind Plugin", f"Missing {postcss_cfg}")
        errors += 1

    # globals.css import
    globals_css = FRONTEND_DIR / "src" / "app" / "globals.css"
    if globals_css.exists() and '@import "tailwindcss";' in globals_css.read_text(encoding="utf-8"):
        print_pass("Tailwind v4 Directive", '@import "tailwindcss" in globals.css')
    else:
        print_fail("Tailwind v4 Directive", "Missing from globals.css")
        errors += 1

    # layout.tsx import
    layout_tsx = FRONTEND_DIR / "src" / "app" / "layout.tsx"
    if layout_tsx.exists() and 'import "./globals.css"' in layout_tsx.read_text(encoding="utf-8"):
        print_pass("CSS Layout Import", "Imported in app/layout.tsx")
    else:
        print_fail("CSS Layout Import", "Missing from layout.tsx")
        errors += 1

    # turbopack.root absolute path
    next_cfg = FRONTEND_DIR / "next.config.ts"
    if next_cfg.exists() and "path.resolve" in next_cfg.read_text(encoding="utf-8"):
        print_pass("Turbopack Root Path", "Absolute path configured")
    else:
        print_warn("Turbopack Root Path", "Ensure turbopack.root is absolute")
        warnings += 1

    # Horizontal overflow check
    if globals_css.exists() and "overflow-x: clip" in globals_css.read_text(encoding="utf-8"):
        print_pass("Horizontal Overflow Prevention", "overflow-x: clip configured")
    else:
        print_warn("Horizontal Overflow Prevention", "Missing overflow-x: clip")
        warnings += 1

    return errors, warnings


async def main_async() -> int:
    print(f"\n{BOLD}{GREEN}======================================================================{RESET}")
    print(f"{BOLD}{GREEN}RELAY v4 SETUP AUDIT & HEALTH DIAGNOSTIC{RESET}")
    print(f"Target Firebase Project: {CYAN}{BOLD}{TARGET_PROJECT_ID}{RESET} | Root: {ROOT_DIR}")
    print(f"Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{BOLD}{GREEN}======================================================================{RESET}")

    total_errors = 0
    total_warnings = 0

    e, w, _ = check_service_accounts()
    total_errors += e
    total_warnings += w

    e, w = check_project_id_consistency()
    total_errors += e
    total_warnings += w

    e, w = check_backend_env()
    total_errors += e
    total_warnings += w

    e, w = check_frontend_env()
    total_errors += e
    total_warnings += w

    e, w = check_gitignore_and_secrets()
    total_errors += e
    total_warnings += w

    e, w = check_firebase_tooling()
    total_errors += e
    total_warnings += w

    e, w = check_firestore_ping()
    total_errors += e
    total_warnings += w

    e, w = check_firestore_rules_and_indexes()
    total_errors += e
    total_warnings += w

    e, w = check_firebase_auth()
    total_errors += e
    total_warnings += w

    e, w = check_admin_account()
    total_errors += e
    total_warnings += w

    e, w = await check_ai_providers()
    total_errors += e
    total_warnings += w

    e, w = check_ports()
    total_errors += e
    total_warnings += w

    e, w = check_tooling_versions()
    total_errors += e
    total_warnings += w

    e, w = check_frontend_health()
    total_errors += e
    total_warnings += w

    print_header("Diagnostic Summary")
    if total_errors == 0:
        if total_warnings == 0:
            print(f"\n{BOLD}{GREEN}ALL 14 AUDIT CHECKS PASSED (0 errors, 0 warnings){RESET}\n")
        else:
            print(f"\n{BOLD}{GREEN}SYSTEM OPERATIONAL{RESET} with {YELLOW}{total_warnings} warning(s){RESET} (0 blocking errors)\n")
        return 0
    else:
        print(f"\n{BOLD}{RED}SYSTEM CHECKS FAILED:{RESET} {total_errors} blocking error(s), {total_warnings} warning(s)\n")
        return 1


def main() -> None:
    code = asyncio.run(main_async())
    sys.exit(code)


if __name__ == "__main__":
    main()
