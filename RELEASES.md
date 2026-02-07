# Releases

This document explains how releases work and what is included in each release.

## Release v1.0.0

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

1. Tag: `v1.0.0`
2. Title: `Health Companion v1.0.0`
3. Attach the APK files as assets
4. Use the changelog from `CHANGELOG.md` for the release notes
