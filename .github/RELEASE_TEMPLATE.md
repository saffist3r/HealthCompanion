# Health Companion v1.0.0

First stable release of Health Companion – a Wear OS watch face for displaying glycemia (blood glucose), heart rate, and steps.

## Downloads

- **HealthCompanion-watch-1.0.0.apk** – Install on your Wear OS watch
- **HealthCompanion-phone-1.0.0.apk** – Install on your Android phone

## What's New

### Watch Face
- Time and date (dd/MM/yyyy)
- Glycemia from CapAPS Fx, synced from phone
- Sparkline chart (last 24 readings)
- Heart rate (♥) from watch sensor
- Steps (👣) from watch sensor
- Status colors and animated background

### Phone App
- Reads glycemia from CapAPS Fx notifications
- Syncs to watch via Wear OS Data Layer
- History and chart view

## Requirements

- Android phone with **CapAPS Fx** (CamAPS FX) installed
- Wear OS 3+ watch (Samsung Galaxy Watch, Pixel Watch, etc.)
- Phone and watch paired with same Google account

## Installation

1. Install **phone app** → Grant Notification Access
2. Install **watch app** via ADB → Grant Body sensors + Activity recognition
3. Select **Health Companion** as your watch face

See [README](https://github.com/saffist3r/HealthCompanion#installation) for detailed steps.
