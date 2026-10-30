# Releases

This document explains how releases work and what is included in each release.

**Policy:** never bump `VERSION`, deploy (`./k8s/deploy.sh`), or publish a git/GitHub release without updating `CHANGELOG.md` (and this file / `README.md` when the latest tag or highlights change). Every deploy gets an annotated `vX.Y.Z` tag on the deployed commit.

**Current deploy line:** `1.9.0` (see [CHANGELOG](CHANGELOG.md#190---2026-10-30)). Latest **tag:** [v1.9.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.9.0).

Tags: [v1.9.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.9.0) · [v1.8.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.8.0) · [v1.7.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.7.0) · [v1.6.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.6.0) · [v1.5.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.5.0) · [v1.4.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.4.0) · [v1.3.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.3.0) · [v1.2.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.2.0) · [v1.1.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.1.0) · [v1.0.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.0.0)

Release notes for v1.2–v1.5 also live under [`.github/release-notes/`](.github/release-notes/).

---

## Release v1.9.0

**Date:** 2026-10-30 · **Tag:** [`v1.9.0`](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.9.0)

### Highlights

- Phone app redesigned around four tabs (Home, Log, Insights, Me) in the HUD style of the logo and watch face
- Web app restyled to match: navy, cyan/mint, Rajdhani, dark forms; clinic printouts stay light

No backend or database changes (Alembic stays at `0003`). See [CHANGELOG.md](CHANGELOG.md#190---2026-10-30).

---

## Release v1.8.0

**Date:** 2026-10-29 · **Tag:** [`v1.8.0`](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.8.0)

### Highlights

- Three watch faces (HUD, Classic, Minimal), picked from the watch app or from the phone (Settings → Watch); the newest pick wins on either device
- Face animations while the screen is on (gauge sweep and ripple, comet seconds, heartbeat at the measured rate, trend nudge); the reading itself is never interpolated
- Phone glucose chart uses the watch's CGM trend engine: seven-step arrow, change per 5 min, "Low/High in ~N min" warnings
- New logo across phone, web and watch; the phone follows the system dark mode
- Watch app opens straight to its settings and fits round screens

No backend or database changes (Alembic stays at `0003`). The phone build needs a native rebuild for the new icon, dark mode and face picker. See [CHANGELOG.md](CHANGELOG.md#180---2026-10-29).

---

## Release v1.7.0

**Date:** 2026-10-22 · **Tag:** [`v1.7.0`](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.7.0)

### Highlights

- Care team view: a read-only, expiring share link for the nurse or doctor (glucose bands, GMI, hypos with the 4 hours before, insulin, carbs, steps, pain, mood, sleep)
- Stay signed in on web and phone (token refresh on open, 60-day tokens)

Alembic `0003` adds `care_shares`. See [CHANGELOG.md](CHANGELOG.md#170---2026-10-22).

---

## 1.6.0 (deploy, tag `v1.6.0`)

**Date:** 2026-10-21

### Highlights

- Hardened API: `JWT_SECRET` required (weak values warn), strict CORS, signed expiring meal-photo links, failed-login throttle, non-root containers
- All endpoints under `/api` (legacy root paths kept for older phone builds)
- Alembic database migrations (adopts existing databases on first boot)
- CI (backend tests, migrations on Postgres, web/mobile typecheck, Docker image builds) + Dependabot
- Fixes: RAG archive export crash, TTS error handling, `docker compose` backend build
- Removed the deprecated Node API (`apps/api`)

Upgrade notes: [`k8s/README.md`](k8s/README.md#upgrading-from-15x). See [CHANGELOG.md](CHANGELOG.md#160---2026-10-21).

---

## Release v1.5.0

**Date:** 2026-08-02 · **Tag:** [`v1.5.0`](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.5.0)

### Highlights

- Full companion stack: injuries + pain, pump sync, reports (PDF / email / share), AI debriefs
- JWT auth, household scoping, Kubernetes deploy (`k8s/`)
- Public-safe secrets (no hardcoded registry password)

The **1.5.x** line continued with later patches after this milestone (TIR settings, i18n, icons, etc.).

See [CHANGELOG.md](CHANGELOG.md#150---2026-08-02).

---

## Release v1.4.0

**Date:** 2026-08-02 · **Tag:** [`v1.4.0`](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.4.0)

### Highlights

- Care visits (Kiné / Ostéo / Podologue)
- Padel / sport session logging (W/L/D + score)
- Samsung Health activity + Energy Score; Sports dashboard

See [CHANGELOG.md](CHANGELOG.md#140---2026-08-02).

---

## Release v1.3.0

**Date:** 2026-08-02 · **Tag:** [`v1.3.0`](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.3.0)

### Highlights

- JWT authentication and household accounts
- Device-scoped data; polished web dashboard
- Hardened Kubernetes deploy for the public site

See [CHANGELOG.md](CHANGELOG.md#130---2026-08-02).

---

## Release v1.2.0

**Date:** 2026-08-02 · **Tag:** [`v1.2.0`](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.2.0)

### Highlights

- FastAPI + PostgreSQL backend with Gemini meal vision
- React web dashboard; docker-compose stack
- Mobile tabs: Glucose, Meals, Reports, Activity, Settings

See [CHANGELOG.md](CHANGELOG.md#120---2026-08-02).

---

## Release v1.1.0

**Date:** 2026-06-23 · **Tag:** [`v1.1.0`](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.1.0)

### Highlights

- Watch face **background customization** (animated, solid, gradient, image slideshow) and **text color**
- **Trend arrows** on watch face; **12h sparkline** on phone and watch app
- **Sync to watch** pushes glycemia, history, and background settings
- Stricter glycemia parsing; **low glucose vibration** on watch

### Build

```bash
npm run prepare
./scripts/build-release.sh
```

See [CHANGELOG.md](CHANGELOG.md#110---2026-06-23) for full details.

---

## Release v1.0.0

**Tag:** [`v1.0.0`](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.0.0)

### What's Included

| Asset | Description |
|-------|-------------|
| `HealthCompanion-watch-1.0.0.apk` | Wear OS watch app + watch face. Install on your Wear OS watch. |
| `HealthCompanion-phone-1.0.0.apk` | Android phone app. Reads CapAPS Fx notifications and syncs to watch. |

### Installation Order

1. **Install phone app** on your Android phone
2. **Grant Notification Access** in Settings → Apps → Notification access
3. **Install watch app** on your Wear OS watch
4. **Open watch app** and grant Body sensors + Activity recognition
5. **Select Health Companion** as your watch face

### Requirements

- Android phone with **CapAPS Fx** installed and sending notifications
- Wear OS 3+ watch paired with the phone
- Same Google account on both devices (for Wear OS Data Layer sync)

### Building Release APKs Yourself

To build the release APKs from source:

```bash
# From repo root
npm run build:release
```

This produces both:

- `release/v1.0.0/HealthCompanion-watch-1.0.0.apk`
- `release/v1.0.0/HealthCompanion-phone-1.0.0.apk`

Or build individually:

```bash
# Watch APK
npm run build:watch
# -> apps/watch/android/app/build/outputs/apk/release/app-release.apk

# Phone APK (requires expo prebuild first)
npm run build:mobile
cd apps/mobile/android && ./gradlew assembleRelease
# -> apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

### GitHub Release

When creating a [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository):

1. Tag: `v1.0.0` (or next semver)
2. Title: `Health Companion v1.0.0`
3. Attach the APK files as assets
4. Use the changelog from `CHANGELOG.md` for the release notes
