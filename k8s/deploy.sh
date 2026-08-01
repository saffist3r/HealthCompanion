#!/bin/bash
# HealthCompanion — Kubernetes deployment (PadPal / EndoLink / MindMapSaff pattern)
# - Sync source to VPS
# - Build images on VPS (docker --network=host)
# - Push to registry.saffist3r.xyz
# - Load into Minikube via docker save | minikube image load
# - Apply manifests via kubectl on VPS

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REGISTRY="${REGISTRY:-registry.saffist3r.xyz}"
REGISTRY_USER="${REGISTRY_USER:-registryuser}"
# Never commit a real password. Export REGISTRY_PASS before deploying.
REGISTRY_PASS="${REGISTRY_PASS:-}"
VPS_SSH="${VPS_SSH:-infra-vps}"
VPS_PROJECT="${VPS_PROJECT:-/home/debian/Projects/HealthCompanion}"
VERSION_FILE="$PROJECT_ROOT/VERSION"
IMAGE_TAG="${IMAGE_TAG:-$(tr -d '[:space:]' < "$VERSION_FILE")}"
NAMESPACE="healthcompanion"
PUBLIC_URL="${PUBLIC_URL:-https://healthcompanion.saffist3r.xyz}"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_phase() {
  echo -e "\n${BLUE}========================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}========================================${NC}\n"
}

kubectl_vps() {
  ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$VPS_SSH" kubectl "$@"
}

if command -v kubectl-vps >/dev/null 2>&1; then
  kubectl_vps() { kubectl-vps "$@"; }
fi

check_prereqs() {
  log_phase "Checking prerequisites"
  if [ -z "$REGISTRY_PASS" ]; then
    log_error "REGISTRY_PASS is not set (required for docker login). Example:"
    log_info "  export REGISTRY_PASS='…'   # do not commit this value"
    exit 1
  fi
  if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$VPS_SSH" 'echo OK' >/dev/null 2>&1; then
    log_error "Cannot SSH to $VPS_SSH"
    exit 1
  fi
  if ! kubectl_vps get nodes >/dev/null 2>&1; then
    log_error "kubectl on VPS cannot reach cluster"
    exit 1
  fi
  if [ ! -f "$SCRIPT_DIR/secrets.yaml" ]; then
    log_error "Missing $SCRIPT_DIR/secrets.yaml"
    log_info "Run: ./k8s/setup-secrets.sh   OR   cp k8s/secrets.yaml.template k8s/secrets.yaml"
    exit 1
  fi
  log_info "Prerequisites OK (IMAGE_TAG=$IMAGE_TAG)"
}

sync_to_vps() {
  log_phase "Syncing source to VPS"
  cd "$PROJECT_ROOT"
  COPYFILE_DISABLE=1 tar czf - \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='**/node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='frontend/dist' \
    --exclude='backend/.venv' \
    --exclude='backend/uploads' \
    --exclude='backend/dev.db' \
    --exclude='backend/.env' \
    --exclude='apps/api/.env' \
    --exclude='apps/*/android' \
    --exclude='apps/*/ios' \
    --exclude='release' \
    --exclude='k8s/secrets.yaml' \
    . | ssh "$VPS_SSH" "mkdir -p '$VPS_PROJECT' && tar xzf - -C '$VPS_PROJECT'"

  scp -q "$SCRIPT_DIR/secrets.yaml" "$VPS_SSH:/tmp/healthcompanion-secrets.yaml"
}

build_and_load_on_vps() {
  log_phase "Building and loading images on VPS"
  ssh "$VPS_SSH" bash <<REMOTE
set -euo pipefail
VERSION=${IMAGE_TAG}
REGISTRY=${REGISTRY}
PROJECT=${VPS_PROJECT}
PUBLIC_URL=${PUBLIC_URL}

printf '%s\n' '${REGISTRY_PASS}' | docker login "\$REGISTRY" -u ${REGISTRY_USER} --password-stdin

echo "== Building backend \$VERSION =="
docker build --network=host \
  -t "\$REGISTRY/healthcompanion-backend:\$VERSION" \
  -f "\$PROJECT/backend/Dockerfile" "\$PROJECT/backend"

echo "== Building frontend \$VERSION =="
docker build --network=host \
  --build-arg "VITE_API_URL=\$PUBLIC_URL" \
  -t "\$REGISTRY/healthcompanion-frontend:\$VERSION" \
  -f "\$PROJECT/frontend/Dockerfile" "\$PROJECT/frontend"

echo "== Ensuring postgres:16-alpine is available =="
docker pull postgres:16-alpine || true

echo "== Pushing =="
docker push "\$REGISTRY/healthcompanion-backend:\$VERSION" || echo "WARN: backend push failed"
docker push "\$REGISTRY/healthcompanion-frontend:\$VERSION" || echo "WARN: frontend push failed"

echo "== Loading into Minikube =="
docker save "\$REGISTRY/healthcompanion-backend:\$VERSION" | minikube image load -
docker save "\$REGISTRY/healthcompanion-frontend:\$VERSION" | minikube image load -
docker save postgres:16-alpine | minikube image load -

echo "== Cleaning leftover minikube image tars =="
sudo find /var/lib/docker/volumes/minikube/_data/lib/minikube/images/ -type f -delete 2>/dev/null || true
REMOTE
}

