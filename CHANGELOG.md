# Changelog

All notable changes to Health Companion will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Watch face redesign (HUD):** glucose gauge ring with forecast marker, neon readout with CGM trend badge, delta per 5 min, 3 h chart with 30 min projection, time-in-range, radar-sweep background, true-black ambient mode
- **Predictive alerts on the watch:** "LOW IN ~N MIN" / "HIGH IN ~N MIN" chips; one gentle buzz per falling episode when a low is forecast within 20 min
- Watch unit tests (`GlucoseTrendEngineTest`) and a CI job that runs them and builds the watch APK

### Changed

- **Watch trend algorithm:** recency-weighted least-squares rate over the last ~10 min (wider when readings are sparse), standard CGM arrow bands, merged re-posted duplicates, no trend on stale data (> 15 min); replaces "last minus first of 8 points", which flipped on noise and ignored elapsed time
- mg/dL readings on the watch show whole numbers (`139`, not `139.0`); stale readings are struck through with "SIGNAL LOST"
- Watch redraws at 1 fps (10 fps only for the animated background) instead of 12 fps whenever a trend was shown

## [1.7.0] - 2026-10-22

### Added

- **Care team view** — read-only share link for the nurse/doctor (`/care/<token>`, FR/EN, print to PDF): 14/30/90-day glucose bands, GMI, CV, typical-day curve, hypos (≥15 min) with the 4 hours before, insulin/carbs/steps, pain, mood and sleep; links expire and can be turned off. Alembic `0003` adds `care_shares`
- **Stay signed in** — `POST /api/auth/refresh`; the phone and the web app renew the token on open (at most every 12 h); token lifetime 60 days. Phone login hides the server field and remembers the email

### Changed

- Web sidebar grouped: Morning, Mental, Injuries and Sports under **Journal**; Understanding under **Reports**

## [1.6.0] - 2026-10-21

