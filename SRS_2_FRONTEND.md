# Relay Frontend SRS (v4)

Document 2 of 3. Read `SRS_1_FULL_SYSTEM.md` first (requirement IDs FR-* and NFR-* come from it).

---

## 1. Purpose and scope
A single web app with three visual areas:
1. **Public:** dark landing page and dark sign-in page (the existing Relay landing page in `reference/relay-landing.html` is kept: same design, copy, 3D scene, intro and scroll text animation, ported to React).
2. **User area `/app`:** light theme. Compose a request, watch simple progress, read the result.
3. **Admin area `/admin`:** dark theme. Operate and inspect the platform.

## 2. Technology (2026 stack, use latest stable at build time)
| Concern | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, React 19, Turbopack), TypeScript strict. No Pages Router, no CRA, no class components |
| Styling | **Tailwind CSS v4** (CSS-first config, OKLCH design tokens), **shadcn/ui** (Radix primitives), `lucide-react` |
| Motion | **Motion** (`motion/react`) for UI, **GSAP + ScrollTrigger** for the landing page, CSS scroll-driven animations where supported, **Lenis** for smooth scrolling on public and user pages (not in admin tables) |
| 3D | **React Three Fiber** + drei (landing 3D scene, light-theme orb in the user composer) |
| Theme transition | **View Transitions API** (`document.startViewTransition`) with a clip-path circular reveal, cross-fade fallback |
| Data | **Firebase JS SDK (modular)**: Auth and Firestore realtime listeners (`onSnapshot`); **TanStack Query** for REST calls |
| Forms/validation | React Hook Form + Zod |
| Charts (admin) | Recharts |
| Fonts | Inter (UI), JetBrains Mono (numbers, ids), via `next/font` |
| Quality | ESLint, Prettier, Vitest + Testing Library, Playwright for 3 smoke flows |

Rules: React Server Components by default; client components only for interactivity; dynamic import the 3D code; image optimisation via `next/image`; no `any`; no deprecated browser APIs.

## 3. Routes
```
/                     Landing (dark, public)
/auth                 Sign in / Sign up (dark, public)
/app                  User home: composer + my requests (light, user)
/app/r/[id]           Request progress and result (light, user)
/admin                Overview (dark, admin)
/admin/submissions    All jobs
/admin/jobs/[id]      Job detail: split, nodes, trail, result
/admin/nodes          Nodes and providers, chaos controls
/admin/settings       Runtime settings
/admin/users          Users
```
Route guards (middleware + client): unauthenticated visitors to `/app` or `/admin` go to `/auth`; non-admins to `/admin` go to `/app`; admins signing in land on `/admin`.

## 4. Design systems

### 4.1 Dark system (landing, auth, admin), the existing Relay look
```
--bg #0B0D12  --surface #12151C  --surface-2 #181C25  --line #232836
--text #E8EAF0  --dim #8A92A6  --accent #7C8CFF
--ok #4ADE9A  --warn #F5B35A  --bad #FF6B6B
```
Radius 14, no heavy shadows, mono numbers. Status colours fixed: node working = accent, idle = dim, crashed = bad, recovering = warn, done = ok.
Provider badges (admin): Gemini, Groq, Mistral, GitHub, Gemini Lite each get a distinct, accessible hue shown as a small ring/dot, plus the name (never colour alone).

### 4.2 Light system (user area), 2026 look: calm, spacious, soft depth
```
--bg #F6F7FB   --surface #FFFFFF   --surface-2 #EEF0F7   --line #E2E5EF
--text #0E1226 --dim #5B6280       --accent #5B6CFF   --accent-soft #E8EBFF
--ok #12A66B   --warn #C9831A      --bad #D8434B
```
Radius 20 for cards and composer, soft layered shadows (`0 1px 2px rgba(14,18,38,.04), 0 12px 40px rgba(14,18,38,.06)`), generous whitespace, large type (hero 56px, tight tracking), bento-style cards for past requests, subtle glass only on the top bar.

