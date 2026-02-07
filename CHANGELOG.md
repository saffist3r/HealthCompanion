# Changelog

All notable changes to Health Companion will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