> **Upgrade notes:** `JWT_SECRET` must be set (a short one only logs a warning; existing sessions stay valid). Deploy the backend before installing the 1.6.0 phone build (it calls `/api/*`). Older phone builds keep working via root-path aliases. See [`k8s/README.md`](k8s/README.md#upgrading-from-15x).

Builds on 1.5.81 (Understanding, MedGemma briefs, Reb3i live chat, multi-photo meals, pain check-in, evening-brief integration) and keeps `/docs` off in production.

### Added

- **CI** (`.github/workflows/ci.yml`): backend ruff + pytest + Alembic migrations on Postgres, web typecheck/build, mobile typecheck, version-sync check; **Dependabot** for pip, npm, Actions, and Docker
- Backend test suite: glucose TIR / hypo episodes, meal warnings, auth, CORS, signed uploads, login throttle, data scope, migrations, `/health-data` routes
- **Alembic** migrations replace the ad-hoc `ALTER TABLE` list; first boot adopts existing databases; startup serialized with a Postgres advisory lock (`0002` adds `meals.photos_json` for multi-photo meals)
- `DATA_SCOPE=owner` option to limit each user to their own devices (default `household` keeps current behaviour)
- `scripts/sync-version.mjs` keeps `VERSION`, package.json/app.json/lockfiles, and the API version in sync

### Changed

- **All API routes under `/api`** (web + phone); root-level aliases kept for older phone builds
- Meal photos served via **signed, expiring URLs** instead of public `/uploads`; uploads keep only image extensions
- Backend and frontend containers run as **non-root** (frontend now listens on 8080)
- Split `routers/health.py`, `services/reports.py`, and `ReportsPage.tsx` into smaller modules (no behaviour change)
- Silent `except` blocks now log; FastAPI `lifespan` replaces deprecated startup hook

### Security

- API refuses to start without a `JWT_SECRET` and warns when it is short or a placeholder
- CORS no longer allows every origin (`*` was always appended)
- Failed sign-ins throttled per email and IP (HTTP 429)

### Fixed

- RAG archive export crashed (`build_rag_archive_*` never imported)
- TTS fallback raised `NameError` instead of the real error when no audio came back
- `docker compose` could not build the backend (wrong build context)
- Old web builds could crash on `/meals` when the browser cache served the SPA HTML to the API call

### Removed

- Deprecated Node/SQLite API (`apps/api`) and the fake `openaiConfigured` health flag

## [1.5.81] - 2026-10-14

### Added

- **Integration endpoint for the agents-hub night planner** — read-only `GET /integrations/evening-brief` (yesterday + today so far: glucose summary, hypo/hyper events, overnight, steps/Energy Score/workouts, sport matches, check-in, caffeine, calorie balance, insights, open injuries with pain). Authenticated with separate integration keys stored only as SHA-256 hashes (`INTEGRATION_KEYS="name:sha256hex,…"`); no raw glucose readings, meals/photos, pump/insulin events or care-visit notes. Ingress routes `/integrations/` to the backend

### Security

- **API docs off in production** — `/docs`, `/redoc` and `/openapi.json` are disabled via `API_DOCS_ENABLED=false` (k8s) and no longer routed by the ingress or frontend nginx; still on by default for local dev

## [1.5.80] - 2026-09-24

### Fixed

- **Understanding timeout / rollout hang** — one batched MedGemma call (90s cap) instead of per-check CPU calls; release DB session before Gemini/MedGemma so long runs don’t block deploys

## [1.5.79] - 2026-09-24

### Fixed

- **Understanding timeout** — MedGemma science briefs use one batched Ollama call (max 4 patterns, 90s cap) instead of one CPU call per medical check

## [1.5.78] - 2026-09-24

### Added

- **MedGemma science briefs** — Understanding medical checks call self-hosted Ollama MedGemma (`MEDGEMMA_BASE_URL`) when configured; curated article links kept as fallback

## [1.5.77] - 2026-09-24

### Added

- **Understanding science notes** — Gemini physiology briefs (MedGemma-style) on medical checks, plus curated ADA/CDC/NIDDK/PubMed article links

## [1.5.76] - 2026-09-24

### Changed

- **Life Review retired** — Understanding is the starred insight surface; `/life-review` redirects there; mobile Life Review entry removed from Reports

## [1.5.75] - 2026-09-24

### Fixed

- **Understanding timeout** — one batched CGM load (no per-meal queries); leaner Gemini payload/retries; client timeout raised to 5 min

## [1.5.74] - 2026-09-24

### Changed

- **Understanding** — uses all app signals (sport, steps, caffeine, mood/ADHD, injuries, care, weight) with medical link checks; Life Review–style hero UI + charts

## [1.5.73] - 2026-09-24

### Added

- **Understanding** — mean glucose + estimated A1c (GMI from CGM mean) in the big-picture stats strip

## [1.5.72] - 2026-09-24

### Changed

- **Understanding** — charted meal / bolus / stress examples; 1-day window; Gemini medical checks on linked patterns (established vs plausible)

## [1.5.71] - 2026-09-24

### Added

- **Understanding** (web) — forensic pattern analysis over 7/14/30 days: carb estimation flags, bolus timing vs meals, stress↔glucose links, logging gaps; deterministic signals + Gemini synthesis (`POST /reports/understanding`)

## [1.5.70] - 2026-09-20

### Fixed

- **Reb3i Live latency / choppy reply** — wait for each streamed audio slice to actually finish (was cutting after ~180ms); shorter end-of-speech silence (~550ms)

## [1.5.69] - 2026-09-20

### Changed

- **Reb3i Live latency** — stream reply audio in ~125–250ms slices (start playing ASAP); smaller voice uploads; leaner Live context; faster ffmpeg

## [1.5.68] - 2026-09-20

### Changed

- **Reb3i Live voice rework** — simple turn-taking only: you talk → he replies → you talk. Mic off while he plays (no duplex). Manual Live activity markers; stricter hands-free VAD. Hold-to-talk unchanged.

## [1.5.67] - 2026-09-20

### Fixed

- **Reb3i Live conversation continuity** — answers what you just said and builds on his last reply; stops re-dumping TIR/meals every turn (dossier is reference-only after greeting)

## [1.5.66] - 2026-09-20

### Changed

- **Reb3i Live VAD** — higher speech threshold + 400ms sustain (ignores breath); mic stays open while Reb3i plays; barge-in only on clear loud speech

## [1.5.65] - 2026-09-20

### Fixed

- **Reb3i Live crash on speech** — hands-free orb mixed native/JS Animated drivers; metering spikes when you talk shut the app down

## [1.5.64] - 2026-09-19

### Changed

- **Reb3i Live hands-free UI** — Gemini-style orb with live voice-level rings + “Hearing you” meter; Hands-free mode selected separately, mic only starts when you tap the orb

## [1.5.63] - 2026-09-19

### Changed

- **Reb3i Live grounded in real logs** — full dossier (today + yesterday meals/carbs, glucose timeline + events, pump insulin/alerts, stress, caffeine, injuries, sport, 7-day TIR rollup, recent debrief headlines); greeting cites concrete numbers

## [1.5.62] - 2026-09-19

### Added

- **Reb3i Drive mode** — hands-free continuous voice detection (speak → pause → auto-send); mic pauses while Reb3i replies; screen stay-awake

## [1.5.61] - 2026-09-19

### Added

- **Reb3i Live** — hold-to-talk Darija voice chat (Gemini Live / native audio) about your diabetes day; Reports → Talk with Reb3i; WebSocket `/ws/reb3i-live` with today’s + yesterday’s health context (no dosing advice)

## [1.5.60] - 2026-09-03

### Fixed

- **Daily report day bounds** — meals/glucose/pump use Europe/Paris calendar days (was UTC midnight, which shifted evenings onto the wrong day)
- **Default daily report** — Reports opens on **yesterday** (completed day), matching morning email
- **Reb3i greeting** — ban/sanitize `عصابة` (and variants); force normal أهلا / عسلامة openers; bump voice cache

### Added

- **Voice player controls** (mobile) — play/pause + scrubber to jump within the Reb3i briefing

## [1.5.59] - 2026-08-31

### Added

- **Full-screen pain check-in** — rate every open injury on one screen and save all at once (presets + slider; “Set all to…” for speed)

### Removed

- **Director’s cut** weekly share/copy text (backend + web + mobile)

## [1.5.58] - 2026-08-31

### Added

- **Multi-photo meals** — log several pictures per meal (main, side, dessert, drink) on mobile; gallery on meal detail (mobile + web); `POST /meals/upload-photo` for extras without re-running AI

### Fixed

- Samsung Health workouts under-counted (e.g. Aug 27 showed ~90 min vs ~3–4 h): read exercise sessions + `TOTAL_DURATION` from Samsung, backfill past week, prefer fuller sync on upsert
- Activity sync no longer overwrites higher steps/calories/workout totals with a partial later sync

## [1.5.57] - 2026-08-24

### Added

- **Life Review** — dedicated 7-day honest AI assessment (glucose, meals, steps, mood, stress, sport) on web (`/life-review`) and mobile, with cinematic hero, loading progress, and staggered result animations
- **RAG archive** — bulk ZIP/JSON export of day debriefs + workout plans; CGM readings retained in exports and daily reports
- **Workout plans** — Gemini-generated workout drafts with save/list on Activity (mobile) and shared types

### Changed

- Reports Archive tab for browsing debriefs; glucose readings hidden from expanded archive cards (still in export)
- Mobile tabs restyled to the Life Review theme (shared hero, tokens, FadeIn); Glucose uses teal instead of iOS blue

### Fixed

- Mobile Settings/Reports crashes: missing `SettingsStack` navigator and undeclared Reports `loading` state

## [1.5.56] - 2026-08-04

### Changed

- Reb3i tone: chill mate (not over-friendly); TTS locked to male **Charon** voice with no gender flip mid-clip

## [1.5.55] - 2026-08-04

### Fixed

- Gemini TTS **503 high demand**: retries with backoff + fallback TTS models (verified locally before deploy)

## [1.5.54] - 2026-08-04

### Fixed

- Reports voice/video **504**: route `/reports/*` to the API directly and raise nginx proxy timeouts to 300s for Gemini TTS

## [1.5.53] - 2026-08-04

### Fixed

- Reb3i video OOM (ffmpeg exit -9): encode a short 720p Ken Burns loop then mux TTS instead of full-length 1080p zoompan

## [1.5.52] - 2026-08-04

### Fixed

- Hard refresh / deep link to `/reports` (and `/meals`, `/users`) serving FastAPI JSON 404 — SPA pages now go through frontend nginx with Accept-aware routing

## [1.5.51] - 2026-08-04

### Changed

- **Reb3i video** is free again: stock café/beach/padel stills + ffmpeg Ken Burns / audio pulse muxed with Darija TTS (no Veo / no Enterprise)

## [1.5.50] - 2026-08-04

### Changed

- Reb3i voice: much friendlier best-mate energy with frequent jokes (3–5+ punchlines per briefing)

## [1.5.49] - 2026-08-04

### Fixed

- Voice Arabic names: speaker **ربعي** (not ربيعي), listener **صف** (not ساف)

## [1.5.48] - 2026-08-04

### Added

- **Reb3i video briefing** — Gemini Veo clip of Reb3i (chéchia; random beach / padel / café populaire) looped under Darija TTS; play from Reports on web + mobile

### Fixed

- Voice briefing names: listener **Saff** (**صف**, never ساف/صافي); speaker **Reb3i** (**ربعي**, never ربيعي); calories as سعرات / كالوري / Latin `calories`

## [1.5.46] - 2026-08-04

### Added

- **Saff voice briefing (TN)** — Gemini writes a joking Tunisian Darija daily monologue, speaks it with Gemini TTS (Puck), playable from web + mobile Reports

## [1.5.45] - 2026-08-04

### Added

- **Diabetic engagement suite:** post-meal glucose stories, similar-meal memory, would-I-again meal ratings, resucrage↔hypo linking, overnight/dawn blurbs, hypo/hyper episode context, meal-log streaks, cannula/sensor day counters, CapAPS IOB/COB parse (when present), pre-bolus timer (mobile), site-change nudges, weekly plot twists + director’s cut share

## [1.5.44] - 2026-08-04

### Added

- **Funny local push nudges** for morning/evening, meals, post-meal, carbs, meds, weight, injury, sport, care follow-up, daily/weekly reports, glucose OOR/rate/missed, and pump drama — all toggleable in Settings → Reminders

## [1.5.43] - 2026-08-04

### Fixed

- Mobile crash on launch from wrong `expo-notifications` major (pinned to Expo SDK 54 compatible `~0.32`)

## [1.5.42] - 2026-08-04

### Added

- **Daily 10:30 morning reminder** (mobile local notification) for mental check-in + weight; tap opens a combined Morning log screen
- Settings → Reminders toggle; Mental tab shortcut; web **/morning** page with the same combined form

## [1.5.41] - 2026-08-04

### Fixed

- **502s during meal photo analysis** — sync Gemini call no longer blocks uvicorn’s event loop (probes timed out and Traefik returned 502); run analyze in a thread, 2 uvicorn workers, slightly looser liveness

## [1.5.40] - 2026-08-03

### Added

- Customizable **TIR / glucose targets** and daily carb target in Settings (web); used by dashboard, reports, and hypo logic
- Settings **tabs** (Glucose / Body / Prefs / Account) with suggested range / goal / carb chips
- Dedicated entry icons (caffeine, injury, check-in, weight, stress, running, cycling, swimming, walking)
- French **i18n** for the web app and new reports (PDF / email / AI); English remains the archive default
- **Mental** page (web) and expanded compose flows (check-in, caffeine, stress)
- Cursor rule: numeric health scores use sliders

### Fixed

- Traefik / nginx routing so mobile API POSTs hit the backend (not the SPA)

## [1.5.0] - 2026-08-02

### Added

- **Injury tracking** — persistent cases (type, body area, exercises) + daily pain 0–10 (slider); tags for sport/kine/osteo/etc.; included in daily AI prompt, debrief archive, and PDF
- **Web Injuries page** + Compose / mobile `+` entry flows
- Care visits, sport sessions, weight logging, **pump notification** sync, Energy Score (Samsung Health)
- Auth (JWT), household device scoping, daily report email + shareable PDF links
- Kubernetes deploy under `k8s/` (see [SECURITY.md](SECURITY.md) before pushing secrets)

### Security

- Env templates use placeholders only; `k8s/secrets.yaml` and `backend/.env` stay gitignored
- `./k8s/deploy.sh` requires `REGISTRY_PASS` from the environment (no hardcoded registry password)
- Default API URLs point at localhost so forks do not hit a maintainer deployment

> Milestone tag for the full companion line. Later **1.5.x** patches continued on the same major.minor (see [1.5.40](#1540---2026-08-03)).

## [1.4.0] - 2026-08-02

### Added

- **Care visits** — Kiné / Ostéo / Podologue / Other
- **Sport sessions** — padel Won / Lost / Draw + score
- **Samsung Health** activity / Energy Score sync
- **Sports** dashboard page; entries appear on daily/weekly reports

## [1.3.0] - 2026-08-02

### Added

- **JWT authentication** and household member accounts
- Household **device scoping** across glucose, meals, and activity
- Polished web **dashboard** metrics and layout
- Hardened **Kubernetes** deploy path for the public site

## [1.2.0] - 2026-08-02

### Added

- **FastAPI + PostgreSQL backend** (`backend/`) with Gemini meal vision
- **React (Vite) web dashboard** (`frontend/`) — meals, daily/weekly reports, charts
- `docker-compose.yml` for Postgres + backend + frontend (HomeManager / MyMeals style)
- Mobile tab navigation: Glucose, Meals, Reports, Activity, Settings
- Meal capture UI, Health Connect activity import, shared nutrition/report types

### Changed

- AI provider: **Gemini** (replaces OpenAI for meal photo analysis)
- Default API port **8000**; legacy Node/SQLite API under `apps/api` is deprecated

## [1.1.0] - 2026-06-23

### Added

- **Watch face customization**
  - Background styles: animated, solid color, gradient, image (presets + custom photos from phone)
  - **Text color** picker (phone + watch Settings)
  - **Multi-image slideshow** for background (select several presets/photos; configurable interval)
  - Status color tint overlay (toggle)

- **Watch face trend indicator**
  - Replaced on-face sparkline with **animated trend arrows** (↑ rising / ↓ falling / → steady)
  - Based on recent glycemia history (last ~2 hours)

- **Phone app**
  - **Watch background** settings card with auto-sync to watch
  - **12-hour trend chart** with fixed time axis (50–300 mg/dL) and rising/falling label
  - **Sync to watch** now pushes glycemia, **12h history**, and **background settings**
  - Expo config plugin + native Wear bridge (`HealthCompanionWear`) for background and history sync

- **Watch app**
  - Settings screen (3rd pager page): background style, text color, image toggles
  - 12h sparkline on main app screen
  - Vector **heart** and **footprint** icons on watch face (match text color; no emoji tint)

- **Shared package**
  - `background.ts` — background types, presets, paths
  - `sparkline.ts` / `sparklineChart.ts` — 12h window constants and chart helpers

- **Safety & alerts**
  - Parse glycemia only when **mg/dL or mmol/L** is explicit (avoids bolus/insulin false positives)
  - **Vibration** on watch when a new reading is below 70 mg/dL

### Changed

- Glycemia history: dedupe within 5s, prune to 12h, persist on watch; merge from phone via `/health_companion/glycemia_history`
- Animated watch face background: lighter GPU load (fewer shaders, ~3 fps refresh) after performance tuning
- Watch face typography: larger time, glycemia, and stats; heart/steps laid out left/right
- Phone release builds bundle JS (no Metro required on device)

### Fixed

- Phone crash on launch (`normalizeImageIds` / shared package build)
- Stale Wear bridge in Android build — `syncWearBridge` Gradle task copies plugin sources before compile
- Background sync (text color, multiple images) not reaching watch when native module was out of date

## [1.0.0] - 2025-02-07

### Added

- **Watch Face**
  - Time and date display (dd/MM/yyyy format)
  - Glycemia (blood glucose) from CapAPS Fx, synced from phone
  - Glycemia sparkline chart (last 24 readings, oldest → newest)
  - Heart rate (♥) from watch sensor
  - Steps (👣) from watch sensor
  - Status colors: green (in range), orange (high), red (low/very high)
  - Animated floating background
  - Glycemia glow and breathing pulse effect

- **Phone App**
  - Read glycemia from CapAPS Fx notifications
  - Sync to watch via Wear OS Data Layer
  - History view and chart
  - Manual sync to watch

- **Watch App**
  - Main activity with time, glycemia, status
  - Detail screen with status label
  - GlycemiaDataListenerService for receiving data from phone

### Permissions

- **Phone:** Notification Access (required for glycemia sync)
- **Watch:** BODY_SENSORS (heart rate), ACTIVITY_RECOGNITION (steps)

### Supported

- CapAPS Fx / CamAPS FX package IDs
- Glycemia formats: mmol/L, mg/dL
- Wear OS 3+ (Samsung Galaxy Watch, Pixel Watch, etc.)

[Unreleased]: https://github.com/saffist3r/HealthCompanion/compare/v1.5.0...HEAD
[1.5.40]: https://github.com/saffist3r/HealthCompanion/blob/main/CHANGELOG.md#1540---2026-08-03
[1.5.0]: https://github.com/saffist3r/HealthCompanion/releases/tag/v1.5.0
[1.4.0]: https://github.com/saffist3r/HealthCompanion/releases/tag/v1.4.0
[1.3.0]: https://github.com/saffist3r/HealthCompanion/releases/tag/v1.3.0
[1.2.0]: https://github.com/saffist3r/HealthCompanion/releases/tag/v1.2.0
[1.1.0]: https://github.com/saffist3r/HealthCompanion/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/saffist3r/HealthCompanion/releases/tag/v1.0.0