### 4.3 Motion rules
- Durations 180 to 300 ms for UI, 600 to 900 ms for transitions, easing `cubic-bezier(.22,1,.36,1)`.
- Entrances: fade + 8px rise, stagger 30 ms (max 8 items).
- Scroll storytelling only on landing and on the user home page; none in admin.
- Everything reduces to opacity-only under `prefers-reduced-motion`.
- No bounce, no autoplay loops except the 3D scenes (paused off-screen and in hidden tabs).

## 5. Screens

### 5.1 Landing `/` (dark)
Port of the existing landing page: intro with scattering letters, 3D coordinator and worker nodes (click a worker to crash it and watch re-routing, click core for burst, drag/parallax), scatter-letter scroll headings, how-it-works, resilience cards, final call to action. Text never overlaps the 3D stage or clickable items. Fallbacks for reduced motion, no WebGL and small screens. Changes: nav and CTA buttons say **Sign in** and go to `/auth`. Copy refreshed to the new product ("Describe the work. Relay splits it, runs it everywhere, and hands you the answer.").

### 5.2 Auth `/auth` (dark, shared by users and admin)
- Centered card on the dark background with a very soft, slow 3D/particle backdrop (low cost).
- Tabs: **Sign in** | **Create account**. Fields: email, password (show/hide), name on sign-up. Button **Continue with Google** (Firebase popup, redirect fallback on mobile). Inline validation, human-readable Firebase errors, loading state, "Forgot password" (Firebase reset email).
- Single form for admin and users. After success:
  - User: run the **dark-to-light transition** and arrive at `/app`.
  - Admin (`admin` claim): stay dark, calm entrance of the admin shell (sidebar slides in 300 ms, cards fade up staggered).

### 5.3 Dark-to-light transition (FR-T2)
Implementation: on auth success call `document.startViewTransition(() => { setTheme('light'); router.push('/app') })`. Animate `::view-transition-new(root)` with `clip-path: circle(0 at X Y)` to `circle(150% at X Y)` where X Y is the centre of the pressed button, duration 900 ms, `cubic-bezier(.22,1,.36,1)`; old view stays still (no fade). While it runs, the welcome headline ("Welcome, {first name}") fades in at 400 ms. Reverse on sign-out (light to dark, circle from the sign-out button). Fallback (no API or reduced motion): 300 ms cross-fade. The theme is applied by `data-theme` on `<html>` before first paint (server-known from role cookie) so there is never a flash of the wrong theme.

### 5.4 User home `/app` (light)
Layout (single column, max 880 px, calm):
1. **Top bar:** logo, "My requests", avatar menu (sign out).
2. **Hero + composer:** greeting ("What should we get done today?"), large rounded composer card with a multi-line prompt box, a drop zone below it ("Drop any files here"), file chips with remove buttons and size, and one primary button **Start**. Placeholder examples rotate every few seconds (only when idle). Validation messages are friendly and specific.
3. A **soft 3D orb** (R3F, translucent, slowly rotating) sits beside the composer on wide screens; when the user presses Start it gently splits into small particles that stream away (about 1.2 s) as the page moves to the progress view. Hidden on mobile and reduced motion.
4. **Scroll section "Your requests":** bento grid of recent requests (title from prompt, status chip, time). Cards reveal with scroll-driven animation. Empty state with a friendly hint.
Dynamic scrolling: Lenis smooth scroll, header condenses after 80 px, hero parallax of 12 px max.

### 5.5 Request page `/app/r/[id]` (light)
**While running:** one calm panel showing a large percentage ring, one status sentence from the backend (`stepLabel`: "Reading your files", "Working on it", "Putting it all together"), and an estimated time remaining. **No parts, nodes, providers or technical words.** If clarifying questions exist, show them as a simple inline form. Failure state: apologetic message with "Try again" that prefills the composer.
**When done:** a **result window**: headline answer (large), a short plain-language explanation of what was done and how the answer should be read, optional download buttons for generated files, "Ask something else" button. Result appears with a gentle reveal; for numeric answers the number counts up once.

### 5.6 Admin shell (dark)
Left sidebar (Overview, Submissions, Nodes and providers, Users, Settings), top bar with live connection dot and sign-out. Dense but not crowded: max 4 summary numbers per row, cards with generous spacing.

