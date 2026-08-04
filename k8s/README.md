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
| Frontend | `frontend` (nginx :80) |
| Ingress | `healthcompanion-ingress` |
| TLS | `healthcompanion-tls` |
| Images | `$REGISTRY/healthcompanion-{backend,frontend}:<VERSION>` |

API paths (`/auth`, `/glucose`, `/pump`, `/health-data`, `/uploads`, `/health`, `/docs`) go to the backend. SPA pages that share prefixes (`/reports`, `/meals`, `/users`) go to the frontend; nginx serves the app for browser HTML and proxies API calls to the backend. `/` catch-all goes to the SPA.

## Mobile

In the Android app: **Settings → API base URL** → your HTTPS API origin (same host as the web app).

## Local Docker smoke test

```bash
docker compose up -d db
# then run backend/frontend locally, or:
docker compose up --build
```
