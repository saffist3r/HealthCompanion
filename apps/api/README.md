# Legacy Node/Express/SQLite API (superseded)

This package is **deprecated**. The production companion API is now:

- **`backend/`** — FastAPI + SQLAlchemy + **PostgreSQL** + **Gemini** vision
- **`frontend/`** — React (Vite) dashboard
- **`docker-compose.yml`** — Postgres + backend (+ optional frontend)

Use:

```bash
cp backend/.env.example backend/.env
# set GEMINI_API_KEY
docker compose up -d db
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Mobile Settings should point at `http://<lan-ip>:8000`.