k_apply() {
  kubectl_vps apply -f - < "$1"
}

k_apply_with_tag() {
  sed "s/VERSION_TAG/${IMAGE_TAG}/g" "$1" | kubectl_vps apply -f -
}

deploy_k8s() {
  log_phase "Deploying to Kubernetes"
  cd "$SCRIPT_DIR"

  kubectl_vps create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl_vps apply -f -

  if ! kubectl_vps get secret registry-secret -n "$NAMESPACE" >/dev/null 2>&1; then
    log_info "Creating registry-secret"
    kubectl_vps create secret docker-registry registry-secret \
      --docker-server="$REGISTRY" \
      --docker-username="$REGISTRY_USER" \
      --docker-password="$REGISTRY_PASS" \
      -n "$NAMESPACE" \
      --dry-run=client -o yaml | kubectl_vps apply -f -
  fi

  k_apply namespace.yaml
  k_apply configmap.yaml
  k_apply secrets.yaml

  if ! kubectl_vps get secret healthcompanion-tls -n "$NAMESPACE" >/dev/null 2>&1; then
    log_warn "TLS secret healthcompanion-tls not found — see k8s/README.md before going live"
  fi

  k_apply postgres.yaml
  log_info "Waiting for PostgreSQL..."
  kubectl_vps wait --for=condition=ready pod -l app=postgres -n "$NAMESPACE" --timeout=300s || log_warn "Postgres not ready yet"

  k_apply_with_tag backend.yaml
  k_apply_with_tag frontend.yaml
  k_apply_with_tag cronjob-daily-report.yaml
  k_apply ingress.yaml

  kubectl_vps set image deployment/backend backend="${REGISTRY}/healthcompanion-backend:${IMAGE_TAG}" -n "$NAMESPACE"
  kubectl_vps set image deployment/frontend frontend="${REGISTRY}/healthcompanion-frontend:${IMAGE_TAG}" -n "$NAMESPACE"
  # Keep CronJob image in sync with backend tag
  kubectl_vps set image cronjob/daily-report-email send="${REGISTRY}/healthcompanion-backend:${IMAGE_TAG}" -n "$NAMESPACE" 2>/dev/null || true

  for dep in backend frontend; do
    kubectl_vps rollout restart "deployment/$dep" -n "$NAMESPACE"
    kubectl_vps rollout status "deployment/$dep" -n "$NAMESPACE" --timeout=300s
  done

  log_info "Workloads:"
  kubectl_vps get deploy,pods,ingress -n "$NAMESPACE"
}

verify() {
  log_phase "Verification"
  if curl -sf "${PUBLIC_URL}/health" >/dev/null 2>&1; then
    log_info "API health OK at ${PUBLIC_URL}/health"
  else
    log_warn "Could not reach ${PUBLIC_URL}/health — configure DNS + TLS first"
  fi
  if curl -sf "${PUBLIC_URL}/" >/dev/null 2>&1; then
    log_info "Web OK at ${PUBLIC_URL}"
  else
    log_warn "Could not reach ${PUBLIC_URL}"
  fi
}

main() {
  log_phase "HealthCompanion deploy v${IMAGE_TAG}"
  check_prereqs
  sync_to_vps
  build_and_load_on_vps
  deploy_k8s
  verify
  log_phase "Deploy complete"
  log_info "URL: ${PUBLIC_URL}"
  log_info "API docs: ${PUBLIC_URL}/docs"
  log_info "Mobile Settings → API base URL: ${PUBLIC_URL}"
}

main "$@"
