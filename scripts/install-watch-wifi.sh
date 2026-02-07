#!/bin/bash
# Install Health Companion watch app via WiFi debugging
# Usage: ./install-watch-wifi.sh <IP> <PAIRING_PORT> <CODE> [CONNECTION_PORT]
# Example: ./install-watch-wifi.sh 192.168.1.69 40199 153951
# If connection port differs, add it as 4th arg (often 5555 or shown in watch settings)

set -e
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
APK="$(dirname "$0")/../apps/watch/android/app/build/outputs/apk/debug/app-debug.apk"

IP="${1:?Usage: $0 <IP> <pairing_port> <code> [connection_port]}"
PAIR_PORT="${2:?}"
CODE="${3:?}"
CONN_PORT="${4:-$PAIR_PORT}"

echo "Pairing with $IP:$PAIR_PORT (code: $CODE)..."
echo "$CODE" | "$ADB" pair "$IP:$PAIR_PORT" || true

echo "Connecting to $IP:$CONN_PORT..."
"$ADB" connect "$IP:$CONN_PORT"
sleep 2

echo "Installing watch app..."
"$ADB" -s "$IP:$CONN_PORT" install -r "$APK"
echo "Done! Open Health Companion on your watch."
