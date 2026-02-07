#!/bin/bash
# Build release APKs for Health Companion v1.0.0
# Output: release/v1.0.0/

set -e
VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$ROOT/release/$VERSION"

echo "Building Health Companion $VERSION..."

# Build shared package
npm run build -w @health-companion/shared

# Build watch APK
echo "Building watch app..."
(cd "$ROOT/apps/watch/android" && ./gradlew assembleRelease)

mkdir -p "$RELEASE_DIR"

# Copy watch APK
WATCH_APK="$ROOT/apps/watch/android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$WATCH_APK" ]; then
  cp "$WATCH_APK" "$RELEASE_DIR/HealthCompanion-watch-$VERSION.apk"
  echo "  -> $RELEASE_DIR/HealthCompanion-watch-$VERSION.apk"
else
  echo "Error: Watch APK not found at $WATCH_APK"
  exit 1
fi

# Build phone APK (expo prebuild + gradle assembleRelease)
echo "Building phone app..."
npm run build:mobile
if [ -d "$ROOT/apps/mobile/android" ]; then
  (cd "$ROOT/apps/mobile/android" && ./gradlew assembleRelease)
  PHONE_APK="$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
  if [ -f "$PHONE_APK" ]; then
    cp "$PHONE_APK" "$RELEASE_DIR/HealthCompanion-phone-$VERSION.apk"
    echo "  -> $RELEASE_DIR/HealthCompanion-phone-$VERSION.apk"
  else
    echo "Error: Phone APK not found"
    exit 1
  fi
else
  echo "Error: expo prebuild did not create android/"
  exit 1
fi

echo ""
echo "Done! Release files in: $RELEASE_DIR"
ls -la "$RELEASE_DIR"
