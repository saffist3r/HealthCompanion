# HealthCompanion on Kubernetes (Minikube + Traefik)

Example public URL pattern: `https://healthcompanion.example.com` (replace with your domain).

Stack: React (Vite) SPA + FastAPI backend + PostgreSQL 16. Meal photo AI uses Gemini (`GEMINI_API_KEY`).

## Prerequisites

- SSH access to a VPS that runs Minikube / kubectl (set `VPS_SSH`, default host alias `infra-vps`)
- DNS **A record** for your domain → your VPS public IP
- A container registry you can push to (set `REGISTRY`, `REGISTRY_USER`, **`REGISTRY_PASS`**)
- `kubectl` available on the VPS (or a wrapper like `kubectl-vps`)

## First-time setup

### 1. Secrets

```bash
chmod +x k8s/setup-secrets.sh k8s/deploy.sh
./k8s/setup-secrets.sh
# Edit GEMINI_API_KEY (and SMTP if needed) in k8s/secrets.yaml
# Never commit k8s/secrets.yaml — it is gitignored
```

See also [SECURITY.md](../SECURITY.md).

### 2. TLS certificate

```bash
# On VPS — free port 80 (scale Traefik down / stop nginx), then:
sudo certbot certonly --standalone -d healthcompanion.example.com \
  --non-interactive --agree-tos -m admin@example.com

kubectl create namespace healthcompanion --dry-run=client -o yaml | kubectl apply -f -
sudo kubectl create secret tls healthcompanion-tls \
  --cert=/etc/letsencrypt/live/healthcompanion.example.com/fullchain.pem \
  --key=/etc/letsencrypt/live/healthcompanion.example.com/privkey.pem \
  -n healthcompanion --dry-run=client -o yaml | kubectl apply -f -
```

Update hostnames in `k8s/ingress.yaml` (and related manifests) to match your domain before applying.

### 3. Deploy

```bash
export REGISTRY_PASS='…'   # required — never commit this
# optional overrides:
# export REGISTRY=registry.example.com
# export REGISTRY_USER=registryuser
# export VPS_SSH=infra-vps
# export PUBLIC_URL=https://healthcompanion.example.com

./k8s/deploy.sh
```

Bump `VERSION` before each release.

## Architecture

| Resource | Name |
|----------|------|
| Namespace | `healthcompanion` |
| Postgres | StatefulSet `postgres` + PVC |
| Backend | `backend` (FastAPI :8000) + uploads PVC |
| Frontend | `frontend` (unprivileged nginx :8080, Service :80) |
| Ingress | `healthcompanion-ingress` |
| TLS | `healthcompanion-tls` |
| Images | `$REGISTRY/healthcompanion-{backend,frontend}:<VERSION>` |

All API routes live under **`/api`** (web app and phone 1.6+), routed straight to the backend. The older root-level API paths (`/auth`, `/glucose`, `/pump`, `/health-data`, `/reports/…`, `/uploads`, `/health`) still reach the backend so phone builds released before `/api` keep working; remove them from `ingress.yaml` and `frontend/nginx.conf` once every phone is updated. `/` catch-all goes to the SPA.

### Upgrading from 1.5.x

- **`JWT_SECRET` must be ≥ 32 characters** — `setup-secrets.sh` already generates 64 hex chars; older hand-written secrets may need rotating (users sign in again).
- **Schema changes now go through Alembic.** The backend runs `alembic upgrade head` on start (under a Postgres advisory lock); the first boot adopts the existing tables. New migrations: `cd backend && alembic revision --autogenerate -m "…"`.
- Containers run as non-root (backend uid 10001, frontend uid 101). The `fix-uploads-owner` init container re-owns the uploads PVC once.
- Deploy the backend **before** shipping a phone build that uses `/api`.

## Mobile

In the Android app: **Settings → API base URL** → your HTTPS API origin (same host as the web app).

## Local Docker smoke test

```bash
docker compose up -d db
# then run backend/frontend locally, or:
docker compose up --build
```
