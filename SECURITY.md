# Security & privacy

This repository is **public**. Treat everything you commit as visible to the world.

## Never commit

| Item | Why | Where it lives locally |
|------|-----|------------------------|
| `backend/.env` | API keys, JWT, SMTP, DB URL | gitignored — copy from `.env.example` |
| `k8s/secrets.yaml` | Cluster secrets (Postgres, Gemini, admin, SMTP) | gitignored — create with `./k8s/setup-secrets.sh` |
| `backend/uploads/` | Meal photos and other PHI | gitignored |
| `*.db` / Prisma SQLite files | Local health databases | gitignored |
| `*.pem` / private keys | TLS and SSH material | gitignored |
| Release APKs under `release/` | Large binaries (optional to publish via GitHub Releases) | APKs gitignored |

## Required secrets (self-hosting)

1. **`GEMINI_API_KEY`** — meal photo analysis (Google AI Studio).
2. **`JWT_SECRET`** — session and photo-link signing. Use at least 32 random characters (`openssl rand -hex 32`); the API refuses to start without one and logs a warning when it is short or a placeholder.
3. **`POSTGRES_PASSWORD` / `DATABASE_URL`** — database credentials.
4. **`ADMIN_EMAIL` / `ADMIN_PASSWORD`** — first bootstrap admin (change after first login).
5. **`REGISTRY_PASS`** — container registry login for `./k8s/deploy.sh` (**export in your shell; never hardcode in the repo**).
6. Optional **SMTP_*** — daily PDF email.

Templates:

- [`backend/.env.example`](backend/.env.example)
- [`k8s/secrets.yaml.template`](k8s/secrets.yaml.template)

## Health data

- Glucose, meals, insulin/pump events, weight, injuries, and care visits are stored in **your** Postgres (or on-device storage).
- They are **not** part of this git tree.
- Share links for PDF reports use random tokens with TTL; treat share URLs as sensitive.
- Meal photos are served only through signed, expiring URLs (`/api/uploads/<file>?exp=…&sig=…`, HMAC with `JWT_SECRET`, `UPLOAD_URL_TTL_MINUTES`, default 7 days). Uploaded files keep only image extensions.
- Failed sign-ins are throttled per email and per client IP (`LOGIN_MAX_FAILURES` within `LOGIN_WINDOW_SECONDS`, default 10 per 15 min → HTTP 429).
- CORS only allows the origins listed in `CORS_ORIGINS`.
- **Data visibility:** by default (`DATA_SCOPE=household`) every signed-in user sees every device's data — intended for one household. Set `DATA_SCOPE=owner` so each user only sees devices registered to them (phones register on login). Public share links and the daily email job always use the household view.
- Do not commit database dumps, CSV exports, or meal photo folders.

## Defaults in source

Code defaults point at **localhost** so forks do not send traffic to someone else’s deployment. Set:

- Mobile / web: **Settings → API base URL**
- Cluster: `PUBLIC_URL`, `CORS_ORIGINS` in `k8s/configmap.yaml`
- Ingress hostnames in `k8s/ingress.yaml`

Kubernetes manifests in this repo may still name a specific example domain used by the maintainer’s cluster — **change them** when you deploy elsewhere.

## If a secret was ever committed

1. Rotate it immediately (registry password, Gemini key, JWT, DB password, SMTP).
2. Remove it from git history if needed (`git filter-repo` / BFG) — rotating alone is not enough if the key was pushed.
3. Redeploy with fresh `k8s/secrets.yaml`.

## Responsible use

Meal estimates and AI suggestions are **not medical advice**. Confirm carbs and therapy decisions with your clinical team.
