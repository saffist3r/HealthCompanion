# Releases

This document explains how releases work and what is included in each release.

**Policy:** never bump `VERSION`, deploy (`./k8s/deploy.sh`), or publish a git/GitHub release without updating `CHANGELOG.md` (and this file / `README.md` when the latest tag or highlights change). See `.cursor/rules/release-docs-required.mdc`.

**Current deploy line:** `1.5.51` (see [CHANGELOG](CHANGELOG.md#1551---2026-08-04)). Latest **milestone tag:** [v1.5.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.5.0).

GitHub releases: [v1.5.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.5.0) (latest tag) · [v1.4.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.4.0) · [v1.3.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.3.0) · [v1.2.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.2.0) · [v1.1.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.1.0) · [v1.0.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.0.0)

Release notes for v1.2–v1.5 also live under [`.github/release-notes/`](.github/release-notes/).

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
