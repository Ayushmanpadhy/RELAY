# Known Limitations & Environmental Constraints

Documenting genuine constraints, external quota caps, or platform boundaries verified during quality evaluation.

| Item | Description | Root Cause / Rationale | Mitigation / Recommended Handling |
|------|-------------|------------------------|-----------------------------------|
| **LIM-001** | Cloud Firestore API requires manual enablement in GCP Console | Project `relay-2c57e` service account lacks `serviceusage.services.enable` permissions to enable APIs programmatically. | Backend operates in structured in-memory mode without crashes or transaction lock errors until enabled in Google Cloud Console (`https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=relay-2c57e`). |
| **LIM-002** | Firebase Authentication requires console initialization | Identity Toolkit API returns `CONFIGURATION_NOT_FOUND` until Email/Password and Google sign-in are enabled in Firebase Console. | Admin credentials fall back gracefully to local store; users can register once enabled in Firebase Console (`https://console.firebase.google.com/project/relay-2c57e/authentication`). |
| **LIM-003** | Mistral Free Tier Rate Limit (429) | Mistral free tier key receives HTTP 429 when burst limit is hit. | Circuit breaker parses `Retry-After`, marks provider `degraded`, and prevents retry storms. |
| **LIM-004** | GitHub Models Endpoint Retired (July 30, 2026) | `models.github.ai` endpoint was retired by GitHub on July 30, 2026, returning non-completion text `'OK'`. | ProviderClient enforces `choices` structure, flags provider as `unavailable`, and automatically routes jobs to active providers (Gemini, Groq, Gemini Lite). |
