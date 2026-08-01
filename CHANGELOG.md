# Changelog

All notable changes to Health Companion will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — 1.5.x (full companion)

### Added

- **Injury tracking** — persistent cases (type, body area, exercises) + daily pain 0–10 (slider); tags for sport/kine/osteo/etc.; included in daily AI prompt, debrief archive, and PDF
- **Web Injuries page** + Compose / mobile `+` entry flows
- **Care visits**, sport sessions, weight logging, pump notification sync, Energy Score (Samsung Health)
- Auth (JWT), household device scoping, daily report email + shareable PDF links
- Kubernetes deploy under `k8s/` (see [SECURITY.md](SECURITY.md) before pushing secrets)

### Security

- Env templates use placeholders only; `k8s/secrets.yaml` and `backend/.env` stay gitignored
- `./k8s/deploy.sh` requires `REGISTRY_PASS` from the environment (no hardcoded registry password)
- Default API URLs point at localhost so forks do not hit a maintainer deployment

## [Unreleased] — 1.2.0 (diabetes companion)

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

[1.1.0]: https://github.com/Saffist3r/HealthCompanion/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Saffist3r/HealthCompanion/releases/tag/v1.0.0
