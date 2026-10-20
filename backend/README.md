# Health Companion Backend

FastAPI + PostgreSQL + **Gemini** meal vision — same layout as HomeManager / MyMeals / EndoLink.

## Quick start

```bash
# from repo root
cp backend/.env.example backend/.env
# set GEMINI_API_KEY=... and JWT_SECRET=$(openssl rand -hex 32)

docker compose up -d db

cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API: `http://localhost:8000` · Docs: `http://localhost:8000/docs`

## Tests and lint

```bash
cd backend
ruff check .
pytest -q
```

CI (`.github/workflows/ci.yml`) also applies the migrations to Postgres and runs `alembic check`.

## Database migrations (Alembic)

The app runs `alembic upgrade head` on startup. After changing `app/models`:

```bash
cd backend
alembic revision --autogenerate -m "add foo column"   # review the generated file
alembic upgrade head
```

`tests/test_migrations.py` fails if models and migrations drift apart.

## Auth

JWT bearer tokens (`POST /api/auth/login`). Phone writes also send `X-Device-Id`, which registers the device to the signed-in user.

## Endpoints

Everything is under `/api` (root-level aliases remain for older phone builds and are hidden from `/docs`):

- `GET /api/health`
- `POST /api/meals/analyze` (multipart photo) — returns a signed `photoUrl`
- `POST/GET/DELETE /api/meals`
- `POST /api/glucose/sync`
- `POST/GET /api/health-data/…` (activity, care, sport, mental, body, injuries, workouts)
- `GET /api/reports/daily|weekly|dashboard`
- `GET /api/uploads/{file}?exp=…&sig=…` (signed meal photo links)

## Env

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres URL |
| `GEMINI_API_KEY` | Google AI Studio / Gemini API key |
| `GEMINI_MODEL` | default `gemini-3.6-flash` |
| `UPLOAD_DIR` | meal photo storage |
| `JWT_SECRET` | **required**, ≥ 32 chars — signs sessions and photo links |
| `DATA_SCOPE` | `household` (default, all users share data) or `owner` |
| `LOGIN_MAX_FAILURES` / `LOGIN_WINDOW_SECONDS` | failed sign-in throttle (default 10 / 900 s) |
| `UPLOAD_URL_TTL_MINUTES` | signed photo link lifetime (default 7 days) |
