# Health Companion

A Wear OS watch face plus Android phone companion and optional self-hosted web/API for diabetes day-to-day: glycemia, meals, activity, injuries, care visits, and AI-assisted reports.

![Health Companion Watch Face](assets/watch-face-screenshot.png)

**Latest tagged release:** [v1.5.0](https://github.com/saffist3r/HealthCompanion/releases/tag/v1.5.0) · [Releases](RELEASES.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md)

> **Current deploy (`1.5.46`):** Full companion — FastAPI + Postgres, React dashboard, meal photo AI (Gemini), Tunisian Darija voice daily briefing for Saff, Samsung Health / Health Connect activity, injury + pain tracking, pump notification sync, JWT auth, customizable TIR, FR/EN web i18n, diabetic engagement. Deploy notes in [`k8s/`](k8s/README.md).

Glycemia values sync from **CapAPS Fx** notifications on your Android phone via the Wear OS Data Layer.

Use this repository to build and run the app on **your own** devices and servers. See [SECURITY.md](SECURITY.md) before publishing forks or deploying — never commit `.env`, `k8s/secrets.yaml`, meal photos, or database dumps.

---

## Diabetes companion (phone + API + web)

The mobile app includes **Meals**, **Reports**, **Activity**, and **Settings** tabs on top of CapAPS glucose → watch sync.

| Feature | How it works |
|---------|----------------|
| Meal photos | Camera/gallery → **Gemini** (server) → carbs/protein/fat + diabetes warnings |
| Food log | Stored in **your** PostgreSQL via FastAPI (`backend/`) |
| Web dashboard | React (Vite) at `frontend/` — daily stats, charts, meals, reports, injuries |
| Reports | Daily & weekly nutrition + glucose TIR + steps; AI agent prompt + PDF |
| Injuries | Persistent cases + daily pain slider (0–10); wired into reports / AI |
| Activity | Health Connect + Samsung Health (steps, Energy Score, workouts) |
| API keys | `GEMINI_API_KEY` and DB credentials stay on the server — never on the phone |

### Run backend + Postgres + web

```bash
cp backend/.env.example backend/.env
# set GEMINI_API_KEY and JWT_SECRET (see SECURITY.md)

docker compose up -d db
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# another terminal
cd frontend && npm install && npm run dev
```

- API: http://localhost:8000/docs  
- Web: http://localhost:5173  

On a physical phone, set **Settings → API base URL** to `http://<your-lan-ip>:8000` (or your HTTPS origin in production).

See [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md), and [SECURITY.md](SECURITY.md).

### Deploy to cluster (Minikube)

Kubernetes manifests and deploy script live in [`k8s/`](k8s/README.md):

```bash
./k8s/setup-secrets.sh          # creates gitignored k8s/secrets.yaml
export REGISTRY_PASS='…'        # required — never commit
./k8s/deploy.sh
```

Edit hostnames in `k8s/ingress.yaml` / `k8s/configmap.yaml` for your domain.


---

## Features

| Feature | Description |
|---------|-------------|
| **Time & Date** | Large time display with date (dd/MM/yyyy) underneath |
| **Glycemia** | Blood glucose from CapAPS Fx, synced from phone notifications |
| **Trend** | Animated arrows on the watch face (↑ / ↓ / →); 12h chart on the phone app |
| **Heart Rate** | Live BPM from watch sensor with vector heart icon |
| **Steps** | Daily step count from watch sensor (since midnight) |
| **Status Colors** | Green (in range), orange (high), red (low/very high) |
| **Customization** | Watch background (animated / solid / gradient / image slideshow), text color, status tint |
| **Low alert** | Watch vibrates on new reading below 70 mg/dL |
| **Meal AI** | Photograph meals → server-side AI macros + diabetes warnings |
| **Reports** | Daily / weekly nutrition + glucose + activity + injuries |
| **Injuries** | Cases + daily pain logs for rehab / AI context |
| **Health Connect** | Import steps / workouts (e.g. from Samsung Health) |

---

## How It Works

```mermaid
flowchart LR
    subgraph Phone [Android Phone]
        CapAPS[CapAPS Fx App]
        HCPhone[Health Companion Phone App]
    end
    subgraph Watch [Wear OS Watch]
        HCWatch[Health Companion Watch Face]
    end
    CapAPS -->|Notification with BG value| HCPhone
    HCPhone -->|Wear OS Data Layer| HCWatch
    HCWatch -->|Heart rate, steps| Watch[Watch sensors]
```

1. **CapAPS Fx** on your phone sends notifications with glycemia readings.
2. **Health Companion** (phone app) reads those notifications and syncs the value to the watch via Wear OS Data Layer.
3. The **watch face** shows time, glycemia, trend arrows, heart rate, and steps.

---

## Watch customization

On the **phone app**, open **Watch background** to:

- Choose style: **Animated**, **Solid**, **Gradient**, or **Image**
- Pick **text color** for time, date, and stats on the watch face
- Select **multiple images** for a slideshow (15s–120s interval)
- Toggle **status color tint**

Changes sync automatically; use **Sync to watch** on the glycemia card to push glycemia, 12h history, and background in one go.

On the **watch app**, swipe to the **Settings** page to adjust background and text color locally.

---

## Permissions

### Phone App (Health Companion)

| Permission | Purpose | When Required |
|------------|---------|---------------|
| **Notification Access** | Read glycemia from CapAPS Fx notifications | On first launch – user must enable in Settings |
| `INTERNET` | Network (Expo/React Native) | Automatic |
| `READ_EXTERNAL_STORAGE` | Storage (React Native) | Automatic |
| `WRITE_EXTERNAL_STORAGE` | Storage (React Native) | Automatic |
| `VIBRATE` | Haptic feedback | Automatic |
| `SYSTEM_ALERT_WINDOW` | Overlay (if used) | Automatic |

**Important:** The phone app must be granted **Notification Access** (Settings → Apps → Special app access → Notification access → Health Companion). Without this, glycemia will not sync to the watch.

### Watch App (Health Companion)

| Permission | Purpose | When Required |
|------------|---------|---------------|
| `BODY_SENSORS` | Heart rate sensor | Granted when opening the app – enables heart rate on watch face |
| `ACTIVITY_RECOGNITION` | Step counter sensor | Granted when opening the app – enables steps on watch face |

**Important:** Open the Health Companion app on the watch once and accept both permissions. The watch face will retry sensor registration periodically (every 30 seconds) if permissions are granted later.

---

## Prerequisites

- **Node.js** ≥ 18.0.0  
- **npm** ≥ 9.0.0  
- **Android Studio** (for building)  
- **JDK 17+**  
- **Android phone** with CapAPS Fx installed  
- **Wear OS watch** (e.g. Samsung Galaxy Watch, Pixel Watch)  
- **CapAPS Fx** app sending notifications with glycemia values  

---

## Installation

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/saffist3r/HealthCompanion.git
cd HealthCompanion
npm install
```

### 2. Build Shared Package

```bash
npm run build -w @health-companion/shared
```

(Or run `npm run prepare` which builds shared and applies patches.)

**Important:** Always build `@health-companion/shared` before a phone release APK so TypeScript changes are compiled to `dist/`.

### 3. Build and Install Phone App

```bash
npm run build:mobile
cd apps/mobile && npx expo run:android
```

Or use Android Studio to build and run the phone app on a connected device/emulator.

### 4. Grant Notification Access (Phone)

1. Open the Health Companion app on your phone.
2. Tap **Open settings** or go to **Settings → Apps → Special app access → Notification access**.
3. Enable **Health Companion**.

### 5. Build Watch App

```bash
npm run build:watch
```

Or for debug:

```bash
cd apps/watch/android && ./gradlew app:assembleDebug
```

The APK will be at:

- Debug: `apps/watch/android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `apps/watch/android/app/build/outputs/apk/release/app-release.apk`

### 6. Install Watch App

**Option A: Watch connected via Bluetooth ADB**

```bash
# Forward ADB through phone
adb forward tcp:4444 localabstract:/adb-hub
adb connect localhost:4444

# Install
adb -s localhost:4444 install -r apps/watch/android/app/build/outputs/apk/debug/app-debug.apk
```

**Option B: Watch connected via WiFi**

1. On the watch: **Settings → Developer options** → Enable **ADB debugging** and **Debug over WiFi**.
2. Note the watch IP and port (e.g. `192.168.1.96:5555`).
3. Install:

```bash
adb connect 192.168.1.96:5555
adb -s 192.168.1.96:5555 install -r apps/watch/android/app/build/outputs/apk/debug/app-debug.apk
```

**Option C: WiFi pairing script**

```bash
./scripts/install-watch-wifi.sh <IP> <pairing_port> <code> [connection_port]
# Example: ./scripts/install-watch-wifi.sh 192.168.1.96 40199 153951
```

### 7. Grant Watch Permissions

1. Open **Health Companion** on the watch (tap the app icon).
2. When prompted, grant **Body sensors** (heart rate) and **Activity recognition** (steps).
3. Select the **Health Companion** watch face from the watch face picker.

---

## Project Structure

```
HealthCompanion/
├── apps/
│   ├── mobile/                 # Phone app (Expo / React Native)
│   │   ├── App.tsx             # Main UI
│   │   ├── index.ts            # Entry, notification listener
│   │   ├── plugins/            # Expo config plugin (Wear OS bridge)
│   │   └── src/
│   │       ├── wearSync.ts     # Sync glycemia, history, background to watch
│   │       ├── backgroundSettings.ts
│   │       └── components/     # BackgroundSettingsCard, SparklineChart
│   └── watch/                  # Wear OS watch app
│       └── android/
│           └── app/src/main/java/.../watch/
│               ├── HealthCompanionWatchFaceService.kt   # Watch face
│               ├── GlycemiaDataListenerService.kt       # Receives data from phone
│               ├── GlycemiaHolder.kt                    # Glycemia + 12h history
│               ├── BackgroundSettingsHolder.kt          # Background + text color
│               ├── TrendArrowRenderer.kt                # Rising/falling arrows
│               ├── StatsIconsRenderer.kt                # Heart & steps icons
│               ├── HeartRateHolder.kt / HeartRateMonitor.kt
│               ├── StepsHolder.kt / StepsMonitor.kt
│               ├── SettingsScreen.kt                    # Watch settings UI
│               └── MainActivity.kt                      # App UI + permission requests
├── packages/
│   ├── shared/                 # Shared code (parsing, types, background, sparkline)
│   │   └── src/                # background.ts, sparkline.ts, index.ts
│   └── database/               # Shared database types
├── patches/                    # patch-package patches (e.g. notification listener + Wear)
├── scripts/
│   └── install-watch-wifi.sh   # Install watch app via WiFi
└── README.md
```

---

## Building

| Command | Description |
|---------|-------------|
| `npm run mobile` | Start phone app dev server |
| `npm run watch` | Start watch app dev server |
| `npm run build:mobile` | Build phone app |
| `npm run build:watch` | Build watch app (release) |
| `npm run build -w @health-companion/shared` | Build shared package |

---

## CapAPS Fx Compatibility

The app parses glycemia from CapAPS Fx (CamAPS FX) notifications. Supported package IDs include:

- `com.camdiab.fx_alert.mmoll`
- `com.camdiab.fx_alert.mgdl`
- `com.camdiab.fx_alert`
- `com.camdiab`

Supported formats in notification text (must include an explicit unit):

- `X.X mmol/L`, `X.X mg/dL`, `X.X mmol`
- Values **without** `mg/dL` or `mmol/L` are ignored (avoids bolus/insulin lines)

---

## Troubleshooting

### No glycemia on watch

1. **Notification access** – Ensure Health Companion has Notification Access on the phone.
2. **Phone and watch paired** – Both must be connected (Bluetooth or WiFi).
3. **Sync from phone** – Open the Health Companion phone app; it syncs on launch. Use **Sync to watch** to push glycemia, 12h history, and background settings.
4. **CapAPS notifications** – CapAPS Fx must have sent at least one notification with a glycemia value.
5. **Refresh on watch** – Open the watch app and tap the screen to trigger a refresh.

### Heart rate shows "--" or icon without value

1. **Grant BODY_SENSORS** – Open the Health Companion app on the watch and accept the Body sensors permission.
2. **Wait for retry** – The watch face retries sensor registration every 30 seconds.
3. **Device support** – Some Wear OS 4+ devices limit direct heart rate sensor access; behavior may vary by manufacturer.

### Steps show "--" or icon without value

1. **Grant ACTIVITY_RECOGNITION** – Open the Health Companion app on the watch and accept the Activity recognition permission.
2. **Step sensors** – The app uses `TYPE_STEP_COUNTER` (cumulative) or `TYPE_STEP_DETECTOR` (per-step) as fallback. Support varies by device.
3. **Walk with watch** – On some devices, the step sensor updates mainly when the screen is on or after movement.

### Watch face not in picker

On Wear OS 5+ (e.g. Galaxy Watch 7), traditional Jetpack watch faces may not appear. You can still use the Health Companion app: open it and leave it on screen to view time, glycemia, heart rate, and steps.

---

## License

MIT License - see [LICENSE](LICENSE).

---

## Contributing

Contributions are welcome. Please open an issue or pull request.
