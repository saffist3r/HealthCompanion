# Health Companion Backend

FastAPI + PostgreSQL + **Gemini** meal vision — same layout as HomeManager / MyMeals / EndoLink.

## Quick start

```bash
# from repo root
cp backend/.env.example backend/.env
# set GEMINI_API_KEY=...

docker compose up -d db

cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API: `http://localhost:8000` · Docs: `http://localhost:8000/docs`

## Auth (MVP)

`X-Device-Id` header scopes all meals / glucose / activity (matches the phone app).

## Endpoints

Same paths as the mobile client expects:

- `GET /health`
- `POST /meals/analyze` (multipart photo)
- `POST/GET/DELETE /meals`
- `POST /glucose/sync`
- `POST/GET /health-data/activity`
- `GET /reports/daily|weekly|dashboard`

## Env

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres URL |
| `GEMINI_API_KEY` | Google AI Studio / Gemini API key |
| `GEMINI_MODEL` | default `gemini-flash-latest` |
| `UPLOAD_DIR` | meal photo storage |
