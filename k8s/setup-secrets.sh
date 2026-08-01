#!/bin/bash
# Generate k8s/secrets.yaml from template with a random Postgres password.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SCRIPT_DIR/secrets.yaml"

if [ -f "$OUT" ]; then
  echo "Already exists: $OUT (remove it first to regenerate)"
  exit 1
fi

POSTGRES_PASSWORD="$(openssl rand -hex 16)"
JWT_SECRET="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@healthcompanion.local}"
GEMINI_API_KEY=""
if [ -f "$SCRIPT_DIR/../backend/.env" ]; then
  GEMINI_API_KEY="$(grep -E '^GEMINI_API_KEY=' "$SCRIPT_DIR/../backend/.env" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi

cat > "$OUT" <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: healthcompanion-secrets
  namespace: healthcompanion
type: Opaque
stringData:
  POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}"
  DATABASE_URL: "postgresql://healthcompanion:${POSTGRES_PASSWORD}@postgres:5432/healthcompanion"
  GEMINI_API_KEY: "${GEMINI_API_KEY}"
  JWT_SECRET: "${JWT_SECRET}"
  ADMIN_EMAIL: "${ADMIN_EMAIL}"
  ADMIN_PASSWORD: "${ADMIN_PASSWORD}"
  ADMIN_NAME: "Admin"
EOF

chmod 600 "$OUT"
echo "Created $OUT"
echo "Bootstrap admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"
if [ -z "$GEMINI_API_KEY" ]; then
  echo "Note: GEMINI_API_KEY is empty — set it in $OUT for meal AI"
fi