### 5.7 Admin Overview `/admin`
- **Stat strip:** Active jobs, Nodes working, Nodes crashed, Reassignments (today).
- **Node grid:** all 100 nodes as small rounded tiles; colour = state; small provider dot; hover shows node id, provider, current part, completed/failed counts; click opens a side drawer with its history. Smooth state-change colour crossfades (200 ms). Optimised rendering (memoised tiles) to stay at 60 fps.
- **Provider health strip:** one card per provider: name, model, state, latency sparkline, error rate, circuit state.
- **Live activity feed:** latest events in plain sentences ("Node 12 (Groq) crashed, part 37 moved to node 51 (Mistral)").

### 5.8 Submissions `/admin/submissions`
Table: time, user (email), prompt excerpt, files, mode (exact/ai), parts, status, duration. Search, status filter, sort. Row click opens job detail.

### 5.9 Job detail `/admin/jobs/[id]`
Sections (tabs or stacked): **Request** (full prompt, files list with download), **Plan** (intent, mode, part count and why, tool or instruction, reduce strategy), **Distribution** (split table with columns part, size, execution tool/AI, node, provider/model, attempts, status; row expansion shows the **reassignment trail**), **Timeline** (swim-lane chart by node or provider; failed attempts hatched red, retried attempts linked), **Outputs** (raw part outputs, collapsible), **Result** (what the user sees). Summary row: parts, reassigned parts, crashed attempts, providers used, total time. Live while running.

### 5.10 Nodes and providers `/admin/nodes`
Table/grid with filters (state, provider), per-provider metrics, and **Chaos controls**: crash selected node, crash a provider for N seconds (15/30/60), heal all. Every chaos action requires confirm and logs an event. Clear labels: "Simulated failure".

### 5.11 Settings and Users
Settings: call mode (Batched / Individual), max concurrency, max attempts, read-only model names and provider availability. Users: list with email, sign-up date, job count.

## 6. State, data and API usage
- Firestore listeners: user area subscribes to `jobs/{id}` and the user's `jobs` list; admin subscribes to `nodes`, `providers`, `events`, `jobs_internal` and part subcollections as needed. Unsubscribe on unmount; paginate lists.
- REST (with Firebase ID token in `Authorization: Bearer`): create job (multipart), clarify, download, admin chaos/settings. Handle 401 (refresh token or sign out), 403, 429 (show retry-after), 5xx (friendly message).
- Environment (`frontend/.env.local`): `NEXT_PUBLIC_FIREBASE_*` web config, `NEXT_PUBLIC_API_BASE_URL`. No secrets in the frontend.

## 7. UX requirements
- States everywhere: loading skeletons, empty states, error boundaries (`error.tsx`), offline banner, upload progress, disabled buttons while submitting.
- Responsive from 360 px to 1920 px. Admin is desktop-first but usable on tablet.
- Accessibility: semantic HTML, labels, `aria-live` for progress, focus management on route change, 4.5:1 contrast, keyboard operable node grid and drawers.
- Performance: route-level code splitting, 3D lazy-loaded, LCP under 2.5 s, no layout shift from fonts or theme.

## 8. Frontend acceptance tests
1. Landing keeps all behaviours of the reference page; no text overlaps 3D or buttons at 375, 768 and 1440 px.
2. Email sign-up, sign-in and Google sign-in work against the real Firebase project; wrong password shows a clear message.
3. User sign-in triggers the circular dark-to-light transition without flicker; sign-out reverses it; reduced motion uses a cross-fade.
4. Admin sign-in lands on `/admin` in dark theme; a normal user visiting `/admin` is redirected to `/app`.
5. A user can submit a prompt + files and sees only friendly progress and the final explained result; DevTools network and Firestore reads show no internal fields.
6. Admin overview updates live while a job runs: grid colours change, events appear, counters move. With 100 nodes the page stays smooth.
7. Job detail shows split table, reassignment trails and timeline correctly after a chaos run.
8. Lighthouse accessibility 95+ on `/auth`, `/app`, `/admin`. Lint, type-check and unit tests pass.
