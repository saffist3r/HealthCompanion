# Release Assets

This folder contains built APKs for each release. Run `npm run build:release` to build.

## v1.0.0

After running `npm run build:release`, you will find:

| File | Description |
|------|-------------|
| `HealthCompanion-watch-1.0.0.apk` | Wear OS watch app + watch face |
| `HealthCompanion-phone-1.0.0.apk` | Android phone app (if built) |

## Installation

1. **Phone:** Install the phone APK, grant Notification Access
2. **Watch:** Install the watch APK via ADB, grant sensors permissions
3. Select Health Companion as your watch face

See [RELEASES.md](../RELEASES.md) for full instructions.
