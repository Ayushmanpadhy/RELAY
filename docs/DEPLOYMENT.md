# Production Deployment & Operations Runbook: Relay v4

**Platform Architecture:** Monorepo with FastAPI Backend (Python 3.12) and Next.js 16 Frontend (React 19 / TypeScript / Tailwind).  
**Database:** Google Cloud Firestore (production mode) & Firebase Authentication.

---

## 1. Hosting Architecture & Trade-Offs

Relay v4's scheduler maintains active worker task coordination in memory and stores slice data on local disk (`data/uploads/`), backed by Firestore for distributed state.
- **Recommended Backend Topology:** A **single always-on container with a persistent volume** (e.g., Fly.io or Render).
- **Why NOT Serverless Scale-to-Zero (Cloud Run / AWS Lambda)?**
  Serverless cold starts and scale-to-zero terminate long-running async background loops (batch writes, worker leases, node heartbeats), causing premature aborts of multi-minute batch jobs. If deploying on Cloud Run, minimum instances must be set to `1` (`--min-instances=1`) with a mounted Cloud Storage bucket.

---

## 2. Production Deployment Steps

### Step 2.1: Firebase Console Setup
1. Open the [Firebase Console](https://console.firebase.google.com/) and navigate to the project named **relay**.
2. **Authentication:** Enable **Email/Password** and **Google** provider in Authentication > Sign-in method.
   - Add your production frontend domain (e.g. `relay.yourdomain.com`) to **Authorized domains**.
3. **Firestore Database:** Create database in **production mode** in region `asia-south1` (or nearest region).
4. **Deploy Security Rules & Indexes:**
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
5. **Service Account Credentials:**
   - Go to Project Settings > Service Accounts > Generate new private key.
   - Save the JSON key securely as `backend/secrets/firebase-service-account.json`.

---

### Step 2.2: Backend Deployment (Fly.io / Render)

#### Option A: Deploying on Fly.io (Recommended)
1. Install `flyctl` and authenticate: `fly auth login`
2. Create a persistent volume for uploaded files:
   ```bash
   fly volumes create relay_data --size 10 --region sin
   ```
3. Create `backend/fly.toml`:
   ```toml
   app = "relay-api"
   primary_region = "sin"

   [build]
     dockerfile = "Dockerfile"

   [env]
     APP_ENV = "production"
     PORT = "8000"
     GLOBAL_CONCURRENCY = "10"
     ENABLE_CHAOS = "0"
     FRONTEND_ORIGIN = "https://relay.yourdomain.com"

   [mounts]
     source = "relay_data"
     destination = "/app/data"

   [http_service]
     internal_port = 8000
     force_https = true
     auto_stop_machines = false
     auto_start_machines = true
     min_machines_running = 1

   [[http_service.checks]]
     grace_period = "10s"
     interval = "15s"
     method = "GET"
     path = "/api/health/ready"
     timeout = "5s"
   ```
4. Set production secrets on Fly:
   ```bash
   fly secrets set \
     GEMINI_API_KEY="AIza..." \
     GROQ_API_KEY="gsk_..." \
     MISTRAL_API_KEY="..." \
     GITHUB_TOKEN="ghp_..." \
     ADMIN_PASSWORD="ChooseAStrongSecretPassword2026!"
   ```
5. Deploy:
   ```bash
   fly deploy
   ```

#### Option B: Deploying on Render
1. Create a **Web Service** with Environment `Docker`.
2. Attach a **Disk** mounted at `/app/data` (size 10 GB).
3. Set Environment Variables:
   - `APP_ENV`: `production`
   - `ENABLE_CHAOS`: `0`
   - `ADMIN_PASSWORD`: Strong password (not `admin123`)
   - `FRONTEND_ORIGIN`: Your production frontend URL
   - Add AI API keys (`GROQ_API_KEY`, `GITHUB_TOKEN`, etc.)
4. Health check path: `/api/health/ready`

---

### Step 2.3: Frontend Deployment (Vercel / Firebase Hosting)

#### Deploying on Vercel
1. Link repository to Vercel and set root directory to `frontend/`.
2. Configure Environment Variables in Vercel Dashboard:
   ```env
   NEXT_PUBLIC_API_BASE_URL=https://relay-api.fly.dev
   NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=relay.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=relay
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=relay.firebasestorage.app
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
   NEXT_PUBLIC_FIREBASE_APP_ID=...
   ```
3. Deploy:
   ```bash
   vercel --prod
   ```

---

## 3. Seed Production Administrator
Run the idempotent admin seeding script against production:
```bash
cd backend
APP_ENV=production ADMIN_EMAIL="admin@yourdomain.com" ADMIN_PASSWORD="YourStrongPassword!" python seed_admin.py
```

---

## 4. Secret & Key Rotation Runbook

### Rotating an AI Provider Key (Zero-Downtime)
1. Generate the replacement key in the provider console (e.g. Groq Console or Google AI Studio).
2. Update the environment variable in Fly.io / Render:
   ```bash
   fly secrets set GROQ_API_KEY="new_key_here"
   ```
3. Fly performs a rolling update without dropping active requests.
4. Verify new key health via `GET /api/health` or `POST /api/admin/probe`.
5. Revoke the old key in the provider console.

### Rotating the Firebase Service Account
1. Generate a new key in Firebase Console (Project Settings > Service Accounts).
2. Replace the secret mounted file in production.
3. Restart the backend process: `fly apps restart relay-api`.
4. Delete the retired key in Google Cloud IAM.

---

## 5. Rollback Procedures

### Frontend Rollback (Vercel)
1. Open Vercel Dashboard > Project Deployments.
2. Select previous stable deployment.
3. Click **Instant Rollback** (active in <5 seconds).

### Backend Rollback (Fly.io)
1. List release versions: `fly releases`
2. Rollback to image tag:
   ```bash
   fly deploy --image registry.fly.io/relay-api:<previous-version>
   ```

---

## 6. Post-Deployment Verification (Smoke Test)
Execute the automated smoke script against the live URLs:
```bash
./scripts/smoke_prod.sh https://relay-api.fly.dev https://relay.yourdomain.com
```

---

## 7. Launch Checklist
- [ ] Firebase Authentication enabled (Email/Password, Google).
- [ ] Authorized domains configured in Firebase Console.
- [ ] `firestore.rules` and `firestore.indexes.json` deployed.
- [ ] Production Firebase service account key installed.
- [ ] `APP_ENV=production` set; `ADMIN_PASSWORD` changed from `admin123`.
- [ ] `ENABLE_CHAOS=0` verified in production settings.
- [ ] Persistent disk volume mounted at `/app/data`.
- [ ] Backend `/api/health/ready` probe returning HTTP 200.
- [ ] Automated smoke test `./scripts/smoke_prod.sh` returns green.
